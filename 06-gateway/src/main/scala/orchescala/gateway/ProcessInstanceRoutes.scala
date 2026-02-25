package orchescala.gateway

import io.circe.Json as CirceJson
import orchescala.engine.domain.EngineError
import orchescala.engine.{AuthContext, EngineConfig}
import orchescala.engine.rest.{HttpClientProvider, WorkerForwardUtil}
import orchescala.engine.services.*
import orchescala.gateway.GatewayError.{ServiceRequestError, UnexpectedError}
import sttp.capabilities.WebSockets
import sttp.capabilities.zio.ZioStreams
import sttp.tapir.ztapir.*
import zio.*

case class ProcessInstanceRoutes(
                                  processInstanceService: ProcessInstanceService,
                                  historicVariableService: HistoricVariableService
                                )(using config: GatewayConfig):

  lazy val routes: List[ZServerEndpoint[Any, ZioStreams & WebSockets]] =
    List(
      startProcessEndpoint,
      startProcessByMessageEndpoint,
      getProcessVariablesEndpoint,
      getProcessVariablesEndpointForApi
    )
  
  private lazy val startProcessEndpoint: ZServerEndpoint[Any, ZioStreams & WebSockets] =
    ProcessInstanceEndpoints.startProcessAsync.zServerSecurityLogic { token =>
      config.validateToken(token).mapError(ServiceRequestError.apply)
    }.serverLogic:
      validatedToken => // validatedToken is the String token returned from security logic
        (processDefId, businessKeyQuery, tenantIdQuery, in) =>
          ZIO.logDebug(s"Start process $processDefId (${businessKeyQuery.mkString})") *>
            config.extractCorrelation(validatedToken, in)
              .mapError(ServiceRequestError.apply)
              .flatMap: identityCorrelation =>
                // Set the bearer token in AuthContext so it can be used by the engine services
                AuthContext.withBearerToken(validatedToken):
                  for
                    inJson <- initProcess(
                      processDefId = processDefId,
                      in = in,
                      token = validatedToken
                    ).mapError(ServiceRequestError.apply)
                    result <- processInstanceService
                      .startProcessAsync(
                        processDefId = processDefId,
                        in = inJson.asObject.getOrElse(in),
                        businessKey = businessKeyQuery,
                        tenantId = tenantIdQuery,
                        identityCorrelation = Some(identityCorrelation)
                      ).mapError(ServiceRequestError.apply)
                    _ <-
                      ZIO.logInfo(
                        s"Process started: $processDefId (${businessKeyQuery.mkString}) -> ${result.processInstanceId}"
                      )
                  yield result

  private lazy val startProcessByMessageEndpoint: ZServerEndpoint[Any, ZioStreams & WebSockets] =
    ProcessInstanceEndpoints.startProcessByMessage.zServerSecurityLogic { token =>
      config.validateToken(token).mapError(ServiceRequestError.apply)
    }.serverLogic: validatedToken =>
      (messageName, businessKeyQuery, tenantIdQuery, in) =>
        ZIO.logDebug(s"Start process by message $messageName (${businessKeyQuery.mkString})") *>
          config.extractCorrelation(validatedToken, in)
            .mapError(ServiceRequestError.apply)
            .flatMap: identityCorrelation =>
              // Set the bearer token in AuthContext so it can be used by the engine services
              AuthContext.withBearerToken(validatedToken):
                for
                  inJson <- initProcess(
                    processDefId = messageName,
                    in = in,
                    token = validatedToken
                  ).mapError(ServiceRequestError.apply)
                  result <- processInstanceService
                    .startProcessByMessage(
                      messageName = messageName,
                      businessKey = businessKeyQuery,
                      tenantId = tenantIdQuery,
                      variables = inJson.asObject,
                      identityCorrelation = Some(identityCorrelation)
                    ).mapError(ServiceRequestError.apply)
                  _ <- ZIO.logInfo(s"Process started by message '$messageName' (${businessKeyQuery.mkString}) -> ${result.processInstanceId}")
                yield result
                end for

  private lazy val getProcessVariablesEndpoint: ZServerEndpoint[Any, ZioStreams & WebSockets] =
    ProcessInstanceEndpoints.getProcessVariables.zServerSecurityLogic: token =>
      config.validateToken(token).mapError(ServiceRequestError.apply)
    .serverLogic: validatedToken =>
      (processInstanceId, variableFilter) =>
        getHistoricProcessVariables(validatedToken, processInstanceId, variableFilter)

  // same as getProcessVariablesEndpoint, but with processDefinitionKey as path parameter for API documentation
  private lazy val getProcessVariablesEndpointForApi: ZServerEndpoint[Any, ZioStreams & WebSockets] =
    ProcessInstanceEndpoints.getProcessVariablesForApi.zServerSecurityLogic: token =>
      config.validateToken(token).mapError(ServiceRequestError.apply)
    .serverLogic: validatedToken =>
      (
        processDefinitionKey,
        processInstanceId,
        variableFilter
      ) => // processDefinitionKey is not used
        // Set the bearer token in AuthContext so it can be used by the engine services
        getHistoricProcessVariables(validatedToken, processInstanceId, variableFilter)

  private def getHistoricProcessVariables(validatedToken: String, processInstanceId: String, variableFilter: Option[String]) =
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
          ) *)
        .mapError(ServiceRequestError.apply)

  // this runs the init worker to validate the input
  // so a process instance needs an InitWorker
  private def initProcess(
      processDefId: String,
      in: JsonObject,
      token: String
  )(using gatewayConfig: GatewayConfig): ZIO[Any, GatewayError, Json] =
    given config: EngineConfig = gatewayConfig.engineConfig
    // Forward request to the init worker
    WorkerForwardUtil.forwardWorkerRequest(processDefId, in.asJson, token)
      .provideLayer(HttpClientProvider.live)
      .mapError:
        case EngineError.ServiceRequestError(errorCode, errorMsg) =>
          ServiceRequestError(500, s"Init worker failed: $errorMsg")
        case err                                                  =>
          UnexpectedError(s"Init worker failed: ${err.getMessage}")
  end initProcess

end ProcessInstanceRoutes
