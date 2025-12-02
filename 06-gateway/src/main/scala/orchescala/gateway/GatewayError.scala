package orchescala.gateway

import orchescala.domain.{ErrorCodes, OrchescalaError}

sealed trait GatewayError extends OrchescalaError

object GatewayError:
  case class TokenExtractionError(
      errorMsg: String,
      errorCode: ErrorCodes = ErrorCodes.`mapping-error`
  ) extends GatewayError
  
  case class TokenValidationError(
      errorMsg: String,
      errorCode: ErrorCodes = ErrorCodes.`validation-failed`
  ) extends GatewayError
  
end GatewayError
