package orchescala.engine.services

import orchescala.domain.{IdentityCorrelation, JsonProperty}
import orchescala.engine.domain.*
import sttp.tapir.Schema.annotations.description
import zio.{IO, ZIO, durationInt}

trait UserTaskService extends EngineService:
  
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

  def variables(
                 taskId: String,
                 processInstanceId: String,
                 variableFilter: Option[Seq[String]]
               ): IO[EngineError, Seq[JsonProperty]]

  @description(
    """
      |Returns a Seq of variables as JsonProperties for the current user task with the given taskDefinitionKey in a process instance.
      |
      |Example: `[{ "name": "John"}, {"age": 30 }]`
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
          |The object with the variables you are interested in.
          |If not set, it will return all variables.
          |""".stripMargin
      )
      variableFilter: Option[Product],
      @description(
        """
          |The maximum number of seconds to wait for the user task to become active.
          |If not provided, it will wait 10 seconds - at most 60 seconds.
          |""".stripMargin
      )
      timeoutInSec: Option[Int]
  ): IO[EngineError, Seq[JsonProperty]] =
    getUserTaskVariableJsonProps(
      processInstanceId,
      userTaskDefId,
      variableFilter.map(_.productElementNames.map(_.trim).toSeq),
      timeoutInSec.getOrElse(10)
    ).map: (_, variables) =>
      variables

  @description(
    """
      |Returns the userTaskId (used for completing the task)and the variables as Json for the current user task in a process instance.
      |
      |Example: `(myUserTaskId, { "name": "John", "age": 30 })`
      |""".stripMargin
  )
  def getUserTaskVariablesInternal(
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
          |If not provided, it will wait 10 seconds - at most 60 seconds.
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
    // a caller's timeout held the request (and a connection) open for as long as it asked for,
    // polling the engine every second
    val timeout = timeoutInSec.min(UserTaskService.maxTimeoutInSec)
    for
      userTask                <- getUserTask(processInstanceId, userTaskDefId)
      (userTaskId, variables) <-
        userTask match
          // an active task is returned - also with timeoutInSec=0 (it failed before looking)
          case Some(task)           =>
            this.variables(task.id, processInstanceId, variableFilter)
              .map(task.id -> _)
          case None if timeout <= 0 =>
            ZIO.fail(EngineError.ServiceRequestError(
              404,
              s"No active UserTask '$userTaskDefId' in Process Instance '$processInstanceId'"
            ))
          case None                 =>
            getUserTaskVariableJsonProps(
              processInstanceId,
              userTaskDefId,
              variableFilter,
              timeout - 1
            ).delay(1.second)
    yield (userTaskId, variables)
    end for
  end getUserTaskVariableJsonProps
end UserTaskService

object UserTaskService:
  /** The longest a request waits for a user task to become active. */
  val maxTimeoutInSec = 60
end UserTaskService
