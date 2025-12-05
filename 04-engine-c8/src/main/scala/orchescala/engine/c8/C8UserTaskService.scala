package orchescala.engine.c8

import io.camunda.client.CamundaClient
import io.camunda.client.api.search.response as camunda
import io.camunda.client.api.search.response.Variable
import orchescala.engine.domain.EngineError

import java.time.OffsetDateTime
import orchescala.domain.{CamundaVariable, IdentityCorrelation, Json, JsonProperty}
import orchescala.engine.*
import orchescala.engine.domain.UserTask
import orchescala.engine.services.UserTaskService
import zio.ZIO.{logDebug, logInfo}
import zio.{IO, ZIO}
import io.circe.parser

import scala.jdk.CollectionConverters.*

class C8UserTaskService(val processInstanceService: C8ProcessInstanceService)(using
    camundaClientZIO: IO[EngineError, CamundaClient],
    engineConfig: EngineConfig
) extends UserTaskService, C8Service:

  def getUserTask(
      processInstanceId: String,
      userTaskDefId: String
  ): IO[EngineError, Option[UserTask]] =
    for
      camundaClient <- camundaClientZIO
      userTaskDtos  <-
        ZIO
          .attempt:
            camundaClient
              .newUserTaskSearchRequest()
              .filter(f =>
                f.processInstanceKey(processInstanceId.toLong)
                  .elementId(userTaskDefId)
              ).send()
              .join()
              .items()
          .mapError: err =>
            EngineError.ProcessError(
              s"Problem getting UserTask for Process Instance '$processInstanceId': $err"
            )
      userTask      <-
        ZIO
          .attempt:
            mapToUserTask(userTaskDtos.asScala.toSeq.headOption)
          .mapError: err =>
            EngineError.ProcessError(
              s"Problem mapping UserTask for Process Instance '$processInstanceId': $err"
            )
    yield userTask

  def complete(
                taskId: String,
                processVariables: JsonObject,
                identityCorrelation: Option[IdentityCorrelation]
  ): IO[EngineError, Unit] =
    for
      camundaClient <- camundaClientZIO
      taskKey       <-
        ZIO.attempt(taskId.toLong).mapError: err =>
          EngineError.ProcessError(
            s"Problem completingUserTask converting taskId '$taskId' to Long: $err"
          )
      variableMap  <- CamundaVariable.jsonToCamundaValue(processVariables.toJson) match
        case m: Map[?, ?] =>
          ZIO.succeed(m.asInstanceOf[Map[String, CamundaVariable]])
        case other        =>
          ZIO.fail(EngineError.MappingError(s"Expected a Map, but got $other"))    
      userTaskDtos  <-
        ZIO
          .attempt:
            camundaClient
              .newCompleteUserTaskCommand(taskKey)
              .variables(mapToC8Variables(Some(variableMap)))
              .send()
              .join()
          .mapError: err =>
            EngineError.ProcessError(
              s"Problem completing UserTask '$taskKey': $err"
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
