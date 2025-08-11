package orchescala.engine.domain

import orchescala.domain.{InOutCodec, deriveInOutCodec}

import java.time.OffsetDateTime

/** Data transfer object for user tasks in the engine
  */
case class UserTask(
    id: String,
    name: Option[String] = None,
    assignee: Option[String] = None,
    created: Option[OffsetDateTime] = None,
    due: Option[OffsetDateTime] = None,
    followUp: Option[OffsetDateTime] = None,
    priority: Option[Int] = None,
    processDefinitionId: Option[String] = None,
    processInstanceId: Option[String] = None,
    taskDefinitionKey: Option[String] = None,
    formKey: Option[String] = None,
    camundaFormRef: Option[String] = None,
    tenantId: Option[String] = None,
    taskState: Option[String] = None,
)

object UserTask:
  given InOutCodec[UserTask]       = deriveInOutCodec
end UserTask
