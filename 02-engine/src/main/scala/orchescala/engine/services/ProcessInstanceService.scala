package orchescala.engine.services

import orchescala.domain.*
import orchescala.engine.domain.*
import zio.*

trait ProcessInstanceService extends EngineService:

  def startProcessAsync(
      processDefId: String,
      in: JsonObject,
      businessKey: Option[String],
      tenantId: Option[String],
      identityCorrelation: Option[IdentityCorrelation]
  ): IO[EngineError, ProcessInfo]

  @description(
    """
      |Starts a process instance by sending a message to a Message Start Event.
      |This is used when a process is triggered by a message rather than being started directly.
      |
      |If identityCorrelation is provided, it will be signed with the resulting processInstanceId
      |and stored as a process variable after the process is started.
      |""".stripMargin
  )
  def startProcessByMessage(
      messageName: String,
      businessKey: Option[String] = None,
      tenantId: Option[String] = None,
      variables: Option[JsonObject] = None,
      identityCorrelation: Option[IdentityCorrelation] = None
  ): IO[EngineError, ProcessInfo]

  def getVariablesInternal(
      processInstanceId: String,
      @description(
        """
          |A List of variable names. Allows restricting the requested variables to the variable names in the list.
          |It is best practice to restrict the list of variables to the variables actually required by the form in order to minimize fetching of data. 
          |If the query parameter is ommitted all variables are fetched.
          |If the query parameter contains non-existent variable names, the variable names are ignored.
          |""".stripMargin
      )
      variableFilter: Option[Seq[String]]
  ): IO[EngineError, Seq[JsonProperty]]
  
  def getVariables(
      processInstanceId: String,
      @description(
        """
          |The object with the variables you are interested in.
          |If not set, it will return all variables.
          |""".stripMargin
      )
      inOut: Option[Product]
  ): IO[EngineError, Seq[JsonProperty]] =
    getVariablesInternal(processInstanceId, inOut.map(_.productElementNames.toSeq))

end ProcessInstanceService
