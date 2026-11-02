package orchescala.engine.gateway

import orchescala.domain.*
import orchescala.engine.domain.*
import orchescala.engine.domain.ProcessInfo.ProcessStatus
import orchescala.engine.services.ProcessInstanceService
import zio.test.*
import zio.{IO, ZIO}

object GProcessInstanceServiceTest extends ZIOSpecDefault:

  case class MockProcessInstanceService(
      engineTypeValue: EngineType,
      startAnswer: Either[EngineError, String]
  ) extends ProcessInstanceService:
    val engineType: EngineType      = engineTypeValue
    var startCalls: List[String]    = Nil

    override def startProcessAsync(
        processDefId: String,
        in: JsonObject,
        businessKey: Option[String],
        tenantId: Option[String],
        identityCorrelation: Option[IdentityCorrelation]
    ): IO[EngineError, ProcessInfo] =
      startCalls = processDefId :: startCalls
      answer(businessKey)

    override def startProcessByMessage(
        messageName: String,
        businessKey: Option[String],
        tenantId: Option[String],
        variables: Option[JsonObject],
        identityCorrelation: Option[IdentityCorrelation]
    ): IO[EngineError, ProcessInfo] =
      startCalls = messageName :: startCalls
      answer(businessKey)

    override def getVariablesInternal(
        processInstanceId: String,
        variableFilter: Option[Seq[String]]
    ): IO[EngineError, Seq[JsonProperty]] =
      ZIO.fail(EngineError.ServiceRequestError(404, s"$engineType: unknown process instance"))

    private def answer(businessKey: Option[String]): IO[EngineError, ProcessInfo] =
      ZIO.fromEither(startAnswer).map: id =>
        ProcessInfo(id, businessKey, ProcessStatus.Active, engineType)
  end MockProcessInstanceService

  private val landedInRunningInstance = EngineError.ServiceRequestError(
    409,
    "Message 'start-order' was correlated to a running process instance (4711) - no process was started"
  )
  private def notOnThisEngine(engine: EngineType) =
    EngineError.ServiceRequestError(404, s"$engine: no start event for message 'start-order'")

  def spec = suite("GProcessInstanceService")(
    suite("startProcessByMessage")(
      test("a 409 of the first engine is the answer - the second engine is not tried") {
        val c7Service = MockProcessInstanceService(EngineType.C7, Left(landedInRunningInstance))
        val c8Service = MockProcessInstanceService(EngineType.C8, Right("c8-new-instance"))
        val gService  = GProcessInstanceService(using Seq(c7Service, c8Service))
        for
          error <- gService.startProcessByMessage("start-order", businessKey = Some("order-1")).flip
        yield assertTrue(
          error == landedInRunningInstance,
          c7Service.startCalls == List("start-order"),
          c8Service.startCalls.isEmpty
        )
      },
      test("a 404 of the first engine falls through to the second one") {
        val c7Service = MockProcessInstanceService(EngineType.C7, Left(notOnThisEngine(EngineType.C7)))
        val c8Service = MockProcessInstanceService(EngineType.C8, Right("c8-new-instance"))
        val gService  = GProcessInstanceService(using Seq(c7Service, c8Service))
        for
          info <- gService.startProcessByMessage("start-order", businessKey = Some("order-1"))
        yield assertTrue(
          info.processInstanceId == "c8-new-instance",
          info.engineType == EngineType.C8,
          c7Service.startCalls == List("start-order"),
          c8Service.startCalls == List("start-order")
        )
      },
      test("an engine that is not reachable falls through to the second one") {
        val c7Service =
          MockProcessInstanceService(EngineType.C7, Left(EngineError.ProcessError("C7: connection refused")))
        val c8Service = MockProcessInstanceService(EngineType.C8, Right("c8-new-instance"))
        val gService  = GProcessInstanceService(using Seq(c7Service, c8Service))
        for
          info <- gService.startProcessByMessage("start-order", businessKey = Some("order-1"))
        yield assertTrue(
          info.engineType == EngineType.C8,
          c8Service.startCalls == List("start-order")
        )
      },
      test("a 409 of the second engine after a 404 of the first one is the answer") {
        val c7Service = MockProcessInstanceService(EngineType.C7, Left(notOnThisEngine(EngineType.C7)))
        val c8Service = MockProcessInstanceService(EngineType.C8, Left(landedInRunningInstance))
        val gService  = GProcessInstanceService(using Seq(c7Service, c8Service))
        for
          error <- gService.startProcessByMessage("start-order", businessKey = Some("order-1")).flip
        yield assertTrue(
          error == landedInRunningInstance,
          c7Service.startCalls.length == 1,
          c8Service.startCalls.length == 1
        )
      }
    ),
    suite("startProcessAsync")(
      test("a 409 of the first engine is the answer - the second engine is not tried") {
        val c7Service = MockProcessInstanceService(EngineType.C7, Left(landedInRunningInstance))
        val c8Service = MockProcessInstanceService(EngineType.C8, Right("c8-new-instance"))
        val gService  = GProcessInstanceService(using Seq(c7Service, c8Service))
        for
          error <- gService
                     .startProcessAsync("order-process", JsonObject.empty, Some("order-1"), None, None)
                     .flip
        yield assertTrue(
          error == landedInRunningInstance,
          c8Service.startCalls.isEmpty
        )
      }
    ),
    suite("isFinalAnswer")(
      test("only a 409 stops the fall-through") {
        assertTrue(
          isFinalAnswer(landedInRunningInstance),
          !isFinalAnswer(EngineError.ServiceRequestError(404, "not found")),
          !isFinalAnswer(EngineError.ServiceRequestError(400, "bad request")),
          !isFinalAnswer(EngineError.ServiceRequestError(401, "unauthorized")),
          !isFinalAnswer(EngineError.ProcessError("connection refused"))
        )
      }
    )
  )
end GProcessInstanceServiceTest
