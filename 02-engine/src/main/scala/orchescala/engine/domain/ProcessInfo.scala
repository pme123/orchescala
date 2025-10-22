package orchescala.engine.domain

import orchescala.domain.*
import orchescala.engine.domain.ProcessInfo.ProcessStatus
import sttp.tapir.Schema.annotations.description

@description("Contains information about a process instance or execution")
case class ProcessInfo(
    @description("ID of the process instance")
    processInstanceId: String,
    
    @description("Optional business key associated with the process")
    businessKey: Option[String],
    
    @description("Current status of the process")
    status: ProcessStatus,
    @description("Type of the engine")
    engineType: EngineType
) extends ProcessResult

object ProcessInfo:
  given InOutCodec[ProcessInfo] = deriveInOutCodec
  given ApiSchema[ProcessInfo] = deriveApiSchema

  @description("Status of a process instance")
  enum ProcessStatus:
    case Active, Completed, Failed
  object ProcessStatus:
    given InOutCodec[ProcessStatus] = deriveInOutCodec
    given ApiSchema[ProcessStatus] = deriveEnumApiSchema
end ProcessInfo
