package orchescala.gateway

import io.circe.Json as CirceJson
import orchescala.engine.{AuthContext, EngineConfig}
import orchescala.engine.rest.{HttpClientProvider, WorkerForwardUtil}
import orchescala.engine.services.*
import orchescala.gateway.GatewayError.{ServiceRequestError, UnexpectedError}
import sttp.capabilities.WebSockets
import sttp.capabilities.zio.ZioStreams
import sttp.tapir.ztapir.*
import zio.*

object ProcessInstanceRoutes:

  def routes(
      processInstanceService: ProcessInstanceService,
      historicVariableService: HistoricVariableService
  )(using config: GatewayConfig): List[ZServerEndpoint[Any, ZioStreams & WebSockets]] =

    val startProcessEndpoint: ZServerEndpoint[Any, ZioStreams & WebSockets] =
      ProcessInstanceEndpoints.startProcessAsync.zServerSecurityLogic { token =>
        config.validateToken(token).mapError(ServiceRequestError.apply)
      }.serverLogic:
        validatedToken => // validatedToken is the String token returned from security logic
          (processDefId, businessKeyQuery, tenantIdQuery, in) =>
            config.extractCorrelation(validatedToken, in)
              .mapError(ServiceRequestError.apply)
              .flatMap: identityCorrelation =>
                // Set the bearer token in AuthContext so it can be used by the engine services
                AuthContext.withBearerToken(validatedToken):
                  initProcess(
                    processDefId = processDefId,
                    in = in,
                    token = validatedToken
                  ).mapError(ServiceRequestError.apply)
                    .flatMap: inJson =>
                      processInstanceService
                        .startProcessAsync(
                          processDefId = processDefId,
                          in = inJson.flatMap(_.asObject).getOrElse(JsonObject()),
                          businessKey = businessKeyQuery,
                          tenantId = tenantIdQuery,
                          identityCorrelation = Some(identityCorrelation)
                        )
                        .mapError(ServiceRequestError.apply)

    val startProcessByMessageEndpoint: ZServerEndpoint[Any, ZioStreams & WebSockets] =
      ProcessInstanceEndpoints.startProcessByMessage.zServerSecurityLogic { token =>
        config.validateToken(token).mapError(ServiceRequestError.apply)
      }.serverLogic: validatedToken =>
        (messageName, businessKeyQuery, tenantIdQuery, in) =>
          config.extractCorrelation(validatedToken, in)
            .mapError(ServiceRequestError.apply)
            .flatMap: identityCorrelation =>
              // Set the bearer token in AuthContext so it can be used by the engine services
              AuthContext.withBearerToken(validatedToken):
                initProcess(
                  processDefId = messageName,
                  in = in,
                  token = validatedToken
                ).mapError(ServiceRequestError.apply)
                  .flatMap: inJson =>
                    processInstanceService
                      .startProcessByMessage(
                        messageName = messageName,
                        businessKey = businessKeyQuery,
                        tenantId = tenantIdQuery,
                        variables = inJson.flatMap(_.asObject),
                        identityCorrelation = Some(identityCorrelation)
                      ).mapError(ServiceRequestError.apply)

    val getProcessVariablesEndpoint: ZServerEndpoint[Any, ZioStreams & WebSockets] =
      ProcessInstanceEndpoints.getProcessVariables.zServerSecurityLogic: token =>
        config.validateToken(token).mapError(ServiceRequestError.apply)
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
                  v.name -> v.value.getOrElse(CirceJson.Null)
                )*)
              .mapError(ServiceRequestError.apply)

    // same as getProcessVariablesEndpoint, but with processDefinitionKey as path parameter for API documentation
    val getProcessVariablesEndpointForApi: ZServerEndpoint[Any, ZioStreams & WebSockets] =
      ProcessInstanceEndpoints.getProcessVariablesForApi.zServerSecurityLogic: token =>
        config.validateToken(token).mapError(ServiceRequestError.apply)
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
                  v.name -> v.value.getOrElse(CirceJson.Null)
                )*)
              .mapError(ServiceRequestError.apply)

    List(
      startProcessEndpoint,
      startProcessByMessageEndpoint,
      getProcessVariablesEndpoint,
      getProcessVariablesEndpointForApi
    )

  end routes

  // this runs the init worker to validate the input
  // so a process instance needs an InitWorker
  private def initProcess(
      processDefId: String,
      in: JsonObject,
      token: String
  )(using gatewayConfig: GatewayConfig): ZIO[Any, GatewayError, Option[Json]] =
    given config: EngineConfig = gatewayConfig.engineConfig
      // Forward request to the init worker
      WorkerForwardUtil.forwardWorkerRequest(processDefId, in.asJson, token)
        .provideLayer(HttpClientProvider.live)
        .mapError:
          case ServiceRequestError(errorCode, errorMsg) =>
            ServiceRequestError(500, s"Init worker failed: $errorMsg")
          case err                                      =>
            UnexpectedError(s"Init worker failed: ${err.getMessage}")

end ProcessInstanceRoutes
