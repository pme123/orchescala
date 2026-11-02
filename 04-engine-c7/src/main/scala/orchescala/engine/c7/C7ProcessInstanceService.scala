package orchescala.engine
package c7

import orchescala.domain.*
import orchescala.domain.CamundaVariable.*
import orchescala.engine.*
import orchescala.engine.domain.{EngineError, MessageCorrelationResult, ProcessInfo}
import orchescala.engine.services.ProcessInstanceService
import org.camunda.community.rest.client.api.{ProcessDefinitionApi, ProcessInstanceApi}
import org.camunda.community.rest.client.dto.{
  PatchVariablesDto,
  ProcessInstanceWithVariablesDto,
  StartProcessInstanceDto,
  VariableValueDto
}
import org.camunda.community.rest.client.invoker.ApiClient
import zio.ZIO.{logDebug, logInfo, logWarning}
import zio.{durationInt, Duration, IO, UIO, ZIO}

import scala.jdk.CollectionConverters.*

class C7ProcessInstanceService(
    timings: C7ProcessInstanceService.StartTimings = C7ProcessInstanceService.StartTimings()
)(using
    apiClientZIO: IO[EngineError, ApiClient],
    engineConfig: EngineConfig
) extends ProcessInstanceService, C7Service, C7EventService:

  override def startProcessAsync(
      processDefId: String,
      in: JsonObject,
      businessKey: Option[String],
      tenantId: Option[String],
      identityCorrelation: Option[IdentityCorrelation]
  ): IO[EngineError, ProcessInfo] =
    withoutCallerIdentityCorrelation(in).flatMap: in =>
      identityCorrelation match
        case None =>
          // No identity correlation - start process normally
          startProcessWithoutCorrelation(processDefId, in, businessKey, tenantId)

        case Some(correlation) =>
          // Two-step flow: start process, then set signed correlation
          startProcessWithSignedCorrelation(processDefId, in, businessKey, tenantId, correlation)
  end startProcessAsync

  /** Start process without identity correlation (simple flow)
    */
  private def startProcessWithoutCorrelation(
      processDefId: String,
      in: JsonObject,
      businessKey: Option[String],
      tenantId: Option[String]
  ): IO[EngineError, ProcessInfo] =
    for
      _                <- ZIO.logDebug(s"Starting Process without Correlation '$processDefId' with variables: ${orchescala.engine.LogSafe.names(in)}")
      apiClient        <- apiClientZIO
      processVariables <- C7VariableMapper.toC7Variables(in.asJson)
      instance         <-
        callStartProcessAsync(processDefId, businessKey, tenantId, apiClient, processVariables)
      _                <- logInfo(s"Process without Correlation started: ${instance.getId}")
    yield ProcessInfo(
      processInstanceId = instance.getId,
      businessKey = Option(instance.getBusinessKey),
      status = ProcessInfo.ProcessStatus.Active,
      engineType = engineType
    )
  end startProcessWithoutCorrelation

  /** Start process with signed identity correlation (two-step flow) Step 1: Start process without
    * correlation Step 2: Sign correlation with processInstanceId and set as variable
    */
  private def startProcessWithSignedCorrelation(
      processDefId: String,
      in: JsonObject,
      businessKey: Option[String],
      tenantId: Option[String],
      correlation: IdentityCorrelation
  ): IO[EngineError, ProcessInfo] =
    for
      _         <- ZIO.logDebug(s"Starting Process with Correlation '$processDefId' with variables: ${orchescala.engine.LogSafe.names(in)}")
      apiClient <- apiClientZIO
      // Step 1: Start process WITHOUT correlation - marked as pending: a worker fetching a job before
      // step 3 waits for it (it ran without the user's identity before)
      _                 <- ZIO.logDebug(s"Starting Process '$processDefId' (will sign correlation after): ${orchescala.engine.LogSafe.names(in)}")
      processVariables  <- C7VariableMapper.toC7Variables(withIdentityPending(in).asJson)
      instance          <-
        callStartProcessAsync(processDefId, businessKey, tenantId, apiClient, processVariables)
      processInstanceId  = instance.getId
      _                 <- logInfo(s"Process started: $processInstanceId")
      // Step 2: Sign correlation with processInstanceId
      signedCorrelation <- signCorrelation(correlation, processInstanceId)
      _                 <- ZIO.logDebug(s"Signed correlation: $signedCorrelation")
      // Step 3: Set signed correlation as process variable
      _                 <- setCorrelationVariableOfStarted(apiClient, processInstanceId, signedCorrelation)
      _                 <- ZIO.logDebug(s"Set signed IdentityCorrelation for process instance '$processInstanceId'")
    yield ProcessInfo(
      processInstanceId = processInstanceId,
      businessKey = Option(instance.getBusinessKey),
      status = ProcessInfo.ProcessStatus.Active,
      engineType = engineType
    )
  end startProcessWithSignedCorrelation

  /** Sign the identity correlation with the process instance ID
    */
  private def signCorrelation(
      correlation: IdentityCorrelation,
      processInstanceId: String
  ): IO[EngineError, IdentityCorrelation] =
    engineConfig.identitySigningKey match
      case None            =>
        logWarning("No identitySigningKey configured - correlation will not be signed!").as(
          correlation.copy(processInstanceId = Some(processInstanceId))
        )
      case Some(secretKey) =>
        ZIO.succeed(
          IdentityCorrelationSigner.sign(correlation, processInstanceId, secretKey)
        )
  end signCorrelation

  /** Step 3 of a start: the process runs already - a failure is logged, not returned. Returned, the
    * caller (or the gateway with the next engine) started the process again. Its workers wait for
    * the correlation (`_identityCorrelationPending`), then end in an incident.
    */
  private def setCorrelationVariableOfStarted(
      apiClient: ApiClient,
      processInstanceId: String,
      signedCorrelation: IdentityCorrelation
  ): UIO[Unit] =
    setCorrelationVariable(apiClient, processInstanceId, signedCorrelation)
      .catchAll: err =>
        ZIO.logError(
          s"Process $processInstanceId started, but its IdentityCorrelation could not be set - its workers wait for it, then end in an incident: ${err.errorMsg}"
        )

  /** Set the signed correlation as a process variable using Camunda REST API - and remove the
    * pending marker of the start.
    */
  private def setCorrelationVariable(
      apiClient: ApiClient,
      processInstanceId: String,
      signedCorrelation: IdentityCorrelation
  ): IO[EngineError, Unit] =
    for
      correlationJson <- ZIO.succeed(signedCorrelation.asJson.deepDropNullValues)
      correlationVar  <- ZIO.succeed(CJson(correlationJson.toString))
      correlationDto  <- C7VariableMapper.toC7VariableValue(correlationVar)
      _               <- ZIO
                           .attemptBlocking:
                             val modifications = new PatchVariablesDto()
                               .modifications(Map(InputParams._identityCorrelation.toString -> correlationDto).asJava)
                               .deletions(List(InputParams._identityCorrelationPending.toString).asJava)
                             new ProcessInstanceApi(apiClient)
                               .modifyProcessInstanceVariables(processInstanceId, modifications)
                           .catchAll:
                             case err if err.getMessage.contains("doesn't exist: execution is null") =>
                               ZIO.logWarning(
                                 s"Process $processInstanceId has already ended - correlation not set."
                               )
                             case err                                                                =>
                               ZIO.fail:
                                 EngineError.ProcessError(
                                   s"Problem setting identityCorrelation variable for process '$processInstanceId': $err"
                                 )
    yield ()
  end setCorrelationVariable

  private def callStartProcessAsync(
      processDefId: String,
      businessKey: Option[String],
      tenantId: Option[String],
      apiClient: ApiClient,
      processVariables: Map[String, VariableValueDto]
  ): ZIO[Any, EngineError, ProcessInstanceWithVariablesDto] =
    val effectiveTenantId = tenantId.orElse(engineConfig.tenantId)
    ZIO
      .attemptBlocking:
        val api = new ProcessDefinitionApi(apiClient)
        effectiveTenantId
          .map: tenantId =>
            api.startProcessInstanceByKeyAndTenantId(
              processDefId,
              tenantId,
              new StartProcessInstanceDto()
                .variables(processVariables.asJava)
                .businessKey(businessKey.orNull)
            )
          .getOrElse:
            api.startProcessInstanceByKey(
              processDefId,
              new StartProcessInstanceDto()
                .variables(processVariables.asJava)
                .businessKey(businessKey.orNull)
            )
      .mapError: err =>
        C7Service.withStatus(err)(EngineError.ProcessError(
          s"Problem starting Process '$processDefId': ${err.getMessage}"
        ))
  end callStartProcessAsync

  def getVariablesInternal(
      processInstanceId: String,
      variableFilter: Option[Seq[String]]
  ): IO[EngineError, Seq[JsonProperty]] =
    for
      apiClient    <- apiClientZIO
      variableDtos <-
        ZIO
          .attemptBlocking:
            new ProcessInstanceApi(apiClient)
              .getProcessInstanceVariables(processInstanceId, false)
          .mapError: err =>
            C7Service.withStatus(err)(EngineError.ProcessError(
              s"Problem getting Variables for Process Instance '$processInstanceId': $err"
            ))
      variables    <-
        ZIO
          .foreach(filterVariables(variableFilter, variableDtos)):
            case k -> dto =>
              toVariableValue(dto).map(v => JsonProperty(k, v.toJson))
          .mapError: err =>
            C7Service.withStatus(err)(EngineError.ProcessError(
              s"Problem converting Variables for Process Instance '$processInstanceId' to Json: $err"
            ))
      // names only - the values hold personal data
      _            <- logInfo(s"Variables for Process Instance '$processInstanceId': ${variables.map(_.key).mkString(", ")}")
    yield variables.toSeq



  def startProcessByMessage(
      messageName: String,
      businessKey: Option[String] = None,
      tenantId: Option[String] = None,
      variables: Option[JsonObject] = None,
      identityCorrelation: Option[IdentityCorrelation] = None
  ): IO[EngineError, ProcessInfo] =
    ZIO.foreach(variables)(withoutCallerIdentityCorrelation).flatMap: variables =>
      identityCorrelation match
        case None =>
          // No identity correlation - just send message
          startProcessByMessageWithoutCorrelation(messageName, businessKey, tenantId, variables)

        case Some(correlation) =>
          // Two-step flow: send message to start process, then set signed correlation
          startProcessByMessageWithSignedCorrelation(
            messageName,
            businessKey,
            tenantId,
            variables,
            correlation
          )
  end startProcessByMessage

  /** Start process by message without identity correlation (simple flow)
    */
  private def startProcessByMessageWithoutCorrelation(
      messageName: String,
      businessKey: Option[String],
      tenantId: Option[String],
      variables: Option[JsonObject]
  ): IO[EngineError, ProcessInfo] =
    for
      _                 <- logInfo(s"Starting process by message '$messageName'")
      correlationResult <- sendMessageToStartProcess(messageName, businessKey, tenantId, variables)
      processInstanceId  = correlationResult.processInstanceId
      _                 <- logInfo(
                             s"Process started by message '$messageName' with processInstanceId: $processInstanceId"
                           )
    yield ProcessInfo(
      processInstanceId = processInstanceId,
      businessKey = businessKey,
      status = ProcessInfo.ProcessStatus.Active,
      engineType = engineType
    )
  end startProcessByMessageWithoutCorrelation

  /** Start process by message with signed identity correlation (two-step flow) Step 1: Send message
    * to start process Step 2: Sign correlation with processInstanceId and set as variable
    */
  private def startProcessByMessageWithSignedCorrelation(
      messageName: String,
      businessKey: Option[String],
      tenantId: Option[String],
      variables: Option[JsonObject],
      correlation: IdentityCorrelation
  ): IO[EngineError, ProcessInfo] =
    for
      apiClient <- apiClientZIO

      // Step 1: Send message to start process
      _                 <- logInfo(s"Starting process by message '$messageName' (will sign correlation after)")
      correlationResult <- sendMessageToStartProcess(
                             messageName,
                             businessKey,
                             tenantId,
                             Some(withIdentityPending(variables.getOrElse(JsonObject.empty))),
                             // correlated to a running instance: the marker must not stay there
                             removePending = pid => clearIdentityPending(apiClient, pid)
                           )
      processInstanceId  = correlationResult.processInstanceId

      // Step 2: Sign correlation with processInstanceId
      signedCorrelation <- signCorrelation(correlation, processInstanceId)

      // Step 3: Set signed correlation as process variable
      _ <- setCorrelationVariableOfStarted(apiClient, processInstanceId, signedCorrelation)
      _ <- logInfo(s"Set signed IdentityCorrelation for process instance '$processInstanceId'")
    yield ProcessInfo(
      processInstanceId = processInstanceId,
      businessKey = businessKey,
      status = ProcessInfo.ProcessStatus.Active,
      engineType = engineType
    )
  end startProcessByMessageWithSignedCorrelation

  /** Send message to start a process (via Message Start Event)
    */
  private def sendMessageToStartProcess(
      messageName: String,
      businessKey: Option[String],
      tenantId: Option[String],
      variables: Option[JsonObject],
      removePending: String => IO[EngineError, Unit] = _ => ZIO.unit
  ): IO[EngineError, MessageCorrelationResult] =
    for
      apiClient <- apiClientZIO
      response  <-
        ZIO
          .attemptBlocking:
            new org.camunda.community.rest.client.api.MessageApi(apiClient)
              .deliverMessage(
                new org.camunda.community.rest.client.dto.CorrelationMessageDto()
                  .messageName(messageName)
                  .tenantId(tenantId.orElse(engineConfig.tenantId).orNull)
                  .businessKey(businessKey.orNull)
                  .processVariables(mapToC7Variables(variables))
                  .resultEnabled(true)
              )
          .mapError: err =>
            C7Service.withStatus(err)(EngineError.ProcessError(
              s"Problem sending message '$messageName' to start process: $err"
            ))
      result    <- mapMessageCorrelationResult(Option(response).map(_.asScala).toSeq.flatten)
      started   <- onlyStarted(messageName, result)
                     .catchAll: conflict =>
                       removePending(result.processInstanceId)
                         .as(conflict)
                         .catchAll: err =>
                           val notRemoved =
                             s"its pending identity marker could not be removed, its workers wait for a correlation: ${err.errorMsg}"
                           ZIO.logError(s"Process ${result.processInstanceId}: $notRemoved")
                             .as(withNotRemoved(conflict, notRemoved))
                         .flatMap(ZIO.fail(_))
    yield started
  end sendMessageToStartProcess

  private def withNotRemoved(conflict: EngineError, notRemoved: String): EngineError =
    conflict match
      case EngineError.ServiceRequestError(status, msg) => EngineError.ServiceRequestError(status, s"$msg - $notRemoved")
      case other                                        => other

  /** The message landed in a running instance and set its pending marker there. Its workers would
    * wait for a correlation that never comes - unless the instance has one: then the marker is
    * ignored (`WorkerHandler.verifyIdentityCorrelation` checks it only without correlation). So the
    * marker is removed only if no correlation shows up.
    *
    * The instance's own start may still be signing (a second start right after the first): its
    * correlation follows within milliseconds (signed locally, one request). It is waited for up to
    * ~750 ms - removing the marker before it would let a worker run without the identity of the
    * first start. This delays only the 409 of such a start.
    *
    * Removing is wrong only if the first start has not set its correlation after the wait - it
    * hangs or failed; then its workers run without identity instead of ending in an incident. A
    * failing check removes nothing (fail closed) and is said in the 409.
    */
  private def clearIdentityPending(apiClient: ApiClient, processInstanceId: String): IO[EngineError, Unit] =
    val correlationSet =
      ZIO
        .attemptBlocking:
          new ProcessInstanceApi(apiClient).getProcessInstanceVariables(processInstanceId, false)
        .map(vars => Option(vars).exists(_.containsKey(InputParams._identityCorrelation.toString)))
        .mapError: err =>
          C7Service.withStatus(err)(EngineError.ProcessError(
            s"Problem checking the IdentityCorrelation of process '$processInstanceId': $err"
          ))
    def awaitCorrelation(checks: Int): IO[EngineError, Boolean] =
      correlationSet.flatMap:
        case false if checks > 1 =>
          awaitCorrelation(checks - 1).delay(timings.correlationCheckInterval)
        case found               => ZIO.succeed(found)
    awaitCorrelation(timings.correlationChecks)
      .flatMap:
        case true  => logDebug(s"Process $processInstanceId has its correlation - its pending marker is ignored.")
        case false =>
          ZIO
            .attemptBlocking:
              new ProcessInstanceApi(apiClient).modifyProcessInstanceVariables(
                processInstanceId,
                new PatchVariablesDto().deletions(List(InputParams._identityCorrelationPending.toString).asJava)
              )
            .unit
            .mapError: err =>
              C7Service.withStatus(err)(EngineError.ProcessError(
                s"Problem removing the pending marker of process '$processInstanceId': $err"
              ))
  end clearIdentityPending

  /** The C7 REST API cannot restrict a message to start events (no `startMessagesOnly`): it is
    * correlated to a running instance waiting for it first. That was reported as a started process
    * - and with an IdentityCorrelation the caller's identity was signed onto the other instance.
    */
  private[c7] def onlyStarted(
      messageName: String,
      result: MessageCorrelationResult
  ): IO[EngineError, MessageCorrelationResult] =
    result match
      case started: MessageCorrelationResult.ProcessInstance => ZIO.succeed(started)
      case execution: MessageCorrelationResult.Execution     =>
        ZIO.logWarning(
          s"Message '$messageName' was correlated to the running process instance ${execution.processInstanceId} - no process started"
        ) *>
          ZIO.fail(EngineError.ServiceRequestError(
            409,
            s"Message '$messageName' was correlated to a running process instance (${execution.processInstanceId}) - no process was started"
          ))

  /** Map Camunda message correlation result to our domain model
    */
  private def mapMessageCorrelationResult(
      response: Seq[org.camunda.community.rest.client.dto.MessageCorrelationResultWithVariableDto]
  ): IO[EngineError, MessageCorrelationResult] =
    response.headOption
      .flatMap:
        case result if result.getResultType.getValue == "Execution"         =>
          Some:
            MessageCorrelationResult.Execution(
              result.getExecution.getId,
              result.getExecution.getProcessInstanceId,
              engineType
            )
        case result if result.getResultType.getValue == "ProcessDefinition" =>
          Some:
            MessageCorrelationResult.ProcessInstance(
              result.getProcessInstance.getId,
              result.getProcessInstance.getId,
              engineType
            )
        case _                                                              =>
          None
      .map:
        ZIO.succeed
      .getOrElse:
        ZIO.logInfo(s"No valid MessageCorrelationResult found: ${response.map(r => Option(r.getResultType).map(_.getValue).orNull).mkString(", ")}") *>
          ZIO.fail(EngineError.ProcessError(
            s"No valid MessageCorrelationResult found: ${response.map(r => Option(r.getResultType).map(_.getValue).orNull).mkString(", ")}"
          ))
  end mapMessageCorrelationResult

end C7ProcessInstanceService

object C7ProcessInstanceService:

  /** The waits of a start by message - the defaults are used in production (`C7ProcessEngine`),
    * the tests shorten them.
    *
    * @param correlationChecks
    *   how often a running instance is checked for its correlation before its pending marker is
    *   removed - see `clearIdentityPending`
    * @param correlationCheckInterval
    *   how far apart these checks are
    */
  final case class StartTimings(
      correlationChecks: Int = 4,
      correlationCheckInterval: Duration = 250.millis
  )
end C7ProcessInstanceService
