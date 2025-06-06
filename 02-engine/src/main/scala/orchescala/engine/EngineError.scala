package orchescala
package engine

import orchescala.domain.ErrorCodes

sealed trait EngineError extends Throwable:
  def errorCode: ErrorCodes
  def errorMsg: String

  def causeMsg                    = s"$errorCode: $errorMsg"
  override def toString(): String = causeMsg
end EngineError

object EngineError:
  case class DecodingError(
      errorMsg: String,
      errorCode: ErrorCodes = ErrorCodes.`gateway-decoding-error`
  ) extends EngineError

  case class EncodingError(
      errorMsg: String,
      errorCode: ErrorCodes = ErrorCodes.`gateway-encoding-error`
  ) extends EngineError

  case class ProcessError(
      errorMsg: String,
      errorCode: ErrorCodes = ErrorCodes.`gateway-process-error`
  ) extends EngineError

  case class DmnError(
      errorMsg: String,
      errorCode: ErrorCodes = ErrorCodes.`gateway-dmn-error`
  ) extends EngineError

  case class WorkerError(
      errorMsg: String,
      errorCode: ErrorCodes = ErrorCodes.`gateway-worker-error`
  ) extends EngineError

  case class UnexpectedError(
      errorMsg: String,
      errorCode: ErrorCodes = ErrorCodes.`error-unexpected`
  ) extends EngineError

  case class ServiceError(
      errorMsg: String,
      errorCode: ErrorCodes = ErrorCodes.`gateway-service-error`
  ) extends EngineError
end EngineError
