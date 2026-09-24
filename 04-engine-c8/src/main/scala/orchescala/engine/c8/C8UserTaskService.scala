package orchescala.engine.c8

import orchescala.domain.{IdentityCorrelation, InputParams, Json, JsonProperty}
import orchescala.engine.*
import orchescala.engine.domain.{EngineError, UserTask}
import orchescala.engine.services.UserTaskService
import zio.ZIO.logInfo
import zio.{IO, ZIO}

class C8UserTaskService()(using
    rest: C8RestClient,
    engineConfig: EngineConfig
) extends UserTaskService, C8Service:

  def getUserTask(
      processInstanceId: String,
      userTaskDefId: String
  ): IO[EngineError, Option[UserTask]] =
    for
      processInstanceKey <- toKey("processInstanceId")(processInstanceId)
      userTaskDtos       <-
        rest
          .post[C8RestClient.SearchResult[C8RestModel.UserTaskResult]](
            Seq("user-tasks", "search"),
            Json.obj(
              "filter" -> C8RestModel.filter(
                "processInstanceKey" -> Some(Json.fromString(processInstanceKey)),
                "elementId"          -> Some(Json.fromString(userTaskDefId))
              ),
              "page"   -> Json.obj("limit" -> Json.fromInt(1))
            )
          )
          .mapError(withContext(
            s"Problem getting UserTask for Process Instance '$processInstanceId'"
          ))
    yield userTaskDtos.items.headOption.map(mapToUserTask)

  def complete(
      taskId: String,
      processVariables: JsonObject,
      identityCorrelation: Option[IdentityCorrelation]
  ): IO[EngineError, Unit] =
    for
      taskKey           <- toKey("taskId")(taskId)
      // Get processInstanceId from task
      processInstanceId <- getProcessInstanceIdFromTask(taskKey)
      // Sign the correlation with processInstanceId if provided
      signedCorr        <- identityCorrelation match
                             case Some(corr) => signCorrelation(corr, processInstanceId)
                             case None       => ZIO.none
      jsonVariables      =
        signedCorr
          .map: s =>
            processVariables.add(InputParams._identityCorrelation.toString, s.asJson.deepDropNullValues)
          .getOrElse(processVariables)
      _                 <-
        rest
          .postNoContent(
            Seq("user-tasks", taskKey, "completion"),
            Json.obj("variables" -> Json.fromJsonObject(jsonVariables))
          )
          .mapError(withContext(s"Problem completing UserTask '$taskKey'"))
    yield ()

  private def mapToUserTask(taskDto: C8RestModel.UserTaskResult): UserTask =
    UserTask(
      id = taskDto.userTaskKey,
      name = taskDto.name,
      assignee = taskDto.assignee,
      created = taskDto.creationDate,
      due = taskDto.dueDate,
      followUp = taskDto.followUpDate,
      priority = taskDto.priority,
      processDefinitionId = taskDto.processDefinitionKey,
      processInstanceId = taskDto.processInstanceKey,
      taskDefinitionKey = taskDto.processDefinitionId,
      formKey = taskDto.externalFormReference,
      camundaFormRef = taskDto.formKey,
      tenantId = taskDto.tenantId,
      taskState = taskDto.state
    )
  end mapToUserTask

  private def getProcessInstanceIdFromTask(taskKey: String): IO[EngineError, String] =
    for
      userTask          <- rest
                             .get[C8RestModel.UserTaskResult](Seq("user-tasks", taskKey))
                             .mapError(withContext(s"Problem getting user task '$taskKey'"))
      processInstanceId <- ZIO
                             .fromOption(userTask.processInstanceKey)
                             .orElseFail(
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

  def variables(
      taskId: String,
      processInstanceId: String,
      variableFilter: Option[Seq[String]]
  ): IO[EngineError, Seq[JsonProperty]] =
    for
      taskKey      <- toKey("taskId")(taskId)
      variableDtos <-
        rest
          .searchAll[C8RestModel.VariableResult](
            Seq("user-tasks", taskKey, "variables", "search"),
            C8RestModel.filter("name" -> C8RestModel.nameFilter(variableFilter.toSeq.flatten)),
            query = Map("truncateValues" -> "false")
          )
          .mapError(withContext(
            s"Problem getting Variables of UserTask '$taskId' (Process Instance '$processInstanceId')"
          ))
      variables    <-
        ZIO
          .foreach(filterVariables(variableFilter, variableDtos)): dto =>
            toVariableValue(dto)
          .mapError: err =>
            EngineError.ProcessError(
              s"Problem converting Variables for Process Instance '$processInstanceId' to Json: $err"
            )
      _            <- logInfo(s"Variables for Process Instance '$processInstanceId': $variables")
    yield variables

end C8UserTaskService
