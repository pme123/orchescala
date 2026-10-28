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
    actorIdentity(validatedToken, processInstanceId, variables).flatMap: identityCorrelation =>
      // Set the bearer token in AuthContext so it can be used by the engine services
      AuthContext.withBearerToken(validatedToken):
        messageService
          .sendMessage(
            name = messageName,
            tenantId = tenantId,
            timeToLiveInSec = timeToLiveInSec,
            businessKey = businessKey,
            processInstanceId = processInstanceId,
            variables = variables,
            identityCorrelation = identityCorrelation
          )
          .mapError(ServiceRequestError.apply)
  end send

  /** The sender's identity - only for a message to a named process instance (the engine signs it
    * for that instance, see `withActorIdentityOfMessage`). A token without identity claims sends
    * the message as before, just without it.
    */
  private def actorIdentity(
      validatedToken: String,
      processInstanceId: Option[String],
      variables: Option[io.circe.JsonObject]
  ): UIO[Option[orchescala.domain.IdentityCorrelation]] =
    if processInstanceId.isEmpty then ZIO.none
    else
      config
        .extractCorrelation(validatedToken, variables.getOrElse(io.circe.JsonObject.empty))
        .map(Some(_))
        .catchAll: err =>
          ZIO.logWarning(s"Message without `_identityCorrelationOfActor`: ${err.errorMsg}").as(None)
  end actorIdentity

end MessageRoutes
