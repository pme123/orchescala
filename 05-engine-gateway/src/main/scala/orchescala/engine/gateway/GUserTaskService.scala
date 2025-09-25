package orchescala.engine.gateway

import orchescala.domain.CamundaVariable.CNull
import orchescala.domain.{CamundaVariable, InOutDecoder, InOutEncoder}
import orchescala.engine.*
import orchescala.engine.domain.EngineError.MappingError
import orchescala.engine.domain.{EngineError, UserTask}
import orchescala.engine.services.UserTaskService
import org.camunda.community.rest.client.api.TaskApi
import org.camunda.community.rest.client.dto.{CompleteTaskDto, TaskWithAttachmentAndCommentDto, VariableValueDto}
import org.camunda.community.rest.client.invoker.ApiClient
import zio.ZIO.{logDebug, logInfo}
import zio.{IO, ZIO}

import scala.jdk.CollectionConverters.*

class GUserTaskService(using
    services: Seq[UserTaskService]
) extends UserTaskService, GService:

  def getUserTask(
      processInstanceId: String,
      userTaskId: String
  ): IO[EngineError, Option[UserTask]] =
    tryServicesWithErrorCollection[UserTaskService, Option[UserTask]](
      _.getUserTask(processInstanceId, userTaskId),
      "getUserTask",
      Some(processInstanceId),
      Some((userTask: Option[UserTask]) => userTask.map(_.id).getOrElse("NOT-SET"))
    )

  def complete(taskId: String, variables: Map[String, CamundaVariable]): IO[EngineError, Unit] =
    tryServicesWithErrorCollection[UserTaskService, Unit](
      _.complete(taskId, variables),
      "complete",
      Some(taskId)
    )

end GUserTaskService
