package orchescala.engine.gateway.http

import orchescala.engine.domain.EngineError
import orchescala.engine.services.ProcessInstanceService
import sttp.capabilities.zio.ZioStreams
import sttp.capabilities.WebSockets
import sttp.tapir.server.ziohttp.{ZioHttpInterpreter, ZioHttpServerOptions}
import sttp.tapir.ztapir.*
import zio.*
import zio.http.*

object GatewayRoutes:

  /**
   * Creates HTTP routes from the tapir endpoints using the provided ProcessInstanceService.
   *
   * @param processInstanceService The service to handle process instance operations
   * @return ZIO HTTP routes
   */
  def routes(processInstanceService: ProcessInstanceService): Routes[Any, Response] =
    val serverEndpoint: ZServerEndpoint[Any, ZioStreams & WebSockets] =
      GatewayEndpoints.startProcessAsync.zServerLogic { case (processDefId, request) =>
        processInstanceService
          .startProcessAsync(
            processDefId = processDefId,
            in = request.variables,
            businessKey = request.businessKey
          )
          .map(StartProcessResponse.fromProcessInfo)
          .mapError(engineErrorToErrorResponse)
      }

    ZioHttpInterpreter(ZioHttpServerOptions.default).toHttp(serverEndpoint)

  private def engineErrorToErrorResponse(error: EngineError): ErrorResponse =
    error match
      case EngineError.ProcessError(msg, code) =>
        ErrorResponse(message = msg, code = Some(code.toString))
      case EngineError.ServiceError(msg, code) =>
        ErrorResponse(message = msg, code = Some(code.toString))
      case EngineError.MappingError(msg, code) =>
        ErrorResponse(message = msg, code = Some(code.toString))
      case EngineError.DecodingError(msg, code) =>
        ErrorResponse(message = msg, code = Some(code.toString))
      case EngineError.EncodingError(msg, code) =>
        ErrorResponse(message = msg, code = Some(code.toString))
      case EngineError.DmnError(msg, code) =>
        ErrorResponse(message = msg, code = Some(code.toString))
      case EngineError.WorkerError(msg, code) =>
        ErrorResponse(message = msg, code = Some(code.toString))
      case EngineError.UnexpectedError(msg, code) =>
        ErrorResponse(message = msg, code = Some(code.toString))

end GatewayRoutes

