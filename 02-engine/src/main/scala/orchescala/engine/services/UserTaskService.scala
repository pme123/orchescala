package orchescala.engine.services

import orchescala.domain.{IdentityCorrelation, JsonProperty}
import orchescala.engine.domain.*
import sttp.tapir.Schema.annotations.description
import zio.{IO, ZIO, durationInt}

trait UserTaskService extends EngineService:

  def processInstanceService: ProcessInstanceService

  @description(
    """
      |Returns the user task for the current process instance. 
      |If there is no user task, it returns None.
      |""".stripMargin
  )
  def getUserTask(
      processInstanceId: String,
      userTaskDefId: String
  ): IO[EngineError, Option[UserTask]]

  def complete(
                taskId: String,
                processVariables: JsonObject,
                identityCorrelation: Option[IdentityCorrelation]
  ): IO[EngineError, Unit]

  @description(
    """
      |Returns the userTaskId (used for completing the task)and the variables as Json for the current user task in a process instance.
      |
      |Example: `(myUserTaskId, { "name": "John", "age": 30 })`
      |""".stripMargin
  )
  def getUserTaskVariables(
      @description(
        """
          |The id of the process instance.
          |""".stripMargin
      )
      processInstanceId: String,
      @description(
        """
          |The task definition key from the BPMN (used for API path differentiation in OpenAPI)
          |""".stripMargin
      )
      userTaskDefId: String,
      @description(
        """
          |A comma-separated list of variable names. Allows restricting the list of requested variables to the variable names in the list.
          |It is best practice to restrict the list of variables to the variables actually required by the form in order to minimize fetching of data. 
          |If the query parameter is ommitted all variables are fetched.
          |If the query parameter contains non-existent variable names, the variable names are ignored.
          |""".stripMargin
      )
      variableFilter: Option[String],
      @description(
        """
          |The maximum number of seconds to wait for the user task to become active.
          |If not provided, it will wait 10 seconds.
          |""".stripMargin
      )
      timeoutInSec: Option[Int]
  ): IO[EngineError, (String, Json)] =
    getUserTaskVariableJsonProps(
      processInstanceId,
      userTaskDefId,
      variableFilter.map(_.split(",").map(_.trim).toSeq),
      timeoutInSec.getOrElse(10)
    )
      .map: (userTaskId, variables) =>
        userTaskId -> Json.obj(variables.map(prop => prop.key -> prop.value)*)

  protected def getUserTaskVariableJsonProps(
      processInstanceId: String,
      userTaskDefId: String,
      variableFilter: Option[Seq[String]],
      timeoutInSec: Int
  ): IO[EngineError, (String, Seq[JsonProperty])] =
    for
      userTask                <- getUserTask(processInstanceId, userTaskDefId)
      (userTaskId, variables) <-
        if timeoutInSec <= 0 then
          ZIO.fail(EngineError.ProcessError("Timeout waiting for UserTask"))
        else if userTask.isEmpty then
          getUserTaskVariableJsonProps(
            processInstanceId,
            userTaskDefId,
            variableFilter,
            timeoutInSec - 1
          ).delay(1.second)
        else
          processInstanceService.getVariablesInternal(processInstanceId, variableFilter)
            .map(userTask.get.id -> _)
    yield (userTaskId, variables)
end UserTaskService
