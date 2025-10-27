package orchescala.engine
package c7

import orchescala.domain.CamundaVariable.CNull
import orchescala.domain.{CamundaVariable, InOutDecoder, InOutEncoder, Json, JsonProperty}
import orchescala.engine.*
import orchescala.engine.domain.EngineError.MappingError
import orchescala.engine.domain.{EngineError, UserTask}
import orchescala.engine.services.UserTaskService
import org.camunda.community.rest.client.api.{ProcessInstanceApi, TaskApi}
import org.camunda.community.rest.client.dto.{
  CompleteTaskDto,
  TaskWithAttachmentAndCommentDto,
  VariableValueDto
}
import org.camunda.community.rest.client.invoker.ApiClient
import zio.ZIO.{logDebug, logInfo}
import zio.{IO, ZIO}
import io.circe.parser

import scala.jdk.CollectionConverters.*

class C7UserTaskService(val processInstanceService: C7ProcessInstanceService)(using apiClientZIO: IO[EngineError, ApiClient], engineConfig: EngineConfig)
    extends UserTaskService, C7Service:

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

  def complete(taskId: String, variables: Map[String, CamundaVariable]): IO[EngineError, Unit] =
    for
      apiClient    <- apiClientZIO
      _            <- logDebug(s"Completing UserTask: $taskId - $variables")
      variableDtos <- toC7Variables(variables)
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
  


end C7UserTaskService
