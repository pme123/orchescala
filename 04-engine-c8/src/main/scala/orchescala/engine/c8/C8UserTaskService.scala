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
import orchescala.domain.CamundaVariable.CJson

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

      // Get processInstanceId from task
      processInstanceId <- getProcessInstanceIdFromTask(taskKey)

      // Sign the correlation with processInstanceId if provided
      signedCorr      <- identityCorrelation match
                           case Some(corr) => signCorrelation(corr, processInstanceId)
                           case None       => ZIO.none
      jsonVariables =
        signedCorr
          .map: s =>
            processVariables.add("identityCorrelation", s.asJson.deepDropNullValues)
          .getOrElse(processVariables)
      camundaVariables = jsonToVariablesMap(jsonVariables.toMap)
      _               <-
        ZIO
          .fromFutureJava:
            camundaClient
              .newCompleteUserTaskCommand(taskKey)
              .variables(camundaVariables.asJava)
              .send()
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

  private def getProcessInstanceIdFromTask(taskKey: Long): IO[EngineError, String] =
    for
      camundaClient     <- camundaClientZIO
      userTask          <- ZIO
                             .attempt:
                               camundaClient
                                 .newUserTaskGetRequest(taskKey)
                                 .send()
                                 .join()
                             .mapError(err =>
                               EngineError.ProcessError(s"Problem getting user task: $err")
                             )
      processInstanceId <- ZIO
                             .fromOption(Option(userTask.getProcessInstanceKey).map(_.toString))
                             .mapError(_ =>
                               EngineError.ProcessError(s"Task $taskKey has no processInstanceId")
                             )
    yield processInstanceId

  private def signCorrelation(
      correlation: IdentityCorrelation,
      processInstanceId: String
  ): IO[EngineError, Option[IdentityCorrelation]] =
    engineConfig.identitySigningKey match
      case Some(key) =>
        ZIO.some:
          orchescala.domain.IdentityCorrelationSigner.sign(
            correlation.copy(processInstanceId = Some(processInstanceId)),
            processInstanceId,
            key
          )
      case None      =>
        ZIO.logWarning(
          "No identity signing key configured - correlation will not be signed"
        ).as:
          Some(correlation.copy(processInstanceId = Some(processInstanceId)))

end C8UserTaskService
