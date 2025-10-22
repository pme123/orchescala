package orchescala.engine.gateway.http

import orchescala.domain.*
import orchescala.engine.domain.{EngineType, ProcessInfo}
import sttp.tapir.Schema.annotations.description

@description("Request to start a process instance asynchronously")
case class StartProcessRequest(
    @description("Process variables as JSON object")
    variables: Json = Json.obj(),
    @description("Optional business key for the process instance")
    businessKey: Option[String] = None
)

object StartProcessRequest:
  given ApiSchema[StartProcessRequest] = deriveApiSchema
  given InOutCodec[StartProcessRequest] = deriveInOutCodec

@description("Response containing information about the started process instance")
case class StartProcessResponse(
    @description("ID of the process instance")
    processInstanceId: String,
    @description("Optional business key associated with the process")
    businessKey: Option[String],
    @description("Current status of the process")
    status: ProcessInfo.ProcessStatus,
    @description("Type of the engine that executed the process")
    engineType: EngineType
)

object StartProcessResponse:
  given ApiSchema[StartProcessResponse] = deriveApiSchema
  given InOutCodec[StartProcessResponse] = deriveInOutCodec

  def fromProcessInfo(info: ProcessInfo): StartProcessResponse =
    StartProcessResponse(
      processInstanceId = info.processInstanceId,
      businessKey = info.businessKey,
      status = info.status,
      engineType = info.engineType
    )

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

