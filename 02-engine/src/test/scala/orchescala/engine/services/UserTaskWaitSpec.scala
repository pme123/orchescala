package orchescala.engine.services

import orchescala.domain.{IdentityCorrelation, JsonProperty}
import orchescala.engine.domain.{EngineError, EngineType, UserTask}
import io.circe.{Json, JsonObject}
import zio.*
import zio.test.*

import java.util.concurrent.atomic.AtomicInteger

object UserTaskWaitSpec extends ZIOSpecDefault:

  /** The task becomes active after `activeAfter` lookups - counts the lookups. */
  private final class StubUserTaskService(activeAfter: Int) extends UserTaskService:
    val lookups                                   = AtomicInteger(0)
    def engineType: EngineType                    = EngineType.C7
    def getUserTask(processInstanceId: String, userTaskDefId: String): IO[EngineError, Option[UserTask]] =
      ZIO.succeed(Option.when(lookups.incrementAndGet() > activeAfter)(UserTask("task-1")))
    def complete(taskId: String, processVariables: JsonObject, identityCorrelation: Option[IdentityCorrelation])
        : IO[EngineError, Unit] = ZIO.unit
    def variables(taskId: String, processInstanceId: String, variableFilter: Option[Seq[String]])
        : IO[EngineError, Seq[JsonProperty]] = ZIO.succeed(Seq(JsonProperty("name", Json.fromString("John"))))

  def spec = suite("Waiting for a user task")(
    test("an active task is returned with timeoutInSec=0 - it always failed before") {
      val service = StubUserTaskService(activeAfter = 0)
      for result <- service.getUserTaskVariablesInternal("pi", "task", None, Some(0))
      yield assertTrue(result._1 == "task-1")
    },
    test("a task that becomes active while waiting is returned") {
      val service = StubUserTaskService(activeAfter = 3)
      for
        fiber  <- service.getUserTaskVariablesInternal("pi", "task", None, Some(10)).fork
        _      <- TestClock.adjust(5.seconds)
        result <- fiber.join
      yield assertTrue(result._1 == "task-1", service.lookups.get == 4)
    },
    test("no active task within the timeout: 404 - not 500") {
      val service = StubUserTaskService(activeAfter = Int.MaxValue)
      for
        fiber <- service.getUserTaskVariablesInternal("pi", "task", None, Some(3)).fork
        _     <- TestClock.adjust(5.seconds)
        exit  <- fiber.join.exit
      yield assertTrue(
        exit.causeOption.flatMap(_.failureOption).exists:
          case EngineError.ServiceRequestError(404, _) => true
          case _                                       => false
        ,
        service.lookups.get == 4 // right away and after each of the 3 seconds
      )
    },
    test("a caller's timeout is capped - the request is not held open for an hour") {
      val service = StubUserTaskService(activeAfter = Int.MaxValue)
      for
        fiber <- service.getUserTaskVariablesInternal("pi", "task", None, Some(3600)).fork
        _     <- TestClock.adjust((UserTaskService.maxTimeoutInSec + 1).seconds)
        exit  <- fiber.join.exit
      yield assertTrue(exit.isFailure, service.lookups.get == UserTaskService.maxTimeoutInSec + 1)
    }
  )
end UserTaskWaitSpec
