package orchescala.engine.domain

import java.time.OffsetDateTime
import orchescala.domain.*

case class HistoricVariable(
    id: String,
    name: String,
    value: Option[Json],
    processDefinitionKey: Option[String] = None,
    processDefinitionId: Option[String] = None,
    processInstanceId: Option[String] = None,
    executionId: Option[String] = None,
    activityInstanceId: Option[String] = None,
    caseDefinitionKey: Option[String] = None,
    caseDefinitionId: Option[String] = None,
    caseInstanceId: Option[String] = None,
    caseExecutionId: Option[String] = None,
    taskId: Option[String] = None,
    tenantId: Option[String] = None,
    errorMessage: Option[String] = None,
    state: Option[String] = None,
    createTime: Option[OffsetDateTime] = None,
    removalTime: Option[OffsetDateTime] = None,
    rootProcessInstanceId: Option[String] = None
)

object HistoricVariable:
  given InOutCodec[HistoricVariable] = deriveInOutCodec