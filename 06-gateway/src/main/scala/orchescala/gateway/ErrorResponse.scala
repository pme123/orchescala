package orchescala.gateway

import orchescala.domain.*
import orchescala.engine.domain.{EngineType, ProcessInfo}
import sttp.tapir.Schema.annotations.description


@description("Error response")
case class ErrorResponse(
    @description("Error message")
    message: String,
    @description("Optional error code")
    code: Option[String] = None
):
  /** Extracts HTTP status code from the error message content.
    * Looks for patterns like "Failed with code 404:" or "status: 404"
    */
  def httpStatus: Int = ErrorResponse.extractHttpStatus(message)

object ErrorResponse:
  given ApiSchema[ErrorResponse] = deriveApiSchema
  given InOutCodec[ErrorResponse] = deriveInOutCodec

  def fromOrchescalaError(error: OrchescalaError): ErrorResponse =
    ErrorResponse(
      message = error.errorMsg,
      code = Some(error.errorCode.toString)
    )

  /** Extracts HTTP status code from error message.
    * Looks for patterns like "Failed with code 404:" or "status: 404"
    */
  private def extractHttpStatus(errorMsg: String): Int =
    val codePattern = """Failed with code (\d+):""".r
    val statusPattern = """status:\s*(\d+)""".r

    codePattern.findFirstMatchIn(errorMsg)
      .orElse(statusPattern.findFirstMatchIn(errorMsg))
      .flatMap(m => scala.util.Try(m.group(1).toInt).toOption)
      .getOrElse(500)

  // Shared error response examples
  val unauthorized = ErrorResponse(
    message = "Invalid or missing authentication token",
    code = Some("UNAUTHORIZED")
  )

  val badRequest = ErrorResponse(
    message = "Invalid request parameters",
    code = Some("INVALID_PARAMETERS")
  )

  val notFound = ErrorResponse(
    message = "Resource not found",
    code = Some("NOT_FOUND")
  )

  val internalError = ErrorResponse(
    message = "Internal server error",
    code = Some("ENGINE_ERROR")
  )

