package orchescala.engine.gateway.http

import orchescala.engine.AuthContext
import orchescala.engine.domain.EngineError
import orchescala.engine.services.{ProcessInstanceService, UserTaskService}
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
    * @param validateToken
    *   Function to validate the bearer token. Returns Right(token) if valid, Left(ErrorResponse) if
    *   invalid.
    * @return
    *   ZIO HTTP routes
    */
  def routes(
      processInstanceService: ProcessInstanceService,
      userTaskService: UserTaskService,
      validateToken: String => IO[ErrorResponse, String] = defaultTokenValidator
  ): Routes[Any, Response] =
    val startProcessEndpoint: ZServerEndpoint[Any, ZioStreams & WebSockets] =
      GatewayEndpoints.startProcessAsync.zServerSecurityLogic { token =>
        validateToken(token)
      }.serverLogic {
        validatedToken => // validatedToken is the String token returned from security logic
          (processDefId, businessKeyQuery, request) =>
            // Set the bearer token in AuthContext so it can be used by the engine services
            AuthContext.withBearerToken(validatedToken):
              processInstanceService
                .startProcessAsync(
                  processDefId = processDefId,
                  in = request,
                  businessKey = businessKeyQuery
                )
                .mapError(engineErrorToErrorResponse)
      }

    val getUserTaskVariablesEndpoint: ZServerEndpoint[Any, ZioStreams & WebSockets] =
      GatewayEndpoints.getUserTaskVariables.zServerSecurityLogic: token =>
        validateToken(token)
      .serverLogic: validatedToken =>
        (processInstanceId, userTaskDefId, variableFilter, timeoutInSec) =>
          // Set the bearer token in AuthContext so it can be used by the engine services
          AuthContext.withBearerToken(validatedToken):
            userTaskService
              .getUserTaskVariables(processInstanceId, userTaskDefId, variableFilter, timeoutInSec)
              .mapError(engineErrorToErrorResponse)

    ZioHttpInterpreter(ZioHttpServerOptions.default).toHttp(
      List(startProcessEndpoint, getUserTaskVariablesEndpoint)
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
        code = Some("UNAUTHORIZED")
      ))

  private def engineErrorToErrorResponse(error: EngineError): ErrorResponse =
    error match
      case EngineError.ProcessError(msg, code)    =>
        ErrorResponse(message = msg, code = Some(code.toString))
      case EngineError.ServiceError(msg, code)    =>
        ErrorResponse(message = msg, code = Some(code.toString))
      case EngineError.MappingError(msg, code)    =>
        ErrorResponse(message = msg, code = Some(code.toString))
      case EngineError.DecodingError(msg, code)   =>
        ErrorResponse(message = msg, code = Some(code.toString))
      case EngineError.EncodingError(msg, code)   =>
        ErrorResponse(message = msg, code = Some(code.toString))
      case EngineError.DmnError(msg, code)        =>
        ErrorResponse(message = msg, code = Some(code.toString))
      case EngineError.WorkerError(msg, code)     =>
        ErrorResponse(message = msg, code = Some(code.toString))
      case EngineError.UnexpectedError(msg, code) =>
        ErrorResponse(message = msg, code = Some(code.toString))

end GatewayRoutes
