package orchescala.simulation

import zio.{Task, ZIO, ZLayer}
import zio.test.{assertTrue, ZIOSpecDefault}
import _root_.sbt.testing.{Event, EventHandler, Status, TaskDef}

import java.util.concurrent.ConcurrentLinkedQueue
import scala.jdk.CollectionConverters.*

/** A simulation whose setup dies - e.g. a layer with `orDie`, an exception while building it. */
class DyingSimulation extends SimulationRunner:
  def requiredLayers: Seq[ZLayer[Any, Nothing, Any]] = Seq.empty
  simulation = ZIO.die(RuntimeException("engine not reachable"))

/** A simulation without any result - nothing was simulated. */
class EmptySimulation extends SimulationRunner:
  def requiredLayers: Seq[ZLayer[Any, Nothing, Any]] = Seq.empty
  simulation = ZIO.succeed(Seq.empty)

/** A simulation that never called `simulate` - `simulation` is not set. */
class UnsetSimulation extends SimulationRunner:
  def requiredLayers: Seq[ZLayer[Any, Nothing, Any]] = Seq.empty

/** Never ends - e.g. waiting for a worker that is not running. */
class NeverEndingSimulation extends SimulationRunner:
  def requiredLayers: Seq[ZLayer[Any, Nothing, Any]] = Seq.empty
  simulation = ZIO.never.onInterrupt(ZIO.succeed(NeverEndingSimulation.interrupted.set(true)))

object NeverEndingSimulation:
  val interrupted = java.util.concurrent.atomic.AtomicBoolean(false)

class SuccessfulSimulation extends SimulationRunner:
  def requiredLayers: Seq[ZLayer[Any, Nothing, Any]] = Seq.empty
  simulation = ZIO.succeed(Seq(LogLevel.INFO -> Seq(ScenarioResult("scenario", LogLevel.INFO, ""))))

class FailedSimulation extends SimulationRunner:
  def requiredLayers: Seq[ZLayer[Any, Nothing, Any]] = Seq.empty
  simulation = ZIO.succeed(Seq(LogLevel.ERROR -> Seq(ScenarioResult("scenario", LogLevel.ERROR, ""))))

object SimulationTestFrameworkSpec extends ZIOSpecDefault:

  /** Runs the simulation like sbt does - the statuses reported to sbt. */
  private def runAsSbt(
      simulation: Class[?],
      timeout: scala.concurrent.duration.FiniteDuration = scala.concurrent.duration.Duration(5, "minutes")
  ): Task[List[Status]] =
    ZIO.attemptBlocking:
      val events  = ConcurrentLinkedQueue[Status]()
      val handler = new EventHandler:
        def handle(event: Event): Unit = events.add(event.status())
      val runner  = SimulationTestRunner(Array.empty, Array.empty, getClass.getClassLoader, timeout)
      val taskDef = TaskDef(simulation.getName, SimulationFingerprint, false, Array.empty)
      runner.tasks(Array(taskDef)).foreach(_.execute(handler, Array.empty))
      events.asScala.toList

  def spec = suite("SimulationTestFramework - what sbt gets reported")(
    test("a simulation whose setup dies fails - it was reported as nothing, so sbt was green") {
      for statuses <- runAsSbt(classOf[DyingSimulation])
      yield assertTrue(statuses == List(Status.Failure))
    },
    test("a simulation without any result fails") {
      for statuses <- runAsSbt(classOf[EmptySimulation])
      yield assertTrue(statuses == List(Status.Failure))
    },
    test("a simulation that never called simulate fails") {
      for statuses <- runAsSbt(classOf[UnsetSimulation])
      yield assertTrue(statuses == List(Status.Failure))
    },
    test("a simulation with an error fails") {
      for statuses <- runAsSbt(classOf[FailedSimulation])
      yield assertTrue(statuses == List(Status.Failure))
    },
    test("a simulation running longer than its timeout is stopped and fails - it ran on next to the next one") {
      for statuses <- runAsSbt(classOf[NeverEndingSimulation], scala.concurrent.duration.Duration(1, "second"))
      yield assertTrue(statuses == List(Status.Failure), NeverEndingSimulation.interrupted.get)
    },
    test("a successful simulation succeeds") {
      for statuses <- runAsSbt(classOf[SuccessfulSimulation])
      yield assertTrue(statuses == List(Status.Success))
    }
  )
end SimulationTestFrameworkSpec
