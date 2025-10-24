package orchescala.engine.gateway.http

import orchescala.domain.*
import orchescala.engine.domain.{EngineType, ProcessInfo}
import sttp.tapir.Schema.annotations.description


@description("Error response")
case class ErrorResponse(
    @description("Error message")
    message: String,
    @description("Optional error code")
    code: Option[String] = None
)

object ErrorResponse:
  given ApiSchema[ErrorResponse] = deriveApiSchema
  given InOutCodec[ErrorResponse] = deriveInOutCodec

