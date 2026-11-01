package orchescala.engine.c8

import orchescala.domain.{CamundaVariable, IdentityCorrelation, IdentityCorrelationSigner, InputParams, JsonProperty}
import orchescala.engine.*
import orchescala.engine.domain.EngineType.C8
import orchescala.engine.domain.{EngineError, MessageCorrelationResult, ProcessInfo}
import orchescala.engine.services.ProcessInstanceService
import zio.ZIO.{logDebug, logInfo, logWarning}
import zio.{durationInt, IO, UIO, ZIO}

class C8ProcessInstanceService(using
    rest: C8RestClient,
    engineConfig: EngineConfig
) extends ProcessInstanceService, C8Service, C8EventService:

  def startProcessAsync(
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
      _        <- logDebug(s"Starting Process '$processDefId' with variables: ${orchescala.engine.LogSafe.names(in)}")
      instance <- callStartProcessAsync(processDefId, businessKey, tenantId, in.asJson)
    yield ProcessInfo(
      processInstanceId = instance.processInstanceKey,
      businessKey = businessKey,
      status = ProcessInfo.ProcessStatus.Active,
      engineType = C8
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
      // Step 1: Start process WITHOUT correlation - marked as pending: a worker activating a job
      // before step 3 waits for it (it ran without the user's identity before)
      _                <- logDebug(s"Starting Process '$processDefId' (will sign correlation after)")
      instance         <- callStartProcessAsync(processDefId, businessKey, tenantId, withIdentityPending(in).asJson)
      processInstanceId = instance.processInstanceKey

      // Step 2: Sign correlation with processInstanceId
      signedCorrelation <- signCorrelation(correlation, processInstanceId)

      // Step 3: Set signed correlation as process variable
      _ <- setCorrelationVariableOfStarted(processInstanceId, signedCorrelation)
      _ <- logInfo(s"Set signed IdentityCorrelation for process instance '$processInstanceId'")
    yield ProcessInfo(
      processInstanceId = processInstanceId,
      businessKey = businessKey,
      status = ProcessInfo.ProcessStatus.Active,
      engineType = C8
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
      processInstanceId: String,
      signedCorrelation: IdentityCorrelation
  ): UIO[Unit] =
    setCorrelationVariable(processInstanceId, signedCorrelation)
      .catchAll: err =>
        ZIO.logError(
          s"Process $processInstanceId started, but its IdentityCorrelation could not be set - its workers wait for it, then end in an incident: ${err.errorMsg}"
        )

  /** Set the signed correlation as a process variable (on the process instance's root scope) - and
    * clear the pending marker of the start (C8 cannot delete a variable).
    */
  private def setCorrelationVariable(
      processInstanceId: String,
      signedCorrelation: IdentityCorrelation
  ): IO[EngineError, Unit] =
    val variables = Json.obj(
      InputParams._identityCorrelation.toString        -> signedCorrelation.asJson.deepDropNullValues,
      InputParams._identityCorrelationPending.toString -> Json.False
    )
    rest
      .putNoContent(
        Seq("element-instances", processInstanceId, "variables"),
        Json.obj("variables" -> variables)
      )
      .catchAll:
        case EngineError.ServiceRequestError(404, _) =>
          ZIO.logWarning(
            s"Process $processInstanceId has already ended - correlation not set."
          )
        case err                                     =>
          ZIO.fail(withContext(
            s"Problem setting identityCorrelation variable for process '$processInstanceId'"
          )(err))
  end setCorrelationVariable

  private def callStartProcessAsync(
      processDefId: String,
      businessKey: Option[String],
      tenantId: Option[String],
      processVariables: Json
  ): IO[EngineError, C8RestModel.CreateProcessInstanceResult] =
    val variables = processVariables.deepMerge(businessKey.map(bk =>
      Json.obj("businessKey" -> bk.asJson)
    ).getOrElse(Json.obj()))
    rest
      .post[C8RestModel.CreateProcessInstanceResult](
        Seq("process-instances"),
        Json.obj(
          "processDefinitionId" -> processDefId.asJson, // latest version
          "variables"           -> variables,
          "tenantId"            -> tenantId.orElse(engineConfig.tenantId).asJson
        )
      )
      .mapError(withContext(s"Problem starting Process '$processDefId'"))
  end callStartProcessAsync

  def getVariablesInternal(
      processInstanceId: String,
      variableFilter: Option[Seq[String]]
  ): IO[EngineError, Seq[JsonProperty]] =
    for
      variableDtos  <-
        searchVariables(Some(processInstanceId), variableNames(None, variableFilter))
          .mapError(withContext(
            s"Problem getting Variables for Process Instance '$processInstanceId'"
          ))
      variables     <-
        ZIO
          .foreach(filterVariables(variableFilter, variableDtos)): dto =>
            toVariableValue(dto)
          .mapError: err =>
            EngineError.ProcessError(
              s"Problem converting Variables for Process Instance '$processInstanceId' to Json: $err"
            )
      // names only - the values hold personal data
      _             <- logInfo(s"Variables for Process Instance '$processInstanceId': ${variables.map(_.key).mkString(", ")}")
    yield variables

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
          // Two-step flow (like C7): send message to start process, then set signed correlation
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
      correlationResult <- sendMessageToStartProcess(
                             messageName,
                             businessKey,
                             tenantId,
                             variables,
                             removePending = None // no pending marker sent
                           )
      processInstanceId  = correlationResult.processInstanceId
      _                 <- logInfo(
                             s"Process started by message '$messageName' with processInstanceId: $processInstanceId"
                           )
    yield ProcessInfo(
      processInstanceId = processInstanceId,
      businessKey = businessKey,
      status = ProcessInfo.ProcessStatus.Active,
      engineType = C8
    )
  end startProcessByMessageWithoutCorrelation

  /** Start process by message with signed identity correlation (two-step flow, like C7) Step 1:
    * send the message to start the process - the REST correlation returns its processInstanceKey.
    * Step 2: sign the correlation with it and set it as variable.
    */
  private def startProcessByMessageWithSignedCorrelation(
      messageName: String,
      businessKey: Option[String],
      tenantId: Option[String],
      variables: Option[JsonObject],
      correlation: IdentityCorrelation
  ): IO[EngineError, ProcessInfo] =
    for
      _                 <- logDebug(s"Starting process by message '$messageName' (will sign correlation after)")
      correlationResult <- sendMessageToStartProcess(
                             messageName,
                             businessKey,
                             tenantId,
                             Some(withIdentityPending(variables.getOrElse(JsonObject.empty))),
                             // landed in a running instance: the marker must not stay there
                             removePending = Some(clearIdentityPending)
                           )
      processInstanceId  = correlationResult.processInstanceId
      signedCorrelation <- signCorrelation(correlation, processInstanceId)
      _                 <- setCorrelationVariableOfStarted(processInstanceId, signedCorrelation)
      _                 <- logInfo(
                             s"Process started by message '$messageName' with processInstanceId: $processInstanceId " +
                               "- signed IdentityCorrelation set"
                           )
    yield ProcessInfo(
      processInstanceId = processInstanceId,
      businessKey = businessKey,
      status = ProcessInfo.ProcessStatus.Active,
      engineType = C8
    )
  end startProcessByMessageWithSignedCorrelation

  /** Send message to start a process (via Message Start Event) - the REST correlation returns the
    * key of the process instance.
    *
    * With a `businessKey` it is the correlation key, like in C7: a running instance waiting for
    * this message with that key gets it (e.g. the event subprocess of «Einmalige Ausführung») -
    * that is no start, answered with 409 (see `onlyStarted`). A process without such a waiting
    * event starts a new instance - as before, and as in C7 (see `correlateWithBusinessKey`).
    *
    * Landed in a running instance, the message's variables are merged into it - as in C7 with the
    * variables of a correlated message. A process with the pattern can restrict that with output
    * mappings on the start event of its event subprocess.
    */
  private def sendMessageToStartProcess(
      messageName: String,
      businessKey: Option[String],
      tenantId: Option[String],
      processVariables: Option[JsonObject],
      removePending: Option[String => IO[EngineError, Unit]]
  ): IO[EngineError, MessageCorrelationResult] =
    // the businessKey also as variable - also without other variables: the instance correlates its
    // waiting messages with it (`=businessKey`)
    val variables = processVariables.getOrElse(JsonObject.empty).asJson
      .deepMerge(businessKey.fold(Json.obj())(bk => Json.obj("businessKey" -> bk.asJson)))
    def correlate(correlationKey: Option[String]) =
      rest.post[C8RestModel.MessageCorrelationResult](
        Seq("messages", "correlation"),
        Json.obj(
          "name"      -> messageName.asJson,
          "variables" -> variables,
          "tenantId"  -> tenantId.orElse(engineConfig.tenantId).asJson
        ).deepMerge(correlationKey.fold(Json.obj())(key => Json.obj("correlationKey" -> key.asJson)))
      )
    for
      _                  <- logInfo(s"Send Message $messageName: ${variables.asObject.fold("-")(_.keys.mkString(", "))}")
      response           <- correlateWithBusinessKey(messageName, businessKey, correlate)
                              .mapError(withContext(s"Problem sending message '$messageName' to start process"))
      processInstanceKey <- ZIO
                              .fromOption(response.processInstanceKey)
                              .orElseFail(EngineError.ProcessError(
                                s"Message '$messageName' was correlated, but no process instance key returned."
                              ))
      _                  <- onlyStarted(messageName, response.messageKey, processInstanceKey, removePending)
    yield MessageCorrelationResult.ProcessInstance(processInstanceKey, processInstanceKey, C8)
    end for
  end sendMessageToStartProcess

  /** Zeebe keeps a message start unique per correlation key: while an instance started with this
    * `businessKey` runs, a second start with it is refused - a 404 (Zeebe has no own error code for
    * it, and its text is not matched). A 404 is also the answer if no process starts with this
    * message at all.
    *
    *   - Sent once more with the key after a moment: an instance that has just started with this key
    *     may not have opened its subscriptions yet (the event subprocess of «Einmalige Ausführung»,
    *     e.g. two starts at the same time). Now it gets the message - answered with 409.
    *   - Refused again: sent without key - a new instance starts, as before and as in C7. With no
    *     such message at all this fails again; the error names both.
    */
  private def correlateWithBusinessKey(
      messageName: String,
      businessKey: Option[String],
      correlate: Option[String] => IO[EngineError, C8RestModel.MessageCorrelationResult]
  ): IO[EngineError, C8RestModel.MessageCorrelationResult] =
    def refused(err: EngineError) = err match
      case EngineError.ServiceRequestError(404, _) => true
      case _                                       => false
    businessKey match
      case None      => correlate(None)
      case Some(key) =>
        val withKey = correlate(Some(key))
        withKey
          .catchSome { case err if refused(err) => withKey.delay(C8ProcessInstanceService.subscriptionWait) }
          .catchSome:
            case err if refused(err) =>
              logInfo(
                s"Message '$messageName' with correlation key '$key' refused - an instance with it runs and waits for " +
                  "no such message (or none starts with it): sent again without key."
              ) *> correlate(None).mapError(withContext(
                s"Refused with correlation key '$key' (${err.errorMsg}), then sent again without key"
              ))
  end correlateWithBusinessKey

  /** The message started the instance - or landed in a running one: then no process was started,
    * answered with 409, and the pending identity marker the message set there is removed.
    */
  private def onlyStarted(
      messageName: String,
      messageKey: String,
      processInstanceKey: String,
      removePending: Option[String => IO[EngineError, Unit]]
  ): IO[EngineError, Unit] =
    C8ProcessInstanceService.startedBy(messageKey, processInstanceKey) match
      case Some(true)  => ZIO.unit
      case None        =>
        logWarning(
          s"Message '$messageName': the keys (message $messageKey, instance $processInstanceKey) are not Zeebe keys - " +
            "cannot tell a start from a running instance, taken as started (no unique execution)."
        )
      case Some(false) =>
        for
          cleared <- ZIO.foreach(removePending)(_(processInstanceKey)).either
          notCleared = cleared.left.toOption.fold(""): err =>
                         s" - its pending identity marker could not be removed, its workers wait for a correlation: ${err.errorMsg}"
          _       <- cleared.fold(_ => ZIO.logError(s"Process $processInstanceKey$notCleared"), _ => ZIO.unit)
          _       <- logWarning(
                       s"Message '$messageName' was correlated to the running process instance $processInstanceKey - no process started"
                     )
          _       <- ZIO.fail(EngineError.ServiceRequestError(
                       409,
                       s"Message '$messageName' was correlated to a running process instance ($processInstanceKey) - no process was started$notCleared"
                     ))
        yield ()
  end onlyStarted

  /** The message landed in a running instance and set its pending marker (C8 cannot delete a
    * variable). Its workers would wait for a correlation that never comes - unless the instance has
    * one: then the marker is ignored. So the marker is cleared only if no correlation shows up.
    *
    * The instance's own start may still be signing (a second start right after the first): its
    * correlation follows within milliseconds (signed locally, one request). It is waited for up to
    * ~750 ms - clearing the marker before it would let a worker run without the identity of the
    * first start. This delays only the 409 of such a start.
    */
  private def clearIdentityPending(processInstanceKey: String): IO[EngineError, Unit] =
    val correlationSet =
      searchVariables(Some(processInstanceKey), Seq(InputParams._identityCorrelation.toString)).map(_.nonEmpty)
    def awaitCorrelation(checks: Int): IO[EngineError, Boolean] =
      correlationSet.flatMap:
        case false if checks > 1 =>
          awaitCorrelation(checks - 1).delay(C8ProcessInstanceService.correlationCheckInterval)
        case found               => ZIO.succeed(found)
    awaitCorrelation(C8ProcessInstanceService.correlationChecks)
      .flatMap:
        case true  => logDebug(s"Process $processInstanceKey has its correlation - its pending marker is ignored.")
        case false =>
          rest.putNoContent(
            Seq("element-instances", processInstanceKey, "variables"),
            Json.obj("variables" -> Json.obj(InputParams._identityCorrelationPending.toString -> Json.False))
          )
  end clearIdentityPending

end C8ProcessInstanceService

object C8ProcessInstanceService:

  /** How often, and how far apart, a running instance is checked for its correlation before its
    * pending marker is cleared - see `clearIdentityPending`.
    */
  private[c8] val correlationChecks        = 4
  private[c8] val correlationCheckInterval = 250.millis

  /** How long a refused start waits before it is sent with its key once more - see
    * `correlateWithBusinessKey`.
    */
  private[c8] val subscriptionWait = 250.millis

  /** Did this message start the instance? A key holds its partition in the upper bits and grows
    * within a partition: an instance the message started is created after it, on its partition. A
    * running instance it landed in is older - or on another partition. This is Zeebe's key layout
    * (`Protocol.encodePartitionId`), not a documented contract. None if they are no Zeebe keys.
    */
  def startedBy(messageKey: String, processInstanceKey: String): Option[Boolean] =
    for
      message  <- messageKey.toLongOption
      instance <- processInstanceKey.toLongOption
    yield partitionOf(instance) == partitionOf(message) && instance > message

  private def partitionOf(key: Long): Long = key >> 51

end C8ProcessInstanceService
