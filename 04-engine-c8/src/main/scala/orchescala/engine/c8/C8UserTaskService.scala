package orchescala.engine.c8

import io.camunda.client.CamundaClient
import io.camunda.client.api.search.response => camunda
import orchescala.engine.domain.EngineError

import java.time.OffsetDateTime
import orchescala.domain.CamundaVariable
import orchescala.engine.*
import orchescala.engine.domain.UserTask
import orchescala.engine.services.UserTaskService
import zio.ZIO.{logDebug, logInfo}
import zio.{IO, ZIO}

import scala.jdk.CollectionConverters.*

class C8UserTaskService(using
    camundaClientZIO: IO[EngineError, CamundaClient],
    engineConfig: EngineConfig
) extends UserTaskService, C8Service:

  def getUserTask(processInstanceId: String, userTaskId: String): IO[EngineError, Option[UserTask]] =
    for
      camundaClient <- camundaClientZIO
      userTaskDtos  <-
        ZIO
          .attempt:
            camundaClient
              .newUserTaskSearchRequest()
              .filter(f =>
                f.processInstanceKey(processInstanceId.toLong)
                  .elementId(userTaskId)
              ).send()
              .join()
              .items()
          .mapError: err =>
            EngineError.ProcessError(
              s"Problem getting UserTask for Process Instance '$processInstanceId': ${err.getMessage}"
            )
      userTask     <-
        ZIO
          .attempt:
            mapToUserTask(userTaskDtos.asScala.toSeq.headOption)
          .mapError: err =>
            EngineError.ProcessError(
              s"Problem mapping UserTask for Process Instance '$processInstanceId': ${err.getMessage}"
            )
    yield userTask

  def complete(taskId: String, out: Map[String, CamundaVariable]): IO[EngineError, Unit] = 
    for
      camundaClient <- camundaClientZIO
      taskKey <- ZIO.attempt(taskId.toLong).mapError: err =>
        EngineError.ProcessError(
          s"Problem completingUserTask converting taskId '$taskId' to Long: ${err.getMessage}"
        )
      userTaskDtos <-
        ZIO
          .attempt:
            camundaClient
              .newCompleteUserTaskCommand(taskId.toLong)
              .variables(mapToC8Variables(Some(out)))
              .send()
              .join()
          .mapError: err =>
            EngineError.ProcessError(
              s"Problem completing UserTask '$taskId': ${err.getMessage}"
            )
    yield ()

  private def mapToUserTask(
                             c8UserTask: Option[camunda.UserTask]
  ): Option[UserTask] =

    c8UserTask.map: taskDto =>
      UserTask(
        id = Option(taskDto.getUserTaskKey).map(_.toString).getOrElse("taskId not set!"),
        name = Option(taskDto.getName),
        assignee = Option(taskDto.getAssignee),
        created = Option(taskDto.getCreationDate).map(OffsetDateTime.parse),
        due = Option(taskDto.getDueDate).map(OffsetDateTime.parse),
        followUp = Option(taskDto.getFollowUpDate).map(OffsetDateTime.parse),
        priority = Option(taskDto.getPriority).map(_.toInt),
        processDefinitionId = Option(taskDto.getProcessDefinitionKey).map(_.toString),
        processInstanceId = Option(taskDto.getProcessInstanceKey).map(_.toString),
        taskDefinitionKey = Option(taskDto.getBpmnProcessId),
        formKey = Option(taskDto.getExternalFormReference).map(_.toString),
        camundaFormRef = Option(taskDto.getFormKey).map(_.toString), // not mapped
        tenantId = Option(taskDto.getTenantId),
        taskState = Option(taskDto.getState).map(_.toString)
      )
  end mapToUserTask
  
end C8UserTaskService
