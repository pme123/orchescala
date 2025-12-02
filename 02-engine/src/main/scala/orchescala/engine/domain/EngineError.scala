package orchescala.engine.domain

import orchescala.domain.{ErrorCodes, OrchescalaError}

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
  
end EngineError
