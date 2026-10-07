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
      if in.status == 0 then Left(CustomError("boom"))
      else Left(CustomError.refused(in.status, "The slot is taken"))

  /** POST /worker/test-refused-reserve - the status and the error code in the body. */
  private def call(status: Int) =
    val routes  = WorkerRoutes(
      DefaultEngineContext.example.copy(workerConfig = DefaultWorkerConfig(DefaultEngineConfig()))
    ).routes(Set(ReserveWorker()))
    val request = Request
      .post(
        URL.decode("/worker/test-refused-reserve").toOption.get,
        Body.fromString(s"""{"status":$status}""")
      )
      .addHeader(Header.Authorization.Bearer("a-token"))
    ZIO.scoped:
      for
        response <- routes.runZIO(request)
        body     <- response.body.asString
        code      = io.circe.parser.parse(body).toOption.flatMap(_.hcursor.get[Int]("errorCode").toOption)
      yield response.status.code -> code

  private def codeOf(error: CustomError) = ServiceRequestError(error).errorCode

  def spec = suite("CustomError.refused")(
    test("through /worker/{topic}: the 4xx of the refusal, a 500 for any other CustomError"):
      for
        taken      <- call(409)
        gone       <- call(404)
        invalid    <- call(422) // a 4xx without a variant of its own
        failed     <- call(0)
        notRefusal <- call(503) // refused with a status that is no 4xx - a plain CustomError
      yield assertTrue(
        taken == (409 -> Some(409)),
        gone == (404 -> Some(404)),
        invalid == (422 -> Some(422)),
        failed == (500 -> Some(500)),
        notRefusal == (500 -> Some(500))
      )
    ,
    test("the HTTP status of the default variant: a 4xx as it is, any other code 400 as before"):
      assertTrue(
        WorkerEndpoints.httpStatus(ServiceRequestError(409, "x")).code == 409,
        WorkerEndpoints.httpStatus(ServiceRequestError(418, "x")).code == 418,
        WorkerEndpoints.httpStatus(ServiceRequestError(429, "x")).code == 429,
        WorkerEndpoints.httpStatus(ServiceRequestError(0, "x")).code == 400,
        // an auth status of a failed call inside the worker - not the caller's token
        WorkerEndpoints.httpStatus(ServiceRequestError(407, "x")).code == 400,
        WorkerEndpoints.httpStatus(ServiceRequestError(302, "x")).code == 400
      )
    ,
    test("any other CustomError stays a 500 - also with a 4xx cause not made by refused"):
      assertTrue(
        ServiceRequestError(CustomError("boom")).errorCode == 500,
        codeOf(CustomError("boom", causeError = Some(ServiceRequestError(502, "upstream")))) == 500,
        // e.g. a failed call to another service - its 401 / 404 is not the caller's refusal
        codeOf(CustomError("upstream", causeError = Some(ServiceRequestError(401, "no token")))) == 500,
        codeOf(CustomError("upstream", causeError = Some(ServiceRequestError(404, "not found")))) == 500
      )
    ,
    test("a status that is no 4xx, or an auth status - a plain CustomError (500), no exception"):
      assertTrue(
        ServiceRequestError(CustomError.refused(500, "no")).errorCode == 500,
        ServiceRequestError(CustomError.refused(200, "no")).errorCode == 500,
        CustomError.refused(503, "no") == CustomError("no"),
        // the auth statuses belong to the token check
        List(401, 403, 407).forall(status => CustomError.refused(status, "no") == CustomError("no"))
      )
    ,
    test("logged once - the cause names only the status"):
      val refused = CustomError.refused(409, "The slot is taken")
      assertTrue(
        refused.toString.contains("The slot is taken"),
        refused.causeError.exists(c => !c.toString.contains("The slot is taken"))
      )
    ,
    test("the status survives a copy of the error (e.g. with generalVariables)"):
      val refused = CustomError.refused(409, "The slot is taken").copy(generalVariables = Some(GeneralVariables()))
      assertTrue(codeOf(refused) == 409)
  )
end CustomErrorRefusedSpec
