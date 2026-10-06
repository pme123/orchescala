package orchescala.gateway

import orchescala.engine.AuthContext
import orchescala.engine.services.*
import orchescala.gateway.GatewayError.ServiceRequestError
import sttp.capabilities.WebSockets
import sttp.capabilities.zio.ZioStreams
import sttp.tapir.ztapir.*
import zio.*

case class MessageRoutes(
    messageService: MessageService
)(using config: GatewayConfig):

  lazy val routes: List[ZServerEndpoint[Any, ZioStreams & WebSockets]] =
    List(sendMessageEndpoint)

  private lazy val sendMessageEndpoint: ZServerEndpoint[Any, ZioStreams & WebSockets] =
    MessageEndpoints.sendMessage.zServerSecurityLogic: token =>
      config.validateToken(token).mapError(ServiceRequestError.apply)
    .serverLogic: validatedToken =>
      (messageName, tenantId, timeToLiveInSec, businessKey, processInstanceId, variables) =>
        send(validatedToken, messageName, tenantId, timeToLiveInSec, businessKey, processInstanceId, variables)

  /** Sends the message with the (validated) token - also for a public one ([[PublicRoutes]]). */
  private[gateway] def send(
      validatedToken: String,
      messageName: String,
      tenantId: Option[String],
      timeToLiveInSec: Option[Int],
      businessKey: Option[String],
      processInstanceId: Option[String],
      variables: Option[io.circe.JsonObject]
  ): IO[ServiceRequestError, orchescala.engine.domain.MessageCorrelationResult] =
    // Set the bearer token in AuthContext so it can be used by the engine services
    AuthContext.withBearerToken(validatedToken):
      messageService
        .sendMessage(
          name = messageName,
          tenantId = tenantId,
          timeToLiveInSec = timeToLiveInSec,
          businessKey = businessKey,
          processInstanceId = processInstanceId,
          variables = variables
        )
        .mapError(ServiceRequestError.apply)
  end send

end MessageRoutes
