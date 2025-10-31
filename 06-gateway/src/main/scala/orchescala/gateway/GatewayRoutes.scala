package orchescala.gateway

import io.circe.Json as CirceJson
import io.circe.syntax.*
import orchescala.domain.CamundaVariable
import orchescala.engine.AuthContext
import orchescala.engine.domain.EngineError
import orchescala.engine.services.*
import sttp.capabilities.WebSockets
import sttp.capabilities.zio.ZioStreams
import sttp.tapir.server.ziohttp.{ZioHttpInterpreter, ZioHttpServerOptions}
import sttp.tapir.ztapir.*
import zio.*
import zio.http.*

object GatewayRoutes:

  /** Creates HTTP routes from the tapir endpoints using the provided services.
    *
    * @param processInstanceService
    *   The service to handle process instance operations
    * @param userTaskService
    *   The service to handle user task operations
    * @param signalService
    *   The service to handle signal operations
    * @param messageService
    *   The service to handle message operations
    * @param validateToken
    *   Function to validate the bearer token. Returns Right(token) if valid, Left(EngineError) if
    *   invalid.
    * @return
    *   ZIO HTTP routes
    */
  def routes(
      processInstanceService: ProcessInstanceService,
      userTaskService: UserTaskService,
      signalService: SignalService,
      messageService: MessageService,
      validateToken: String => IO[EngineError, String]
  ): Routes[Any, Response] =
    val startProcessEndpoint: ZServerEndpoint[Any, ZioStreams & WebSockets] =
      ProcessInstanceEndpoints.startProcessAsync.zServerSecurityLogic { token =>
        validateToken(token).mapError(ErrorResponse.fromEngineError)
      }.serverLogic {
        validatedToken => // validatedToken is the String token returned from security logic
          (processDefId, businessKeyQuery, tenantIdQuery, request) =>
            // Set the bearer token in AuthContext so it can be used by the engine services
            AuthContext.withBearerToken(validatedToken):
              processInstanceService
                .startProcessAsync(
                  processDefId = processDefId,
                  in = request,
                  businessKey = businessKeyQuery,
                  tenantId = tenantIdQuery
                )
                .mapError(ErrorResponse.fromEngineError)
      }

    val getUserTaskVariablesEndpoint: ZServerEndpoint[Any, ZioStreams & WebSockets] =
      UserTaskEndpoints
        .getUserTaskVariables.zServerSecurityLogic: token =>
          validateToken(token).mapError(ErrorResponse.fromEngineError)
        .serverLogic: validatedToken =>
          (processInstanceId, userTaskDefId, variableFilter, timeoutInSec) =>
            // Set the bearer token in AuthContext so it can be used by the engine services
            AuthContext.withBearerToken(validatedToken):
              userTaskService
                .getUserTaskVariables(
                  processInstanceId,
                  userTaskDefId,
                  variableFilter,
                  timeoutInSec
                )
                .mapError(ErrorResponse.fromEngineError)

    val completeUserTaskEndpoint: ZServerEndpoint[Any, ZioStreams & WebSockets] =
      UserTaskEndpoints.completeUserTask.zServerSecurityLogic: token =>
        validateToken(token).mapError(ErrorResponse.fromEngineError)
      .serverLogic: validatedToken =>
        (processInstanceId, userTaskId, variables) =>
          // Set the bearer token in AuthContext so it can be used by the engine services
          AuthContext.withBearerToken(validatedToken):
            // Convert JSON to Map[String, CamundaVariable]
            val camundaVariables = CamundaVariable.jsonToCamundaValue(variables) match
              case m: Map[?, ?] => m.asInstanceOf[Map[String, CamundaVariable]]
              case _            => Map.empty[String, CamundaVariable]

            userTaskService
              .complete(userTaskId, camundaVariables)
              .mapError(ErrorResponse.fromEngineError)

    val completeUserTaskEndpointForApi: ZServerEndpoint[Any, ZioStreams & WebSockets] =
      UserTaskEndpoints.completeUserTaskForApi.zServerSecurityLogic: token =>
        validateToken(token).mapError(ErrorResponse.fromEngineError)
      .serverLogic: validatedToken =>
        (processInstanceId, userTaskDefId, userTaskId, variables) =>
          // Set the bearer token in AuthContext so it can be used by the engine services
          AuthContext.withBearerToken(validatedToken):
            // Convert JSON to Map[String, CamundaVariable]
            val camundaVariables = CamundaVariable.jsonToCamundaValue(variables) match
              case m: Map[?, ?] => m.asInstanceOf[Map[String, CamundaVariable]]
              case _            => Map.empty[String, CamundaVariable]

            userTaskService
              .complete(userTaskId, camundaVariables)
              .mapError(ErrorResponse.fromEngineError)

    val sendSignalEndpoint: ZServerEndpoint[Any, ZioStreams & WebSockets] =
      SignalEndpoints.sendSignal.zServerSecurityLogic: token =>
        validateToken(token).mapError(ErrorResponse.fromEngineError)
      .serverLogic: validatedToken =>
        (signalName, tenantId, variables) =>
          // Set the bearer token in AuthContext so it can be used by the engine services
          AuthContext.withBearerToken(validatedToken):
            // Convert JSON to Map[String, CamundaVariable]
            val camundaVariables = CamundaVariable.jsonToCamundaValue(variables) match
              case m: Map[?, ?] => m.asInstanceOf[Map[String, CamundaVariable]]
              case _            => Map.empty[String, CamundaVariable]

            signalService
              .sendSignal(
                name = signalName,
                tenantId = tenantId,
                variables = Some(camundaVariables)
              )
              .mapError(ErrorResponse.fromEngineError)

    val sendMessageEndpoint: ZServerEndpoint[Any, ZioStreams & WebSockets] =
      MessageEndpoints.sendMessage.zServerSecurityLogic: token =>
        validateToken(token).mapError(ErrorResponse.fromEngineError)
      .serverLogic: validatedToken =>
        (messageName, tenantId, timeToLiveInSec, businessKey, processInstanceId, variables) =>
          // Set the bearer token in AuthContext so it can be used by the engine services
          AuthContext.withBearerToken(validatedToken):
            // Convert JSON to Map[String, CamundaVariable]
            val camundaVariables = CamundaVariable.jsonToCamundaValue(variables) match
              case m: Map[?, ?] => m.asInstanceOf[Map[String, CamundaVariable]]
              case _            => Map.empty[String, CamundaVariable]

            messageService
              .sendMessage(
                name = messageName,
                tenantId = tenantId,
                timeToLiveInSec = timeToLiveInSec,
                businessKey = businessKey,
                processInstanceId = processInstanceId,
                variables = Some(camundaVariables)
              )
              .mapError(ErrorResponse.fromEngineError)

    ZioHttpInterpreter(ZioHttpServerOptions.default).toHttp(
      List(
        startProcessEndpoint,
        getUserTaskVariablesEndpoint,
        completeUserTaskEndpoint,
        completeUserTaskEndpointForApi,
        sendSignalEndpoint,
        sendMessageEndpoint
      )
    )
  end routes

  /** Default token validator - validates that token is not empty and returns the token. Override
    * this with your own validation logic (e.g., JWT validation, database lookup, etc.)
    */
  def defaultTokenValidator(token: String): IO[EngineError, String] =
    if token.nonEmpty then
      ZIO.succeed(token)
    else
      ZIO.fail(EngineError.UnexpectedError(
        errorMsg = "Invalid or missing authentication token"
      ))

end GatewayRoutes
