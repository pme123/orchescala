package orchescala.gateway

import orchescala.engine.AuthContext
import orchescala.engine.services.*
import orchescala.gateway.GatewayError.ServiceRequestError
import sttp.capabilities.WebSockets
import sttp.capabilities.zio.ZioStreams
import sttp.tapir.server.ziohttp.{ZioHttpInterpreter, ZioHttpServerOptions}
import sttp.tapir.ztapir.*
import zio.*
import zio.http.*

case class SignalRoutes(
    signalService: SignalService
)(using config: GatewayConfig):

  lazy val routes: List[ZServerEndpoint[Any, ZioStreams & WebSockets]] =
    List(sendSignalEndpoint)

  private lazy val sendSignalEndpoint: ZServerEndpoint[Any, ZioStreams & WebSockets] =
    SignalEndpoints.sendSignal.zServerSecurityLogic: token =>
      config.validateToken(token).mapError(ServiceRequestError.apply)
    .serverLogic: validatedToken =>
      (signalName, tenantId, variables) =>
        // Set the bearer token in AuthContext so it can be used by the engine services
        AuthContext.withBearerToken(validatedToken):
          signalService
            .sendSignal(
              name = signalName,
              tenantId = tenantId,
              variables = variables
            )
            .mapError(ServiceRequestError.apply)

end SignalRoutes
