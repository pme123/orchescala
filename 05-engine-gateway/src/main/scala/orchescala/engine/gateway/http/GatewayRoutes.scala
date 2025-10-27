package orchescala.engine.gateway.http

import orchescala.domain.CamundaVariable
import orchescala.engine.AuthContext
import orchescala.engine.domain.EngineError
import orchescala.engine.services.{MessageService, ProcessInstanceService, SignalService, UserTaskService}
import sttp.capabilities.zio.ZioStreams
import sttp.capabilities.WebSockets
import sttp.tapir.server.ziohttp.{ZioHttpInterpreter, ZioHttpServerOptions}
import sttp.tapir.ztapir.*
import zio.*
import zio.http.*
import io.circe.syntax.*
import io.circe.Json as CirceJson

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
    *   Function to validate the bearer token. Returns Right(token) if valid, Left(ErrorResponse) if
    *   invalid.
    * @return
    *   ZIO HTTP routes
    */
  def routes(
      processInstanceService: ProcessInstanceService,
      userTaskService: UserTaskService,
      signalService: SignalService,
      messageService: MessageService,
      validateToken: String => IO[ErrorResponse, String] = defaultTokenValidator
  ): Routes[Any, Response] =
    val startProcessEndpoint: ZServerEndpoint[Any, ZioStreams & WebSockets] =
      ProcessInstanceEndpoints.startProcessAsync.zServerSecurityLogic { token =>
        validateToken(token)
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
                .mapError(engineErrorToErrorResponse)
      }

    val getUserTaskVariablesEndpoint: ZServerEndpoint[Any, ZioStreams & WebSockets] =
      UserTaskEndpoints.getUserTaskVariables.zServerSecurityLogic: token =>
        validateToken(token)
      .serverLogic: validatedToken =>
        (processInstanceId, userTaskDefId, variableFilter, timeoutInSec) =>
          // Set the bearer token in AuthContext so it can be used by the engine services
          AuthContext.withBearerToken(validatedToken):
            userTaskService
              .getUserTaskVariables(processInstanceId, userTaskDefId, variableFilter, timeoutInSec)
              .mapError(engineErrorToErrorResponse)

    val completeUserTaskEndpoint: ZServerEndpoint[Any, ZioStreams & WebSockets] =
      UserTaskEndpoints.completeUserTask.zServerSecurityLogic: token =>
        validateToken(token)
      .serverLogic: validatedToken =>
        (processInstanceId, userTaskDefId, userTaskId, variables) =>
          // Set the bearer token in AuthContext so it can be used by the engine services
          AuthContext.withBearerToken(validatedToken):
            // Convert JSON to Map[String, CamundaVariable]
            val camundaVariables = CamundaVariable.jsonToCamundaValue(variables) match
              case m: Map[?, ?] => m.asInstanceOf[Map[String, CamundaVariable]]
              case _ => Map.empty[String, CamundaVariable]

            userTaskService
              .complete(userTaskId, camundaVariables)
              .mapError(engineErrorToErrorResponse)

    val sendSignalEndpoint: ZServerEndpoint[Any, ZioStreams & WebSockets] =
      SignalEndpoints.sendSignal.zServerSecurityLogic: token =>
        validateToken(token)
      .serverLogic: validatedToken =>
        (signalName, tenantId, variables) =>
          // Set the bearer token in AuthContext so it can be used by the engine services
          AuthContext.withBearerToken(validatedToken):
            // Convert JSON to Map[String, CamundaVariable]
            val camundaVariables = CamundaVariable.jsonToCamundaValue(variables) match
              case m: Map[?, ?] => m.asInstanceOf[Map[String, CamundaVariable]]
              case _ => Map.empty[String, CamundaVariable]

            signalService
              .sendSignal(
                name = signalName,
                tenantId = tenantId,
                variables = Some(camundaVariables)
              )
              .mapError(engineErrorToErrorResponse)

    val sendMessageEndpoint: ZServerEndpoint[Any, ZioStreams & WebSockets] =
      MessageEndpoints.sendMessage.zServerSecurityLogic: token =>
        validateToken(token)
      .serverLogic: validatedToken =>
        (messageName, tenantId, timeToLiveInSec, businessKey, processInstanceId, variables) =>
          // Set the bearer token in AuthContext so it can be used by the engine services
          AuthContext.withBearerToken(validatedToken):
            // Convert JSON to Map[String, CamundaVariable]
            val camundaVariables = CamundaVariable.jsonToCamundaValue(variables) match
              case m: Map[?, ?] => m.asInstanceOf[Map[String, CamundaVariable]]
              case _ => Map.empty[String, CamundaVariable]

            messageService
              .sendMessage(
                name = messageName,
                tenantId = tenantId,
                timeToLiveInSec = timeToLiveInSec,
                businessKey = businessKey,
                processInstanceId = processInstanceId,
                variables = Some(camundaVariables)
              )
              .mapError(engineErrorToErrorResponse)

    ZioHttpInterpreter(ZioHttpServerOptions.default).toHttp(
      List(startProcessEndpoint, getUserTaskVariablesEndpoint, completeUserTaskEndpoint, sendSignalEndpoint, sendMessageEndpoint)
    )
  end routes

  /** Default token validator - validates that token is not empty and returns the token. Override
    * this with your own validation logic (e.g., JWT validation, database lookup, etc.)
    */
  private def defaultTokenValidator(token: String): IO[ErrorResponse, String] =
    if token.nonEmpty then
      ZIO.succeed(token)
    else
      ZIO.fail(ErrorResponse(
        message = "Invalid or missing authentication token",
        code = Some("UNAUTHORIZED"),
        httpStatus = 401
      ))

  private def engineErrorToErrorResponse(error: EngineError): ErrorResponse =
    val httpStatus = extractHttpStatusFromError(error.errorMsg)
    error match
      case EngineError.ProcessError(msg, code)    =>
        ErrorResponse(message = msg, code = Some(code.toString), httpStatus = httpStatus)
      case EngineError.ServiceError(msg, code)    =>
        ErrorResponse(message = msg, code = Some(code.toString), httpStatus = httpStatus)
      case EngineError.MappingError(msg, code)    =>
        ErrorResponse(message = msg, code = Some(code.toString), httpStatus = 400)
      case EngineError.DecodingError(msg, code)   =>
        ErrorResponse(message = msg, code = Some(code.toString), httpStatus = 400)
      case EngineError.EncodingError(msg, code)   =>
        ErrorResponse(message = msg, code = Some(code.toString), httpStatus = 500)
      case EngineError.DmnError(msg, code)        =>
        ErrorResponse(message = msg, code = Some(code.toString), httpStatus = httpStatus)
      case EngineError.WorkerError(msg, code)     =>
        ErrorResponse(message = msg, code = Some(code.toString), httpStatus = 500)
      case EngineError.UnexpectedError(msg, code) =>
        ErrorResponse(message = msg, code = Some(code.toString), httpStatus = 500)

  /** Extracts HTTP status code from Camunda error messages.
    * Looks for patterns like "Failed with code 404:" or "status: 404"
    */
  private def extractHttpStatusFromError(errorMsg: String): Int =
    // Try to extract from "Failed with code XXX:" pattern
    val codePattern = """Failed with code (\d+):""".r
    val statusPattern = """status:\s*(\d+)""".r

    codePattern.findFirstMatchIn(errorMsg)
      .orElse(statusPattern.findFirstMatchIn(errorMsg))
      .flatMap(m => scala.util.Try(m.group(1).toInt).toOption)
      .getOrElse(500) // Default to 500 if no status code found

end GatewayRoutes
