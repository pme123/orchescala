package orchescala.engine.domain

import orchescala.domain.*
import orchescala.engine.domain.HistoricProcessInstance.ProcessState

import java.time.OffsetDateTime

case class HistoricProcessInstance(
    id: String,
    rootProcessInstanceId: String,
    superProcessInstanceId: Option[String],
    processDefinitionName: String,
    processDefinitionKey: String,
    processDefinitionVersion: Int,
    processDefinitionId: String,
    businessKey: Option[String],
    startTime: OffsetDateTime,
    endTime: Option[OffsetDateTime],
    removalTime: Option[OffsetDateTime],
    startUserId: Option[String],
    deleteReason: Option[String],
    tenantId: Option[String],
    state: ProcessState
):
  lazy val durationInMillis: Option[Long] =
    endTime.map(_.toInstant.toEpochMilli - startTime.toInstant.toEpochMilli)
end HistoricProcessInstance

object HistoricProcessInstance:
  given InOutCodec[HistoricProcessInstance] = deriveCodec

  enum ProcessState:
    case ACTIVE, SUSPENDED, COMPLETED, TERMINATED, UNKNOWN
  object ProcessState:
    given InOutCodec[ProcessState] = deriveEnumInOutCodec
end HistoricProcessInstance
