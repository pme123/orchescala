package orchescala.engine.domain

import orchescala.domain.*
import orchescala.engine.domain.HistoricProcessInstance.ProcessState

import java.time.OffsetDateTime

case class HistoricProcessInstance(
    id: String,
    rootProcessInstanceId: String,
    superProcessInstanceId: Option[String],
    superCaseInstanceId: Option[String],
    caseInstanceId: Option[String],
    processDefinitionName: String,
    processDefinitionKey: String,
    processDefinitionVersion: Int,
    processDefinitionId: String,
    businessKey: Option[String],
    startTime: OffsetDateTime,
    endTime: Option[OffsetDateTime],
    removalTime: Option[OffsetDateTime],
    durationInMillis: Option[Long],
    startUserId: Option[String],
    startActivityId: Option[String],
    deleteReason: Option[String],
    tenantId: Option[String],
    state: ProcessState,
    restartedProcessInstanceId: Option[String]
)
object HistoricProcessInstance:
  given InOutCodec[HistoricProcessInstance] = deriveCodec

  enum ProcessState:
    case ACTIVE, SUSPENDED, COMPLETED, TERMINATED
  object ProcessState:
    given InOutCodec[ProcessState] = deriveEnumInOutCodec
end HistoricProcessInstance
