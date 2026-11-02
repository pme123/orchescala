package orchescala.engine.gateway

import orchescala.domain.*
import orchescala.engine.domain.*
import orchescala.engine.domain.ProcessInfo.ProcessStatus
import orchescala.engine.services.{MessageService, ProcessInstanceService}
import zio.test.*
import zio.{IO, Ref, UIO, ZIO}

/** The fall-through of the gateway to the next engine (`tryServicesWithErrorCollection`), through
  * GProcessInstanceService and GMessageService: a 409 is the answer of the engine that has the
  * case - no other engine is tried. Errors that say "not on this engine" still fall through.
  */
object GatewayFallThroughTest extends ZIOSpecDefault:

  case class MockProcessInstanceService(
      engineType: EngineType,
      startAnswer: Either[EngineError, String],
      calls: Ref[List[String]]
  ) extends ProcessInstanceService:

    override def startProcessAsync(
        processDefId: String,
        in: JsonObject,
        businessKey: Option[String],
        tenantId: Option[String],
        identityCorrelation: Option[IdentityCorrelation]
    ): IO[EngineError, ProcessInfo] =
      calls.update(processDefId :: _) *> answer(businessKey)

    override def startProcessByMessage(
        messageName: String,
        businessKey: Option[String],
        tenantId: Option[String],
        variables: Option[JsonObject],
        identityCorrelation: Option[IdentityCorrelation]
    ): IO[EngineError, ProcessInfo] =
      calls.update(messageName :: _) *> answer(businessKey)

    override def getVariablesInternal(
        processInstanceId: String,
        variableFilter: Option[Seq[String]]
    ): IO[EngineError, Seq[JsonProperty]] =
      ZIO.fail(EngineError.ServiceRequestError(404, s"$engineType: unknown process instance"))

    private def answer(businessKey: Option[String]): IO[EngineError, ProcessInfo] =
      ZIO.fromEither(startAnswer).map: id =>
        ProcessInfo(id, businessKey, ProcessStatus.Active, engineType)
  end MockProcessInstanceService

  object MockProcessInstanceService:
    def make(engineType: EngineType, startAnswer: Either[EngineError, String]): UIO[MockProcessInstanceService] =
      Ref.make(List.empty[String]).map(MockProcessInstanceService(engineType, startAnswer, _))

  case class MockMessageService(
      engineType: EngineType,
      sendAnswer: Either[EngineError, String],
      calls: Ref[List[String]]
  ) extends MessageService:

    override def sendMessage(
        name: String,
        tenantId: Option[String],
        timeToLiveInSec: Option[Int],
        businessKey: Option[String],
        processInstanceId: Option[String],
        variables: Option[JsonObject],
        identityCorrelation: Option[IdentityCorrelation]
    ): IO[EngineError, MessageCorrelationResult] =
      calls.update(name :: _) *>
        ZIO.fromEither(sendAnswer).map: id =>
          MessageCorrelationResult.Execution(id, processInstanceId.getOrElse(id), engineType)
  end MockMessageService

  object MockMessageService:
    def make(engineType: EngineType, sendAnswer: Either[EngineError, String]): UIO[MockMessageService] =
      Ref.make(List.empty[String]).map(MockMessageService(engineType, sendAnswer, _))

  private val landedInRunningInstance = EngineError.ServiceRequestError(
    409,
    "Message 'start-order' was correlated to a running process instance (4711) - no process was started"
  )
  private val alreadyPublished =
    EngineError.ServiceRequestError(409, "C8 REST POST /messages/publication -> 409: already published")

  private def notOnThisEngine(engine: EngineType) =
    EngineError.ServiceRequestError(404, s"$engine: no start event for message 'start-order'")

  // A new key per test: the EngineCache is a global singleton - no test sees an entry of another.

  /** A UUID - without a cache entry it is routed to C8 first (see `engineTypeForKey`). */
  private val newUuidKey: UIO[String] = ZIO.succeed(java.util.UUID.randomUUID().toString)

  /** A business key - no id, so without a cache entry the engines are tried in the given order. */
  private val newBusinessKey: UIO[String] = newUuidKey.map(id => s"order-$id")

  def spec = suite("Gateway fall-through")(
    suite("startProcessByMessage")(
      test("a 409 of the first engine is the answer - the second engine is not tried") {
        for
          c7Service <- MockProcessInstanceService.make(EngineType.C7, Left(landedInRunningInstance))
          c8Service <- MockProcessInstanceService.make(EngineType.C8, Right("c8-new-instance"))
          gService   = GProcessInstanceService(using Seq(c7Service, c8Service))
          error     <- gService.startProcessByMessage("start-order", businessKey = Some("order-1")).flip
          c7Calls   <- c7Service.calls.get
          c8Calls   <- c8Service.calls.get
        yield assertTrue(
          error == landedInRunningInstance,
          c7Calls == List("start-order"),
          c8Calls.isEmpty
        )
      },
      test("the same with C8 first - a 409 of C8 is the answer, C7 is not tried") {
        for
          c8Service <- MockProcessInstanceService.make(EngineType.C8, Left(landedInRunningInstance))
          c7Service <- MockProcessInstanceService.make(EngineType.C7, Right("c7-new-instance"))
          gService   = GProcessInstanceService(using Seq(c8Service, c7Service))
          error     <- gService.startProcessByMessage("start-order", businessKey = Some("order-1")).flip
          c7Calls   <- c7Service.calls.get
        yield assertTrue(
          error == landedInRunningInstance,
          c7Calls.isEmpty
        )
      },
      test("a 404 of the first engine falls through to the second one") {
        for
          c7Service <- MockProcessInstanceService.make(EngineType.C7, Left(notOnThisEngine(EngineType.C7)))
          c8Service <- MockProcessInstanceService.make(EngineType.C8, Right("c8-new-instance"))
          gService   = GProcessInstanceService(using Seq(c7Service, c8Service))
          info      <- gService.startProcessByMessage("start-order", businessKey = Some("order-1"))
          c7Calls   <- c7Service.calls.get
          c8Calls   <- c8Service.calls.get
        yield assertTrue(
          info.processInstanceId == "c8-new-instance",
          info.engineType == EngineType.C8,
          c7Calls == List("start-order"),
          c8Calls == List("start-order")
        )
      },
      test("an engine that is not reachable falls through to the second one") {
        for
          c7Service <- MockProcessInstanceService.make(
                         EngineType.C7,
                         Left(EngineError.ProcessError("C7: connection refused"))
                       )
          c8Service <- MockProcessInstanceService.make(EngineType.C8, Right("c8-new-instance"))
          gService   = GProcessInstanceService(using Seq(c7Service, c8Service))
          info      <- gService.startProcessByMessage("start-order", businessKey = Some("order-1"))
          c8Calls   <- c8Service.calls.get
        yield assertTrue(
          info.engineType == EngineType.C8,
          c8Calls == List("start-order")
        )
      },
      test("a 409 of the second engine after a 404 of the first one is the answer") {
        for
          c7Service <- MockProcessInstanceService.make(EngineType.C7, Left(notOnThisEngine(EngineType.C7)))
          c8Service <- MockProcessInstanceService.make(EngineType.C8, Left(landedInRunningInstance))
          gService   = GProcessInstanceService(using Seq(c7Service, c8Service))
          error     <- gService.startProcessByMessage("start-order", businessKey = Some("order-1")).flip
          c7Calls   <- c7Service.calls.get
          c8Calls   <- c8Service.calls.get
        yield assertTrue(
          error == landedInRunningInstance,
          c7Calls.length == 1,
          c8Calls.length == 1
        )
      },
      test("a 409 of the second engine after an engine that is not reachable is the answer") {
        for
          c7Service <- MockProcessInstanceService.make(
                         EngineType.C7,
                         Left(EngineError.ProcessError("C7: connection refused"))
                       )
          c8Service <- MockProcessInstanceService.make(EngineType.C8, Left(landedInRunningInstance))
          gService   = GProcessInstanceService(using Seq(c7Service, c8Service))
          error     <- gService.startProcessByMessage("start-order", businessKey = Some("order-1")).flip
        yield assertTrue(error == landedInRunningInstance)
      }
    ),
    suite("startProcessAsync")(
      test("a 409 of the first engine is the answer - the second engine is not tried") {
        for
          c7Service <- MockProcessInstanceService.make(EngineType.C7, Left(landedInRunningInstance))
          c8Service <- MockProcessInstanceService.make(EngineType.C8, Right("c8-new-instance"))
          gService   = GProcessInstanceService(using Seq(c7Service, c8Service))
          error     <- gService
                         .startProcessAsync("order-process", JsonObject.empty, Some("order-1"), None, None)
                         .flip
          c8Calls   <- c8Service.calls.get
        yield assertTrue(
          error == landedInRunningInstance,
          c8Calls.isEmpty
        )
      },
      test("the same with C8 first - a 409 of C8 is the answer, C7 is not tried") {
        for
          c8Service <- MockProcessInstanceService.make(EngineType.C8, Left(landedInRunningInstance))
          c7Service <- MockProcessInstanceService.make(EngineType.C7, Right("c7-new-instance"))
          gService   = GProcessInstanceService(using Seq(c8Service, c7Service))
          error     <- gService
                         .startProcessAsync("order-process", JsonObject.empty, Some("order-1"), None, None)
                         .flip
          c7Calls   <- c7Service.calls.get
        yield assertTrue(
          error == landedInRunningInstance,
          c7Calls.isEmpty
        )
      },
      test("a 404 of the first engine falls through to the second one") {
        for
          c7Service <- MockProcessInstanceService.make(
                         EngineType.C7,
                         Left(EngineError.ServiceRequestError(404, "C7: process definition 'order-process' not found"))
                       )
          c8Service <- MockProcessInstanceService.make(EngineType.C8, Right("c8-new-instance"))
          gService   = GProcessInstanceService(using Seq(c7Service, c8Service))
          info      <- gService.startProcessAsync("order-process", JsonObject.empty, Some("order-1"), None, None)
          c8Calls   <- c8Service.calls.get
        yield assertTrue(
          info.engineType == EngineType.C8,
          c8Calls == List("order-process")
        )
      }
    ),
    // the stop on 409 is in the shared fall-through - it holds for the other operations too
    suite("sendMessage")(
      test("a 409 of the engine the key is routed to is the answer - the other engine is not tried") {
        for
          c7Service <- MockMessageService.make(EngineType.C7, Right("c7-execution"))
          c8Service <- MockMessageService.make(EngineType.C8, Left(alreadyPublished))
          gService   = GMessageService(using Seq(c7Service, c8Service))
          uuidKey   <- newUuidKey
          error     <- gService.sendMessage("order-paid", processInstanceId = Some(uuidKey)).flip
          c7Calls   <- c7Service.calls.get
          c8Calls   <- c8Service.calls.get
        yield assertTrue(
          error == alreadyPublished,
          c8Calls == List("order-paid"),
          c7Calls.isEmpty
        )
      },
      test("a 409 of the engine the cache points to is the answer - the other engine is not tried") {
        for
          c7Service <- MockMessageService.make(EngineType.C7, Left(alreadyPublished))
          c8Service <- MockMessageService.make(EngineType.C8, Right("c8-execution"))
          gService   = GMessageService(using Seq(c8Service, c7Service))
          // C8 is first in the list - the cache entry sends it to C7 first
          cachedKey <- newBusinessKey
          _         <- ZIO.succeed(EngineCache.updateCache(cachedKey, EngineType.C7))
          error     <- gService.sendMessage("order-paid", businessKey = Some(cachedKey)).flip
          c7Calls   <- c7Service.calls.get
          c8Calls   <- c8Service.calls.get
        yield assertTrue(
          error == alreadyPublished,
          c7Calls == List("order-paid"),
          c8Calls.isEmpty
        )
      },
      test("a 409 writes nothing to the cache") {
        for
          key       <- newBusinessKey
          c7Service <- MockMessageService.make(EngineType.C7, Left(alreadyPublished))
          // a success would cache its result id - here the key itself
          c8Service <- MockMessageService.make(EngineType.C8, Right(key))
          gService   = GMessageService(using Seq(c7Service, c8Service))
          _         <- gService.sendMessage("order-paid", businessKey = Some(key)).flip
        yield assertTrue(EngineCache.getIfPresent(key).isEmpty)
      },
      test("a 404 of the first engine still falls through") {
        for
          c7Service <- MockMessageService.make(EngineType.C7, Right("c7-execution"))
          c8Service <- MockMessageService.make(
                         EngineType.C8,
                         Left(EngineError.ServiceRequestError(404, "C8: no subscription"))
                       )
          gService   = GMessageService(using Seq(c7Service, c8Service))
          uuidKey   <- newUuidKey
          result    <- gService.sendMessage("order-paid", processInstanceId = Some(uuidKey))
          c7Calls   <- c7Service.calls.get
        yield assertTrue(
          result.id == "c7-execution",
          c7Calls == List("order-paid")
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
          !isFinalAnswer(EngineError.ProcessError("connection refused")),
          // only a ServiceRequestError carries a status - a 409 in the text of another error is none
          !isFinalAnswer(EngineError.ProcessError("C7: 409 Conflict"))
        )
      }
    )
  )
end GatewayFallThroughTest
