package orchescala.engine
package c7

import orchescala.domain.CamundaVariable.CNull
import orchescala.domain.{CamundaVariable, IdentityCorrelation, InputParams}
import orchescala.engine.*
import orchescala.engine.domain.EngineError.MappingError
import orchescala.engine.domain.{EngineError, UserTask}
import orchescala.engine.services.UserTaskService
import org.camunda.community.rest.client.api.TaskApi
import org.camunda.community.rest.client.dto.{
  CompleteTaskDto,
  TaskWithAttachmentAndCommentDto,
  VariableValueDto
}
import org.camunda.community.rest.client.invoker.ApiClient
import zio.ZIO.{logDebug, logInfo}
import zio.{IO, ZIO}

import scala.collection.mutable
import scala.jdk.CollectionConverters.*

class C7UserTaskService(val processInstanceService: C7ProcessInstanceService)(using
    apiClientZIO: IO[EngineError, ApiClient],
    engineConfig: EngineConfig
) extends UserTaskService, C7Service:

  def getUserTask(
      processInstanceId: String,
      userTaskDefId: String
  ): IO[EngineError, Option[UserTask]] =
    for
      apiClient <- apiClientZIO
      _         <-
        logInfo(
          s"Getting UserTask for processInstanceId: $processInstanceId - userTaskDefId: $userTaskDefId"
        )
      taskDtos  <- ZIO
                     .attempt:
                       new TaskApi(apiClient)
                         .getTasks(
                           null,              // taskId,
                           null,              // taskIdIn,
                           processInstanceId, // processInstanceId,
                           null,              // processInstanceIdIn,
                           null,              // processInstanceBusinessKey,
                           null,              // processInstanceBusinessKeyExpression,
                           null,              // processInstanceBusinessKeyIn,
                           null,              // processInstanceBusinessKeyLike,
                           null,              // processInstanceBusinessKeyLikeExpression,
                           null,              // processDefinitionId,
                           null,              // processDefinitionKey,
                           null,              // processDefinitionKeyIn,
                           null,              // processDefinitionName,
                           null,              // processDefinitionNameLike,
                           null,              // executionId,
                           null,              // caseInstanceId,
                           null,              // caseInstanceBusinessKey,
                           null,              // caseInstanceBusinessKeyLike,
                           null,              // caseDefinitionId,
                           null,              // caseDefinitionKey,
                           null,              // caseDefinitionName,
                           null,              // caseDefinitionNameLike,
                           null,              // caseExecutionId,
                           null,              // activityInstanceIdIn,
                           null,              // tenantIdIn,
                           null,              // withoutTenantId,
                           null,              // assignee,
                           null,              // assigneeExpression,
                           null,              // assigneeLike,
                           null,              // assigneeLikeExpression,
                           null,              // assigneeIn,
                           null,              // assigneeNotIn,
                           null,              // owner,
                           null,              // ownerExpression,
                           null,              // candidateGroup,
                           null,              // candidateGroupLike,
                           null,              // candidateGroupExpression,
                           null,              // candidateUser,
                           null,              // candidateUserExpression,
                           null,              // includeAssignedTasks,
                           null,              // involvedUser,
                           null,              // involvedUserExpression,
                           null,              // assigned,
                           null,              // unassigned,
                           userTaskDefId,     // taskDefinitionKey,
                           null,              // taskDefinitionKeyIn,
                           null,              // taskDefinitionKeyLike,
                           null,              // name,
                           null,              // nameNotEqual,
                           null,              // nameLike,
                           null,              // nameNotLike,
                           null,              // description,
                           null,              // descriptionLike,
                           null,              // priority,
                           null,              // maxPriority,
                           null,              // minPriority,
                           null,              // dueDate,
                           null,              // dueDateExpression,
                           null,              // dueAfter,
                           null,              // dueAfterExpression,
                           null,              // dueBefore,
                           null,              // dueBeforeExpression,
                           null,              // withoutDueDate,
                           null,              // followUpDate,
                           null,              // followUpDateExpression,
                           null,              // followUpAfter,
                           null,              // followUpAfterExpression,
                           null,              // followUpBefore,
                           null,              // followUpBeforeExpression,
                           null,              // followUpBeforeOrNotExistent,
                           null,              // followUpBeforeOrNotExistentExpression,
                           null,              // createdOn,
                           null,              // createdOnExpression,
                           null,              // createdAfter,
                           null,              // createdAfterExpression,
                           null,              // createdBefore,
                           null,              // createdBeforeExpression,
                           null,              // updatedAfter,
                           null,              // updatedAfterExpression,
                           null,              // delegationState,
                           null,              // candidateGroups,
                           null,              // candidateGroupsExpression,
                           null,              // withCandidateGroups,
                           null,              // withoutCandidateGroups,
                           null,              // withCandidateUsers,
                           null,              // withoutCandidateUsers,
                           null,              // active,
                           null,              // suspended,
                           null,              // taskVariables,
                           null,              // processVariables,
                           null,              // caseInstanceVariables,
                           null,              // variableNamesIgnoreCase,
                           null,              // variableValuesIgnoreCase,
                           null,              // parentTaskId,
                           null,              // withCommentAttachmentInfo,
                           null,              // sortBy,
                           null,              // sortOrder,
                           null,              // firstResult,
                           null               // maxResults) throws ApiException {
                         )
                     .mapError(err =>
                       EngineError.ProcessError(s"Problem getting tasks: $err")
                     )
      _         <- logDebug(s"TaskDtos found: $taskDtos")
    yield mapToUserTasks(taskDtos)

  def complete(
      taskId: String,
      processVariables: JsonObject,
      identityCorrelation: Option[IdentityCorrelation]
  ): IO[EngineError, Unit] =
    for
      apiClient <- apiClientZIO
      _         <- logInfo(s"Completing UserTask: $taskId")

      // Get existing correlation from process or use provided one
      existingCorr <- getOrUpdateCorrelation(taskId, identityCorrelation)
      _            <- logInfo(s"existingCorr existingCorr: $taskId")

      // Get processInstanceId from task
      processInstanceId <- getProcessInstanceIdFromTask(taskId)

      // Sign the correlation with processInstanceId if provided
      signedCorr <- existingCorr match
                      case Some(corr) => signCorrelation(corr, processInstanceId)
                      case None       => ZIO.succeed(None)
      _          <- logInfo(s"existingCorr $signedCorr: $taskId")

      // Build variables with signed correlation
      jsonObj = processVariables.add(
                       InputParams.identityCorrelation.toString,
                       signedCorr.asJson.deepDropNullValues
                     )
      _           <- logInfo(s"complete UserTask: $taskId - $jsonObj")

      variableDtos <- toC7Variables(CamundaVariable.jsonObjectToProcessVariables(jsonObj))
      _            <- ZIO
                        .attempt:
                          new TaskApi(apiClient)
                            .complete(
                              taskId,
                              new CompleteTaskDto()
                                .variables(variableDtos.asJava)
                            )
                        .mapError(err =>
                          EngineError.ProcessError(s"Problem completing task: $err")
                        )
      _            <- logInfo(s"UserTask completed: $taskId")
    yield ()

  private def mapToUserTasks(taskDtos: java.util.List[TaskWithAttachmentAndCommentDto])
      : Option[UserTask] =
    taskDtos.asScala.headOption.map: taskDto =>
      UserTask(
        id = Option(taskDto.getId).getOrElse("taskId not set!"),
        name = Option(taskDto.getName),
        assignee = Option(taskDto.getAssignee),
        created = Option(taskDto.getCreated),
        due = Option(taskDto.getDue),
        followUp = Option(taskDto.getFollowUp),
        priority = Option(taskDto.getPriority).map(_.toInt),
        processDefinitionId = Option(taskDto.getProcessDefinitionId),
        processInstanceId = Option(taskDto.getProcessInstanceId),
        taskDefinitionKey = Option(taskDto.getTaskDefinitionKey),
        formKey = Option(taskDto.getFormKey),
        camundaFormRef = None, // not mapped
        tenantId = Option(taskDto.getTenantId),
        // These fields might not be available in the basic TaskDto
        // and might require a different API call or DTO
        taskState = None       // Not directly available in TaskDto
      )

  private[c7] def toC7Variables(camundaVariables: Map[String, CamundaVariable])
      : IO[MappingError, Map[String, VariableValueDto]] =
    ZIO.foreach(camundaVariables.filterNot(_._2 == CNull)): (k, v) =>
      toC7VariableValue(v).map(k -> _)

  private[c7] def toC7VariableValue(cValue: CamundaVariable) =
    ZIO
      .attempt:
        new VariableValueDto()
          .value(cValue.value)
          .`type`(cValue.`type`)
      .mapError: err =>
        MappingError(
          s"Problem mapping CamundaVariable (${cValue.value}:${cValue.`type`}) to C7VariableValue: $err"
        )

  private def getOrUpdateCorrelation(
      taskId: String,
      identityCorrelation: Option[IdentityCorrelation]
  ): IO[EngineError, Option[IdentityCorrelation]] =
    for
      apiClient <- apiClientZIO
      variables <-
        ZIO
          .attempt:
            new TaskApi(apiClient)
              .getFormVariables(
                taskId,
                s"identityCorrelation,doOverrideImpersonation,$impersonateProcessKeyLabel",
                false
              ).asScala
          .mapError: err =>
            EngineError.ProcessError(s"Problem getting form variables: $err")

      doOverrideImpersonation <- checkOverride(variables)
      impersonateProcessValue <- impersonateProcessValue(variables)
      idCorrelation           <-
        if doOverrideImpersonation then
          // impersonateProcessValue is not set in the identityCorrelation, but maybe in the existing Correlation
          ZIO.succeed(identityCorrelation.map(_.copy(impersonateProcessValue =
            impersonateProcessValue
          )))
        else
          variables
            .get(InputParams.identityCorrelation.toString)
            .map: dto =>
              toVariableValue(dto)
                .map: v =>
                  val json = v.toJson
                  Some(
                    IdentityCorrelation(
                      username =
                        json.hcursor.downField("username").as[String].getOrElse("BAD_USERNAME"),
                      email = json.hcursor.downField("email").as[Option[String]].getOrElse(None),
                      impersonateProcessValue = json.hcursor.downField(
                        "impersonateProcessValue"
                      ).as[Option[String]].getOrElse(None),
                      issuedAt = json.hcursor.downField(
                        "issuedAt"
                      ).as[Long].getOrElse(System.currentTimeMillis()),
                      processInstanceId = json.hcursor.downField(
                        "processInstanceId"
                      ).as[Option[String]].getOrElse(None),
                      signature =
                        json.hcursor.downField("signature").as[Option[String]].getOrElse(None)
                    )
                  )
            .getOrElse(ZIO.none)
    yield idCorrelation

  private def checkOverride(variables: mutable.Map[String, VariableValueDto])
      : ZIO[Any, Nothing, Boolean] =
    ZIO
      .attempt:
        variables.get("doOverrideImpersonation").forall(v => Boolean.unbox(v.getValue))
      .catchAll: err =>
        ZIO.logError(s"Problem getting doOverrideImpersonation: $err")
          .as(true)

  private def impersonateProcessValue(variables: mutable.Map[String, VariableValueDto])
      : ZIO[Any, Nothing, Option[String]] =
    ZIO
      .attempt:
        variables.get(impersonateProcessKeyLabel).map(v => String.valueOf(v.getValue))
      .catchAll: err =>
        ZIO.logError(s"Problem getting impersonateProcessValue: $err")
          .as(None)

  private lazy val impersonateProcessKeyLabel = engineConfig.impersonateProcessKey.getOrElse("NONE")

  private def getProcessInstanceIdFromTask(taskId: String): IO[EngineError, String] =
    for
      apiClient         <- apiClientZIO
      task              <- ZIO
                             .attempt:
                               new TaskApi(apiClient).getTask(taskId)
                             .mapError(err =>
                               EngineError.ProcessError(s"Problem getting task: $err")
                             )
      processInstanceId <- ZIO
                             .fromOption(Option(task.getProcessInstanceId))
                             .mapError(_ =>
                               EngineError.ProcessError(s"Task $taskId has no processInstanceId")
                             )
    yield processInstanceId

  private def signCorrelation(
      correlation: IdentityCorrelation,
      processInstanceId: String
  ): IO[EngineError, Option[IdentityCorrelation]] =
    engineConfig.identitySigningKey match
      case Some(key) =>
        ZIO.succeed:
          Some(
            orchescala.domain.IdentityCorrelationSigner.sign(
              correlation.copy(processInstanceId = Some(processInstanceId)),
              processInstanceId,
              key
            )
          )
      case None      =>
        ZIO.logWarning(
          "No identity signing key configured - correlation will not be signed"
        ) *>
          ZIO.succeed(Some(correlation.copy(processInstanceId = Some(processInstanceId))))

end C7UserTaskService
