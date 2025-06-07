package orchescala.simulation2

import orchescala.engine.EngineRuntime
import zio.{IO, Unsafe, ZIO}

import java.util.concurrent.TimeUnit
import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.*

final class SimulationTestFramework extends sbt.testing.Framework:

  val name: String = "CSimulation"

  val fingerprints: Array[sbt.testing.Fingerprint] = Array(
    SimulationFingerprint
  )
  println(s"SimulationTestFramework2 started")
  def runner(
      args: Array[String],
      remoteArgs: Array[String],
      testClassLoader: ClassLoader
  ): SimulationTestRunner =
    new SimulationTestRunner(args, remoteArgs, testClassLoader)
  end runner

end SimulationTestFramework

object SimulationFingerprint extends sbt.testing.SubclassFingerprint:
  def superclassName(): String = SimulationRunner.getClass.getName.replace("$", "")
  final def isModule() = false
  final def requireNoArgConstructor() = true
end SimulationFingerprint

final class SimulationTestRunner(
    val args: Array[String],
    val remoteArgs: Array[String],
    testClassLoader: ClassLoader
) extends sbt.testing.Runner:
  private val maxLine = 85

  override def tasks(
      taskDefs: Array[sbt.testing.TaskDef]
  ): Array[sbt.testing.Task] =
    taskDefs.map { td =>

      Task(
        td,
        (loggers, eventHandler) =>
          println(s"Running Simulation: ${td.fullyQualifiedName()}")
          runSimulationZIO(td)
            .map : (logLevel, time) =>
              println(s"Finished Simulation: $logLevel, $time")

              eventHandler.synchronized {
                eventHandler.handle(new sbt.testing.Event:
                  def fullyQualifiedName(): String = td.fullyQualifiedName()

                  def throwable(): sbt.testing.OptionalThrowable =
                    sbt.testing.OptionalThrowable()

                  def status(): sbt.testing.Status = logLevel match
                    case LogLevel.ERROR =>
                      sbt.testing.Status.Failure
                    case _ =>
                      sbt.testing.Status.Success

                  def selector(): sbt.testing.NestedTestSelector =
                    new sbt.testing.NestedTestSelector(
                      fullyQualifiedName(),
                      "Simulation"
                    )

                  def fingerprint(): sbt.testing.Fingerprint = td.fingerprint()

                  def duration(): Long = time
                )
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
              for
                _ <- ZIO.logInfo(s"Runningxxx Simulation: ${taskDef.fullyQualifiedName()}")
                // Fork the worker execution within the scope
                //fiber <-
                logLevelAndTime <-
                  runSimulation(taskDef)
                  .provideLayer(EngineRuntime.sharedExecutorLayer)
                 // .fork

                // Add a finalizer to ensure the fiber is interrupted if the scope closes
            /*    _ <- ZIO.addFinalizer:
                  fiber.status.flatMap: status =>
                    fiber.interrupt.when(!status.isDone)*/
                // Join the fiber to wait for completion
              //  logLevelAndTime <- fiber.join
                _ <- ZIO.logInfo(s"Finished Simulation: $logLevelAndTime")

              yield logLevelAndTime
            .catchAll: ex =>
              ZIO.logError(s"Error running Simulation: ${ex.getMessage}")
                .as((LogLevel.ERROR, 0L))
            .ensuring:
              ZIO.logInfo(
              s"Simulation for task ${taskDef.fullyQualifiedName()} completed and resources cleaned up"
            )

  private def runSimulation(taskDef: sbt.testing.TaskDef): IO[Throwable, (LogLevel, Long)] =
    val name = taskDef.fullyQualifiedName().split('.').last
    val line = "~" * (((maxLine - 5) - name.length) / 2)
    for
      _ <- ZIO.logInfo(s"Running Simulation 1: $name")
      clock <- ZIO.clock
      startTime <- clock.currentTime(TimeUnit.MILLISECONDS)
      _ <- ZIO.logInfo(s"Running Simulation 2: $name")
      sim <- ZIO.attempt(
        Class
          .forName(taskDef.fullyQualifiedName())
          .getDeclaredConstructor()
          .newInstance()
          .asInstanceOf[SimulationRunner]
      )
      _ <- ZIO.logInfo(s"Running Simulation 3: $name")

      endTime <- clock.currentTime(TimeUnit.MILLISECONDS)
      _ <- ZIO.logInfo(s"Running Simulation 4: ${sim.simulation}")
      results <- sim.simulation
      _ <- ZIO.logInfo(s"Running Simulation 5: $name")
      logLevel = results.head._1
      _ <- ZIO.logInfo(s"Running Simulation 6: $name")
      _ <- ZIO.logInfo(
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
      runUTestTask(loggers, eventHandler),
      5.minutes
    )
    Array()
  end execute
end Task
