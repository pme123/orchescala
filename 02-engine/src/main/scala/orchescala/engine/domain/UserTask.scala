package orchescala.engine.domain

import orchescala.domain.{InOutCodec, deriveInOutCodec}

import java.time.OffsetDateTime

/** Data transfer object for user tasks in the engine
  */
case class UserTask(
    id: String,
    name: Option[String] = None,
    assignee: Option[String] = None,
    owner: Option[String] = None,
    created: Option[OffsetDateTime] = None,
    lastUpdated: Option[OffsetDateTime] = None,
    due: Option[OffsetDateTime] = None,
    followUp: Option[OffsetDateTime] = None,
    delegationState: Option[String] = None,
    description: Option[String] = None,
    executionId: Option[String] = None,
    parentTaskId: Option[String] = None,
    priority: Option[Int] = None,
    processDefinitionId: Option[String] = None,
    processInstanceId: Option[String] = None,
    caseExecutionId: Option[String] = None,
    caseDefinitionId: Option[String] = None,
    caseInstanceId: Option[String] = None,
    taskDefinitionKey: Option[String] = None,
    suspended: Option[Boolean] = None,
    formKey: Option[String] = None,
    camundaFormRef: Option[CamundaFormRefDto] = None,
    tenantId: Option[String] = None,
    taskState: Option[String] = None,
    attachment: Option[Boolean] = None,
    comment: Option[Boolean] = None
)

/** Camunda form reference for the engine
  */
case class CamundaFormRefDto(
    key: Option[String] = None,
    binding: Option[String] = None,
    version: Option[Int] = None
)

object UserTask:
  given InOutCodec[UserTask]       = deriveInOutCodec
  given InOutCodec[CamundaFormRefDto] = deriveInOutCodec
end UserTask
