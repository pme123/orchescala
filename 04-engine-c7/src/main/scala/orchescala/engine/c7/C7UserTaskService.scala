package orchescala.engine
package c7

import orchescala.domain.CamundaVariable.CNull
import orchescala.domain.{CamundaVariable, IdentityCorrelation, InputParams, JsonProperty}
import orchescala.engine.*
import orchescala.engine.domain.EngineError.MappingError
import orchescala.engine.domain.{EngineError, UserTask}
import orchescala.engine.services.UserTaskService
import org.camunda.community.rest.client.api.TaskApi
import org.camunda.community.rest.client.dto.{CompleteTaskDto, TaskQueryDto, TaskWithAttachmentAndCommentDto, VariableValueDto}
import org.camunda.community.rest.client.invoker.ApiClient
import zio.ZIO.{logDebug, logInfo}
import zio.{IO, ZIO}

import scala.collection.mutable
import scala.jdk.CollectionConverters.*

class C7UserTaskService() (using
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
      query     =  new TaskQueryDto()
                     .processInstanceId(processInstanceId)
                     .taskDefinitionKey(userTaskDefId)
      taskDtos  <- ZIO
                     .attemptBlocking:
                       new TaskApi(apiClient).queryTasks(null, null, query)
                     .mapError(err =>
                       C7Service.withStatus(err)(EngineError.ProcessError(s"Problem getting tasks: $err"))
                     )
      _         <- logDebug(s"TaskDtos found: ${taskDtos.size}")
    yield mapToUserTasks(taskDtos)
  
  def variables(
      taskId: String,
      processInstanceId: String,
      variableFilter: Option[Seq[String]]
              ): IO[EngineError, Seq[JsonProperty]] =
    for
      apiClient <- apiClientZIO
      _ <- ZIO.logDebug(s"Getting Variables for UserTask '$taskId' of ProcessInstance '$processInstanceId' with variableFilter: ${variableFilter.toSeq.flatten.mkString(",")}")
      variableDtos <-
        ZIO
          .attemptBlocking:
            new TaskApi(apiClient)
              .getFormVariables(taskId, variableFilter.map(_.mkString(",")).orNull, false)
          .mapError: err =>
            C7Service.withStatus(err)(EngineError.ProcessError(
              s"Problem getting Variables for UserTask '$taskId' of ProcessInstance '$processInstanceId': $err"
            ))
      variables <-
        ZIO
          .foreach(filterVariables(variableFilter, variableDtos)):
            case k -> dto =>
              toVariableValue(dto).map(v => JsonProperty(k, v.toJson))
          .mapError: err =>
            C7Service.withStatus(err)(EngineError.ProcessError(
              s"Problem converting Variables for Process Instance '$processInstanceId' to Json: $err"
            ))
      // names only - the values hold personal data
      _ <- logInfo(s"Variables for Process Instance '$processInstanceId': ${variables.map(_.key).mkString(", ")}")
    yield variables.toSeq
    
  def complete(
      taskId: String,
      processVariables: JsonObject,
      identityCorrelation: Option[IdentityCorrelation]
  ): IO[EngineError, Unit] =
    withoutCallerIdentityCorrelation(processVariables).flatMap: processVariables =>
      for
        apiClient <- apiClientZIO
        _         <- logInfo(s"Completing UserTask: $taskId")

        processInstanceId <- getProcessInstanceIdFromTask(taskId)
        // the actor's identity under its own name - `_identityCorrelation` stays as set at the start
        signedActor       <- ZIO.foreach(identityCorrelation)(signedFor(_, processInstanceId))
        overridden        <- overriddenCorrelation(taskId, identityCorrelation, processInstanceId)
        withActor          = signedActor.fold(processVariables)(withActorIdentity(processVariables, _))
        jsonObj            = overridden.fold(withActor): corr =>
                               withActor.add(
                                 InputParams._identityCorrelation.toString,
                                 corr.asJson.deepDropNullValues
                               )
        _                  <- logInfo(s"complete UserTask: $taskId - ${jsonObj.keys.mkString(", ")}")

        variableDtos <- toC7Variables(CamundaVariable.jsonObjectToProcessVariables(jsonObj))
        _            <- ZIO
                          .attemptBlocking:
                            new TaskApi(apiClient)
                              .complete(
                                taskId,
                                new CompleteTaskDto()
                                  .variables(variableDtos.asJava)
                              )
                          .mapError(err =>
                            C7Service.withStatus(err)(EngineError.ProcessError(s"Problem completing task: $err"))
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

  /** DEPRECATED - only for processes that still rely on it (with the old `impersonateUserId`
    * scripts): a user task with the form variable `doOverrideImpersonation = true` also overwrites
    * `_identityCorrelation` with the actor's identity (its `impersonateProcessValue` from the
    * task's form variable `engineConfig.impersonateProcessKey`). Without it - or with `false` - the
    * process keeps its identity; take over `_identityCorrelationOfActor` in the BPMN instead.
    */
  private def overriddenCorrelation(
      taskId: String,
      identityCorrelation: Option[IdentityCorrelation],
      processInstanceId: String
  ): IO[EngineError, Option[IdentityCorrelation]] =
    identityCorrelation match
      case None              => ZIO.none
      case Some(correlation) =>
        for
          apiClient               <- apiClientZIO
          variables               <-
            ZIO
              .attemptBlocking:
                new TaskApi(apiClient)
                  .getFormVariables(taskId, s"doOverrideImpersonation,$impersonateProcessKeyLabel", false)
                  .asScala
              .mapError: err =>
                C7Service.withStatus(err)(EngineError.ProcessError(s"Problem getting form variables: $err"))
          doOverride               = isOverride(variables)
          impersonateProcessValue <- impersonateProcessValue(variables)
          overridden              <-
            if doOverride then
              ZIO.logWarning(
                s"UserTask '$taskId': `doOverrideImpersonation` is deprecated - " +
                  "take over `_identityCorrelationOfActor` in the BPMN instead."
              ) *>
                signedFor(correlation.copy(impersonateProcessValue = impersonateProcessValue), processInstanceId)
                  .map(Some(_))
            else ZIO.none
        yield overridden

  /** Only an explicit `true` (Boolean or "true") - a missing flag no longer overwrites. */
  private[c7] def isOverride(variables: collection.Map[String, VariableValueDto]): Boolean =
    variables.get("doOverrideImpersonation").map(_.getValue).exists:
      case b: java.lang.Boolean => b.booleanValue
      case s: String            => s.trim.equalsIgnoreCase("true")
      case _                    => false

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
                             .attemptBlocking:
                               new TaskApi(apiClient).getTask(taskId)
                             .mapError(err =>
                               C7Service.withStatus(err)(EngineError.ProcessError(s"Problem getting task: $err"))
                             )
      processInstanceId <- ZIO
                             .fromOption(Option(task.getProcessInstanceId))
                             .mapError(_ =>
                               EngineError.ProcessError(s"Task $taskId has no processInstanceId")
                             )
    yield processInstanceId

end C7UserTaskService
