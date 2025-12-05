package orchescala.gateway

import io.circe.Json as CirceJson
import io.circe.syntax.*
import orchescala.domain.{CamundaVariable, GeneralVariables, IdentityCorrelation, InputParams}
import orchescala.engine.AuthContext
import orchescala.engine.services.*
import sttp.capabilities.WebSockets
import sttp.capabilities.zio.ZioStreams
import sttp.tapir.server.ziohttp.{ZioHttpInterpreter, ZioHttpServerOptions}
import sttp.tapir.ztapir.*
import zio.*
import zio.http.*

object GatewayRoutes:
  
  def routes(
      processInstanceService: ProcessInstanceService,
      userTaskService: UserTaskService,
      signalService: SignalService,
      messageService: MessageService,
      historicVariableService: HistoricVariableService,
      config: GatewayConfig
  ): Routes[Any, Response] =

    val startProcessEndpoint: ZServerEndpoint[Any, ZioStreams & WebSockets] =
      ProcessInstanceEndpoints.startProcessAsync.zServerSecurityLogic { token =>
        config.validateToken(token).mapError(ErrorResponse.fromOrchescalaError)
      }.serverLogic:
        validatedToken => // validatedToken is the String token returned from security logic
          (processDefId, businessKeyQuery, tenantIdQuery, in) =>
            
            config.extractCorrelation(validatedToken, in)
              .flatMap: identityCorrelation =>
                // Set the bearer token in AuthContext so it can be used by the engine services
                AuthContext.withBearerToken(validatedToken):
                  processInstanceService
                    .startProcessAsync(
                      processDefId = processDefId,
                      in = in,
                      businessKey = businessKeyQuery,
                      tenantId = tenantIdQuery,
                      identityCorrelation = Some(identityCorrelation)
                    )
              .mapError(ErrorResponse.fromOrchescalaError)

    val getProcessVariablesEndpoint: ZServerEndpoint[Any, ZioStreams & WebSockets] =
      ProcessInstanceEndpoints.getProcessVariables.zServerSecurityLogic: token =>
        config.validateToken(token).mapError(ErrorResponse.fromOrchescalaError)
      .serverLogic: validatedToken =>
        (processInstanceId, variableFilter) =>
          // Set the bearer token in AuthContext so it can be used by the engine services
          AuthContext.withBearerToken(validatedToken):
            historicVariableService
              .getVariables(
                variableName = None,
                processInstanceId = Some(processInstanceId),
                variableFilter = variableFilter.map(_.split(",").map(_.trim).toSeq)
              )
              .map: variables =>
                CirceJson.obj(variables.map(v =>
                  v.name -> v.value.map(_.toJson).getOrElse(CirceJson.Null)
                )*)
              .mapError(ErrorResponse.fromOrchescalaError)

    // same as getProcessVariablesEndpoint, but with processDefinitionKey as path parameter for API documentation
    val getProcessVariablesEndpointForApi: ZServerEndpoint[Any, ZioStreams & WebSockets] =
      ProcessInstanceEndpoints.getProcessVariablesForApi.zServerSecurityLogic: token =>
        config.validateToken(token).mapError(ErrorResponse.fromOrchescalaError)
      .serverLogic: validatedToken =>
        (
            processDefinitionKey,
            processInstanceId,
            variableFilter
        ) => // processDefinitionKey is not used
          // Set the bearer token in AuthContext so it can be used by the engine services
          AuthContext.withBearerToken(validatedToken):
            historicVariableService
              .getVariables(
                variableName = None,
                processInstanceId = Some(processInstanceId),
                variableFilter = variableFilter.map(_.split(",").map(_.trim).toSeq)
              )
              .map: variables =>
                CirceJson.obj(variables.map(v =>
                  v.name -> v.value.map(_.toJson).getOrElse(CirceJson.Null)
                )*)
              .mapError(ErrorResponse.fromOrchescalaError)

    val getUserTaskVariablesEndpoint: ZServerEndpoint[Any, ZioStreams & WebSockets] =
      UserTaskEndpoints
        .getUserTaskVariables.zServerSecurityLogic: token =>
          config.validateToken(token).mapError(ErrorResponse.fromOrchescalaError)
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
                .mapError(ErrorResponse.fromOrchescalaError)

    def completeTask(validatedToken: String, userTaskId: String, in: JsonObject) =
      config
        .extractCorrelation(validatedToken, in)
        .flatMap: identityCorrelation =>
          // Set the bearer token in AuthContext so it can be used by the engine services
          AuthContext.withBearerToken(validatedToken):
            userTaskService
              .complete(userTaskId, in, Some(identityCorrelation))
        .mapError(ErrorResponse.fromOrchescalaError)

    val completeUserTaskEndpoint: ZServerEndpoint[Any, ZioStreams & WebSockets] =
      UserTaskEndpoints.completeUserTask.zServerSecurityLogic: token =>
        config.validateToken(token).mapError(ErrorResponse.fromOrchescalaError)
      .serverLogic: validatedToken =>
        (userTaskId, in) =>
          completeTask(validatedToken, userTaskId, in)

    val completeUserTaskEndpointForApi: ZServerEndpoint[Any, ZioStreams & WebSockets] =
      UserTaskEndpoints.completeUserTaskForApi.zServerSecurityLogic: token =>
        config.validateToken(token).mapError(ErrorResponse.fromOrchescalaError)
      .serverLogic: validatedToken =>
        (_, userTaskId, variables) => // taskDefinitionKey is not used - just for API documentation
          completeTask(validatedToken, userTaskId, variables)

    val sendSignalEndpoint: ZServerEndpoint[Any, ZioStreams & WebSockets] =
      SignalEndpoints.sendSignal.zServerSecurityLogic: token =>
        config.validateToken(token).mapError(ErrorResponse.fromOrchescalaError)
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
              .mapError(ErrorResponse.fromOrchescalaError)

    val sendMessageEndpoint: ZServerEndpoint[Any, ZioStreams & WebSockets] =
      MessageEndpoints.sendMessage.zServerSecurityLogic: token =>
        config.validateToken(token).mapError(ErrorResponse.fromOrchescalaError)
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
              .mapError(ErrorResponse.fromOrchescalaError)

    ZioHttpInterpreter(ZioHttpServerOptions.default).toHttp(
      List(
        startProcessEndpoint,
        getProcessVariablesEndpoint,
        getProcessVariablesEndpointForApi,
        getUserTaskVariablesEndpoint,
        completeUserTaskEndpoint,
        completeUserTaskEndpointForApi,
        sendSignalEndpoint,
        sendMessageEndpoint
      )
    )


  end routes


end GatewayRoutes
