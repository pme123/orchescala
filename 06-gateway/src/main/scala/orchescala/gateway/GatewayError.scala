package orchescala.gateway

import orchescala.domain.*
import orchescala.engine.domain.EngineError
import orchescala.worker.WorkerError

sealed trait GatewayError extends OrchescalaError

object GatewayError:
  case class TokenExtractionError(
      errorMsg: String
  ) extends GatewayError:
    val errorCode: ErrorCodes = ErrorCodes.`mapping-error`

  case class TokenValidationError(
      errorMsg: String
  ) extends GatewayError:
    val errorCode: ErrorCodes = ErrorCodes.`validation-failed`

  case class ServiceRequestError(
      errorCode: Int,
      errorMsg: String
  ) extends GatewayError

  object ServiceRequestError:
    given InOutCodec[ServiceRequestError] = deriveInOutCodec
    given ApiSchema[ServiceRequestError]  = deriveApiSchema

    def apply(err: GatewayError | EngineError | WorkerError): ServiceRequestError =
      err match
        case err: WorkerError.ServiceRequestError =>
          ServiceRequestError(err.errorCode, err.errorMsg)
        case err: WorkerError         => ServiceRequestError(500, err.toString)  
        case err: EngineError          => ServiceRequestError(500, err.toString)
        case err: ServiceRequestError  => err
        case TokenExtractionError(msg) => ServiceRequestError(401, msg)
        case TokenValidationError(msg) => ServiceRequestError(401, msg)
        case err                       => ServiceRequestError(500, err.errorMsg)
    
  end ServiceRequestError
  case class UnexpectedError(
      errorMsg: String,
      errorCode: ErrorCodes = ErrorCodes.`error-unexpected`
  ) extends GatewayError
end GatewayError
