package orchescala.gateway

import io.circe.syntax.*
import orchescala.engine.AuthContext
import orchescala.engine.services.*
import orchescala.gateway.GatewayError.ServiceRequestError
import sttp.capabilities.WebSockets
import sttp.capabilities.zio.ZioStreams
import sttp.tapir.server.ziohttp.{ZioHttpInterpreter, ZioHttpServerOptions}
import sttp.tapir.ztapir.*
import zio.*
import zio.http.*

case class UserTaskRoutes(
    userTaskService: UserTaskService
)(using config: GatewayConfig):

  lazy val routes: List[ZServerEndpoint[Any, ZioStreams & WebSockets]] =
    List(
      getUserTaskVariablesEndpoint,
      completeUserTaskEndpoint,
      completeUserTaskEndpointForApi
    )
  
  private lazy val getUserTaskVariablesEndpoint: ZServerEndpoint[Any, ZioStreams & WebSockets] =
    UserTaskEndpoints
      .getUserTaskVariables.zServerSecurityLogic: token =>
        config.validateToken(token).mapError(ServiceRequestError.apply)
      .serverLogic: validatedToken =>
        (processInstanceId, taskDefinitionKey, variableFilter, timeoutInSec) =>
          // Set the bearer token in AuthContext so it can be used by the engine services
          AuthContext.withBearerToken(validatedToken):
            userTaskService
              .getUserTaskVariables(
                processInstanceId,
                taskDefinitionKey,
                variableFilter,
                timeoutInSec
              )
              .mapError(ServiceRequestError.apply)

  private lazy val completeUserTaskEndpoint: ZServerEndpoint[Any, ZioStreams & WebSockets] =
    UserTaskEndpoints.completeUserTask.zServerSecurityLogic: token =>
      config.validateToken(token).mapError(ServiceRequestError.apply)
    .serverLogic: validatedToken =>
      (userTaskId, in) =>
        completeTask(validatedToken, userTaskId, in)

  private lazy val completeUserTaskEndpointForApi: ZServerEndpoint[Any, ZioStreams & WebSockets] =
    UserTaskEndpoints.completeUserTaskForApi.zServerSecurityLogic: token =>
      config.validateToken(token).mapError(ServiceRequestError.apply)
    .serverLogic: validatedToken =>
      (_, userTaskId, variables) => // taskDefinitionKey is not used - just for API documentation
        completeTask(validatedToken, userTaskId, variables)

  private def completeTask(validatedToken: String, userTaskId: String, in: JsonObject) =
    config
      .extractCorrelation(validatedToken, in)
      .mapError(ServiceRequestError.apply)
      .flatMap: identityCorrelation =>
        // Set the bearer token in AuthContext so it can be used by the engine services
        AuthContext.withBearerToken(validatedToken):
          userTaskService
            .complete(userTaskId, in, Some(identityCorrelation))
            .mapError(ServiceRequestError.apply)

end UserTaskRoutes
