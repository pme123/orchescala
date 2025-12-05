package orchescala.engine.gateway

import orchescala.domain.{CamundaVariable, IdentityCorrelation, JsonProperty}
import orchescala.engine.domain.{EngineError, UserTask}
import orchescala.engine.services.UserTaskService
import zio.{IO, ZIO}

class GUserTaskService(val processInstanceService: GProcessInstanceService)(using
    services: Seq[UserTaskService]
) extends UserTaskService, GService:

  def getUserTask(
      processInstanceId: String,
      userTaskDefId: String
  ): IO[EngineError, Option[UserTask]] =
    tryServicesWithErrorCollection[UserTaskService, Option[UserTask]](
      _.getUserTask(processInstanceId, userTaskDefId),
      "getUserTask",
      Some(processInstanceId),
      Some((userTask: Option[UserTask]) => userTask.map(_.id).getOrElse("NOT-SET"))
    )

  def complete(
      taskId: String,
      processVariables: JsonObject,
      identityCorrelation: Option[IdentityCorrelation]
  ): IO[EngineError, Unit] =
    tryServicesWithErrorCollection[UserTaskService, Unit](
      _.complete(taskId, processVariables, identityCorrelation),
      "complete",
      Some(taskId)
    )

end GUserTaskService
