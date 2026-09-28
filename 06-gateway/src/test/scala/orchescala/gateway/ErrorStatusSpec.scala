package orchescala.gateway

import orchescala.gateway.GatewayError.ServiceRequestError
import sttp.tapir.server.ziohttp.ZioHttpInterpreter
import sttp.tapir.ztapir.*
import zio.*
import zio.http.*
import zio.test.*

object ErrorStatusSpec extends ZIOSpecDefault:

  /** An endpoint of the gateway that fails with the given error. */
  private def failingWith(error: ServiceRequestError) =
    ZioHttpInterpreter().toHttp(
      EndpointsUtil.baseEndpoint
        .get
        .in("failing")
        .zServerSecurityLogic(token => ZIO.succeed(token))
        .serverLogic(_ => _ => ZIO.fail(error))
    )

  private def statusOf(error: ServiceRequestError) =
    failingWith(error)
      .runZIO(Request.get(URL.decode("/failing").toOption.get).addHeader(Header.Authorization.Bearer("t")))
      .map(_.status.code)

  def spec = suite("The HTTP status of a gateway error")(
    test("401, 400, 404 and 500 as before") {
      for
        unauthorized <- statusOf(ServiceRequestError(401, "token"))
        badRequest   <- statusOf(ServiceRequestError(400, "body"))
        notFound     <- statusOf(ServiceRequestError(404, "id"))
        serverError  <- statusOf(ServiceRequestError(500, "boom"))
      yield assertTrue(unauthorized == 401, badRequest == 400, notFound == 404, serverError == 500)
    },
    test("any other status as it is - a 403 of the engine is no 400") {
      for
        forbidden   <- statusOf(ServiceRequestError(403, "forbidden"))
        conflict    <- statusOf(ServiceRequestError(409, "conflict"))
        unavailable <- statusOf(ServiceRequestError(503, "worker app down"))
        invalid     <- statusOf(ServiceRequestError(0, "no status"))
      yield assertTrue(forbidden == 403, conflict == 409, unavailable == 503, invalid == 500)
    }
  )
end ErrorStatusSpec
