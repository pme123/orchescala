package orchescala.engine.gateway.http

import orchescala.domain.*
import orchescala.engine.domain.{EngineType, ProcessInfo}
import sttp.tapir.Schema.annotations.description


@description("Error response")
case class ErrorResponse(
    @description("Error message")
    message: String,
    @description("Optional error code")
    code: Option[String] = None,
    @description("HTTP status code for this error")
    httpStatus: Int = 500
)

object ErrorResponse:
  given ApiSchema[ErrorResponse] = deriveApiSchema
  given InOutCodec[ErrorResponse] = deriveInOutCodec

  // Shared error response examples
  val unauthorized = ErrorResponse(
    message = "Invalid or missing authentication token",
    code = Some("UNAUTHORIZED"),
    httpStatus = 401
  )

  val badRequest = ErrorResponse(
    message = "Invalid request parameters",
    code = Some("INVALID_PARAMETERS"),
    httpStatus = 400
  )

  val notFound = ErrorResponse(
    message = "Resource not found",
    code = Some("NOT_FOUND"),
    httpStatus = 404
  )

  val internalError = ErrorResponse(
    message = "Internal server error",
    code = Some("ENGINE_ERROR"),
    httpStatus = 500
  )

