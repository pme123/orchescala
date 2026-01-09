package orchescala.gateway

import io.circe.Json as CirceJson
import io.circe.syntax.*
import orchescala.domain.{CamundaVariable, GeneralVariables, IdentityCorrelation, InputParams}
import orchescala.engine.AuthContext
import orchescala.engine.rest.HttpClientProvider
import orchescala.engine.services.*
import orchescala.gateway.GatewayError.{ServiceRequestError, UnexpectedError}
import sttp.capabilities.WebSockets
import sttp.capabilities.zio.ZioStreams
import sttp.tapir.server.ziohttp.{ZioHttpInterpreter, ZioHttpServerOptions}
import sttp.tapir.ztapir.*
import zio.*
import zio.http.*

object ProcessInstanceRoutes:

  def routes(
      processInstanceService: ProcessInstanceService,
      historicVariableService: HistoricVariableService
  )(using config: GatewayConfig): List[ZServerEndpoint[Any, ZioStreams & WebSockets]] =

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
                  validateInput(
                    processDefId = processDefId,
                    in = in,
                    token = validatedToken
                  ) *>
                    processInstanceService
                      .startProcessAsync(
                        processDefId = processDefId,
                        in = in,
                        businessKey = businessKeyQuery,
                        tenantId = tenantIdQuery,
                        identityCorrelation = Some(identityCorrelation)
                      )
              .mapError(ErrorResponse.fromOrchescalaError)

    val startProcessByMessageEndpoint: ZServerEndpoint[Any, ZioStreams & WebSockets] =
      ProcessInstanceEndpoints.startProcessByMessage.zServerSecurityLogic { token =>
        config.validateToken(token).mapError(ErrorResponse.fromOrchescalaError)
      }.serverLogic: validatedToken =>
        (messageName, businessKeyQuery, tenantIdQuery, in) =>
          config.extractCorrelation(validatedToken, in)
            .flatMap: identityCorrelation =>
              // Set the bearer token in AuthContext so it can be used by the engine services
              AuthContext.withBearerToken(validatedToken):
                validateInput(
                  processDefId = messageName,
                  in = in,
                  token = validatedToken
                ) *>
                  processInstanceService
                    .startProcessByMessage(
                      messageName = messageName,
                      businessKey = businessKeyQuery,
                      tenantId = tenantIdQuery,
                      variables = Some(in),
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
                  v.name -> v.value.getOrElse(CirceJson.Null)
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
                  v.name -> v.value.getOrElse(CirceJson.Null)
                )*)
              .mapError(ErrorResponse.fromOrchescalaError)

    List(
      startProcessEndpoint,
      startProcessByMessageEndpoint,
      getProcessVariablesEndpoint,
      getProcessVariablesEndpointForApi
    )

  end routes

  // this runs the init worker to validate the input
  // so a process instance needs an InitWorker
  private def validateInput(
      processDefId: String,
      in: JsonObject,
      token: String
  )(using config: GatewayConfig): ZIO[Any, GatewayError, Option[Json]] =
    // Forward request to the init worker
    WorkerRoutes.forwardWorkerRequest(processDefId, in.asJson, token)
      .provideLayer(HttpClientProvider.live)
      .mapError:
        case ServiceRequestError(errorCode, errorMsg) =>
          ServiceRequestError(500, s"Init worker failed: $errorMsg")
        case err                                      =>
          UnexpectedError(s"Init worker failed: ${err.getMessage}")

end ProcessInstanceRoutes
