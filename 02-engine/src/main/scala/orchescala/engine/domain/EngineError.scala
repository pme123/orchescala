package orchescala.engine.domain

import orchescala.domain.*

sealed trait EngineError extends OrchescalaError

object EngineError:
  case class MappingError(
      errorMsg: String,
      errorCode: ErrorCodes = ErrorCodes.`engine-mapping-error`
  ) extends EngineError

  case class DecodingError(
      errorMsg: String,
      errorCode: ErrorCodes = ErrorCodes.`engine-decoding-error`
  ) extends EngineError

  case class EncodingError(
      errorMsg: String,
      errorCode: ErrorCodes = ErrorCodes.`engine-encoding-error`
  ) extends EngineError

  case class ProcessError(
      errorMsg: String,
      errorCode: ErrorCodes = ErrorCodes.`engine-process-error`
  ) extends EngineError

  case class DmnError(
      errorMsg: String,
      errorCode: ErrorCodes = ErrorCodes.`engine-dmn-error`
  ) extends EngineError

  case class WorkerError(
      errorMsg: String,
      errorCode: ErrorCodes = ErrorCodes.`engine-worker-error`
  ) extends EngineError

  case class UnexpectedError(
      errorMsg: String,
      errorCode: ErrorCodes = ErrorCodes.`error-unexpected`
  ) extends EngineError

  case class ServiceError(
      errorMsg: String,
      errorCode: ErrorCodes = ErrorCodes.`engine-service-error`
  ) extends EngineError

  case class ServiceRequestError(
                                  errorCode: Int,
                                  errorMsg: String
                                ) extends EngineError
  object ServiceRequestError:
    given InOutCodec[ServiceRequestError] = deriveInOutCodec
    
    def apply(err: EngineError): ServiceRequestError =
      err match
        case err: ServiceRequestError => err
        case err                      => ServiceRequestError(500, err.toString)

    /** A refusal of the caller's request: a 4xx, but no auth status - 401, 403 and 407 belong to
      * the token check, not to the service. The one rule for a worker (`CustomError.refused`) and
      * for forwarding to a worker app (`WorkerForwardUtil`).
      */
    def isRefusal(status: Int): Boolean =
      status >= 400 && status < 500 && status != 401 && status != 403 && status != 407

end EngineError
