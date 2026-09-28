package orchescala.simulation

import orchescala.engine.EngineRuntime
import zio.ZIO.logInfo
import zio.{IO, Unsafe, ZIO}

import java.util.concurrent.TimeUnit
import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration.*
import scala.concurrent.{Await, ExecutionContext, Future}

final class SimulationTestFramework extends sbt.testing.Framework:

  val name: String = "CSimulation"

  val fingerprints: Array[sbt.testing.Fingerprint] = Array(
    SimulationFingerprint
  )

  def runner(
      args: Array[String],
      remoteArgs: Array[String],
      testClassLoader: ClassLoader
  ): SimulationTestRunner =
    new SimulationTestRunner(args, remoteArgs, testClassLoader)
  end runner

end SimulationTestFramework

object SimulationFingerprint extends sbt.testing.SubclassFingerprint:
  def superclassName(): String        = SimulationRunner.getClass.getName.replace("$", "")
  final def isModule()                = false
  final def requireNoArgConstructor() = true
end SimulationFingerprint

/** @param simulationTimeout
  *   how long a simulation may run - then it is stopped and reported as failed
  */
final class SimulationTestRunner(
    val args: Array[String],
    val remoteArgs: Array[String],
    testClassLoader: ClassLoader,
    simulationTimeout: FiniteDuration = 5.minutes
) extends sbt.testing.Runner:
  private val maxLine = 85

  override def tasks(
      taskDefs: Array[sbt.testing.TaskDef]
  ): Array[sbt.testing.Task] =
    taskDefs.map { td =>
      Task(
        td,
        // a last resort only - the simulation itself is stopped after simulationTimeout
        simulationTimeout + 1.minute,
        (loggers, eventHandler) =>
          runSimulationZIO(td)
            // last resort - a simulation that did not run must never be reported as a success
            .recover: ex =>
              System.err.println(s"Error running Simulation ${td.fullyQualifiedName()}: $ex")
              (LogLevel.ERROR, 0L)
            .map: (logLevel, time) =>
              eventHandler.synchronized {
                eventHandler.handle(new sbt.testing.Event:
                  def fullyQualifiedName(): String = td.fullyQualifiedName()

                  def throwable(): sbt.testing.OptionalThrowable =
                    sbt.testing.OptionalThrowable()

                  def status(): sbt.testing.Status = logLevel match
                    case LogLevel.ERROR =>
                      sbt.testing.Status.Failure
                    case _              =>
                      sbt.testing.Status.Success

                  def selector(): sbt.testing.NestedTestSelector =
                    new sbt.testing.NestedTestSelector(
                      fullyQualifiedName(),
                      "Simulation"
                    )

                  def fingerprint(): sbt.testing.Fingerprint = td.fingerprint()

                  def duration(): Long = time)
              }
      )
    }

  override def done(): String =
    "All Simulations done - see the console above for more information"

  private def runSimulationZIO(taskDef: sbt.testing.TaskDef): Future[(LogLevel, Long)] =
    Unsafe.unsafe:
      implicit unsafe =>
        EngineRuntime.zioRuntime.unsafe.runToFuture:
          ZIO
            .scoped:
              (for
                // Create the simulation instance
                sim             <- ZIO.attempt(
                                     Class
                                       .forName(taskDef.fullyQualifiedName())
                                       .getDeclaredConstructor()
                                       .newInstance()
                                       .asInstanceOf[SimulationRunner]
                                   )
                // Fork the worker execution within the scope
                fiber           <-
                  runSimulation(taskDef, sim)
                    .fork
                // Add a finalizer to ensure the fiber is interrupted if the scope closes
                _               <- ZIO.addFinalizer:
                                     fiber.status.flatMap: status =>
                                       ZIO.logInfo(
                                         s"Interrupting Simulation: $status ${taskDef.fullyQualifiedName()}"
                                       ) *>
                                         fiber.interrupt.when(!status.isDone)
                // Join the fiber to wait for completion - at most simulationTimeout: only the
                // wait ended before (Await in Task.execute), the simulation ran on next to the
                // following ones. Interrupted now by the finalizer above, when the scope closes.
                logLevelAndTime <- fiber.join
                                     .timeout(zio.Duration.fromScala(simulationTimeout))
                                     .someOrElseZIO:
                                       ZIO.logError(
                                         s"Simulation ${taskDef.fullyQualifiedName()} did not finish within $simulationTimeout - stopped"
                                       ).as((LogLevel.ERROR, simulationTimeout.toMillis))
                _               <- ZIO.logInfo(
                                     s"Finished Simulation: $logLevelAndTime ${taskDef.fullyQualifiedName()}"
                                   )
              yield logLevelAndTime)
            // the cause, not only the errors: a defect (e.g. a layer that dies, an exception thrown
            // while building the simulation) failed the Future - no result was reported to sbt
            // and the simulation that never ran was shown as a success
            .catchAllCause: cause =>
              ZIO.logError(
                s"Error running Simulation ${taskDef.fullyQualifiedName()}:\n${cause.prettyPrint}"
              ).as((LogLevel.ERROR, 0L))
            .ensuring:
              ZIO.logInfo(
                s"Simulation for task ${taskDef.fullyQualifiedName()} completed and resources cleaned up"
              )
            .provideLayer(EngineRuntime.logger)

  private def runSimulation(
      taskDef: sbt.testing.TaskDef,
      sim: SimulationRunner
  ): IO[Throwable, (LogLevel, Long)] =
    for
      name      <- ZIO.attempt(taskDef.fullyQualifiedName().split('.').last)
      line      <- ZIO.succeed("~" * (((maxLine - 5) - name.length) / 2))
      _         <- ZIO.logInfo(s"Starting Simulation: $name")
      clock     <- ZIO.clock
      startTime <- clock.currentTime(TimeUnit.MILLISECONDS)
      _         <- ZIO.logInfo(s"Starting Simulation2: $name")
      results   <- sim.simulation
      _         <- ZIO.logInfo(s"Finished Simulation: $name")
      endTime   <- clock.currentTime(TimeUnit.MILLISECONDS)
      // sorted by level, the most severe first - no result at all: nothing was simulated
      logLevel   = results.headOption.map(_._1).getOrElse(LogLevel.ERROR)
      _         <- ZIO.logError(s"Simulation $name has no results - no scenario ran")
                     .when(results.isEmpty)
      _         <- logInfo(
                     s"""
                |${logLevel.color}${s"$line START $name $line"
                         .takeRight(maxLine)}${Console.RESET}
                |${results.reverse.flatMap((sr: (LogLevel, Seq[ScenarioResult])) =>
                         sr._2.map(_.log)
                       ).mkString("\n")}
                |${results.map(sr => printResult(sr._1, sr._2)).mkString("\n")}
                |${logLevel.color}${s"$line END $name in ${endTime - startTime} ms $line"
                         .takeRight(maxLine)}${Console.RESET}
                |""".stripMargin
                   )
    yield (logLevel, endTime - startTime)
    end for
  end runSimulation

  private def printResult(
      level: LogLevel,
      scenarioResults: Seq[ScenarioResult]
  ): String =
    s"""${"-" * maxLine}
       |${level.color}Scenarios with Level $level:${Console.RESET}
       |${scenarioResults
        .map { scenRes => s"- ${scenRes.name}" }
        .mkString("\n")}""".stripMargin

end SimulationTestRunner

class Task(
    val taskDef: sbt.testing.TaskDef,
    maxWait: FiniteDuration,
    runUTestTask: (
        Seq[sbt.testing.Logger],
        sbt.testing.EventHandler
    ) => Future[Unit]
) extends sbt.testing.Task:

  def tags(): Array[String] = Array()

  def execute(
      eventHandler: sbt.testing.EventHandler,
      loggers: Array[sbt.testing.Logger]
  ): Array[sbt.testing.Task] =
    Await.ready(
      runUTestTask(loggers.toSeq, eventHandler),
      maxWait
    )
    Array()
  end execute
end Task
