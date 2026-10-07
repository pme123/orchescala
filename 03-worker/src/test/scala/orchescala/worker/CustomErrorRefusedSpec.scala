package orchescala.worker

import orchescala.worker.WorkerError.{CustomError, ServiceRequestError}
import zio.test.*

/** A custom worker that refuses a request - over HTTP its 4xx, not a 500. */
object CustomErrorRefusedSpec extends ZIOSpecDefault:

  def spec = suite("CustomError.refused")(
    test("over HTTP: the status of the refusal"):
      assertTrue(
        ServiceRequestError(CustomError.refused(409, "The slot is taken")) == ServiceRequestError(409, "The slot is taken"),
        ServiceRequestError(CustomError.refused(404, "No such link")).errorCode == 404
      )
    ,
    test("any other CustomError stays a 500 - also with another cause"):
      assertTrue(
        ServiceRequestError(CustomError("boom")).errorCode == 500,
        ServiceRequestError(CustomError("boom", causeError = Some(ServiceRequestError(502, "upstream")))).errorCode == 500
      )
    ,
    test("only a 4xx is a refusal"):
      assertTrue(
        scala.util.Try(CustomError.refused(500, "no")).isFailure,
        scala.util.Try(CustomError.refused(200, "no")).isFailure
      )
  )
end CustomErrorRefusedSpec
