package orchescala.worker

import orchescala.domain.*
import orchescala.engine.DefaultEngineConfig
import orchescala.worker.WorkerError.{CustomError, ServiceRequestError}
import zio.*
import zio.http.*
import zio.test.*

/** A custom worker that refuses a request - over HTTP its 4xx, not a 500. */
object CustomErrorRefusedSpec extends ZIOSpecDefault:

  object ReserveTask extends BpmnCustomTaskDsl:
    val topicName     = "test-refused-reserve"
    val descr: String = "Refuses with the status of its input."

    case class In(status: Int = 409)
    object In:
      given ApiSchema[In]  = deriveApiSchema
      given InOutCodec[In] = deriveInOutCodec

    case class Out(ok: Boolean = true)
    object Out:
      given ApiSchema[Out]  = deriveApiSchema
      given InOutCodec[Out] = deriveInOutCodec

    lazy val example = customTask(In(), Out())
  end ReserveTask

  /** Refuses with `status` - or fails with a plain CustomError for 0. */
  class ReserveWorker extends CustomWorkerDsl[ReserveTask.In, ReserveTask.Out]:
    lazy val customTask = ReserveTask.example
    override def runWork(in: ReserveTask.In): Either[CustomError, ReserveTask.Out] =
      if in.status == 0 then Left(CustomError("boom")) else Left(CustomError.refused(in.status, "The slot is taken"))

  /** POST /worker/test-refused-reserve - the status of the answer. */
  private def call(status: Int) =
    val routes  = WorkerRoutes(
      DefaultEngineContext.example.copy(workerConfig = DefaultWorkerConfig(DefaultEngineConfig()))
    ).routes(Set(ReserveWorker()))
    val request = Request
      .post(URL.decode("/worker/test-refused-reserve").toOption.get, Body.fromString(s"""{"status":$status}"""))
      .addHeader(Header.Authorization.Bearer("a-token"))
    ZIO.scoped(routes.runZIO(request)).map(_.status.code)

  def spec = suite("CustomError.refused")(
    test("through /worker/{topic}: the 4xx of the refusal, a 500 for any other CustomError"):
      for
        taken  <- call(409)
        gone   <- call(404)
        failed <- call(0)
        other  <- call(422)
      yield assertTrue(taken == 409, gone == 404, failed == 500, other == 422)
    ,
    test("over HTTP: the status of the refusal"):
      assertTrue(
        ServiceRequestError(CustomError.refused(409, "The slot is taken")) == ServiceRequestError(409, "The slot is taken"),
        ServiceRequestError(CustomError.refused(404, "No such link")).errorCode == 404
      )
    ,
    test("any other CustomError stays a 500 - also with a 4xx cause not made by refused"):
      assertTrue(
        ServiceRequestError(CustomError("boom")).errorCode == 500,
        ServiceRequestError(CustomError("boom", causeError = Some(ServiceRequestError(502, "upstream")))).errorCode == 500,
        // e.g. a failed call to another service - its 401 / 404 is not the caller's refusal
        ServiceRequestError(CustomError("upstream", causeError = Some(ServiceRequestError(401, "no token")))).errorCode == 500,
        ServiceRequestError(CustomError("upstream", causeError = Some(ServiceRequestError(404, "not found")))).errorCode == 500
      )
    ,
    test("a status that is no 4xx - a plain CustomError (500), no exception"):
      assertTrue(
        ServiceRequestError(CustomError.refused(500, "no")).errorCode == 500,
        ServiceRequestError(CustomError.refused(200, "no")).errorCode == 500,
        CustomError.refused(503, "no") == CustomError("no")
      )
  )
end CustomErrorRefusedSpec
