package orchescala.engine.c8

import orchescala.domain.{CamundaVariable, IdentityCorrelation, IdentityCorrelationSigner, InputParams, JsonProperty}
import orchescala.engine.*
import orchescala.engine.c8.C8ProcessInstanceService.PendingMarker
import orchescala.engine.domain.EngineType.C8
import orchescala.engine.domain.{EngineError, MessageCorrelationResult, ProcessInfo}
import orchescala.engine.services.ProcessInstanceService
import zio.ZIO.{logDebug, logInfo, logWarning}
import zio.{durationInt, Duration, IO, UIO, ZIO}

class C8ProcessInstanceService(
    timings: C8ProcessInstanceService.StartTimings = C8ProcessInstanceService.StartTimings()
)(using
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

  /** The `businessKey` is the instance's business id (C8 8.10) - no variable: it shows in Operate,
    * goes on to the instances of its call activities, the BPMNs read it as
    * `camunda.processInstance.businessId` (e.g. as correlation key) and the workers get it with
    * their job. See `C8ProcessInstanceService.businessIdField`.
    */
  private def callStartProcessAsync(
      processDefId: String,
      businessKey: Option[String],
      tenantId: Option[String],
      processVariables: Json
  ): IO[EngineError, C8RestModel.CreateProcessInstanceResult] =
    rest
      .post[C8RestModel.CreateProcessInstanceResult](
        Seq("process-instances"),
        Json.fromFields(
          Seq(
            "processDefinitionId" -> processDefId.asJson, // latest version
            "variables"           -> processVariables,
            "tenantId"            -> tenantId.orElse(engineConfig.tenantId).asJson
          ) ++ C8ProcessInstanceService.businessIdField(businessKey)
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
                             pendingMarker = PendingMarker.NotSent
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
                             pendingMarker = PendingMarker.Sent
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
    * that is no start, answered with 409 (see `ensureStarted`). A process without such a waiting
    * event starts a new instance - as before, and as in C7 (see `correlateWithBusinessKey`).
    *
    * The `businessKey` also goes as the message's business id (8.10): the instance it starts gets
    * it - no variable. A running instance gets it only with the same business id (Zeebe filters on
    * it); the BPMN correlates with `=camunda.processInstance.businessId`.
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
      pendingMarker: PendingMarker
  ): IO[EngineError, MessageCorrelationResult] =
    val variables = processVariables.getOrElse(JsonObject.empty).asJson
    def correlate(correlationKey: Option[String]) =
      rest.post[C8RestModel.MessageCorrelationResult](
        Seq("messages", "correlation"),
        Json.fromFields(
          Seq(
            "name"      -> messageName.asJson,
            "variables" -> variables,
            "tenantId"  -> tenantId.orElse(engineConfig.tenantId).asJson
          ) ++ correlationKey.map(key => "correlationKey" -> key.asJson)
            ++ C8ProcessInstanceService.businessIdField(businessKey)
        )
      )
    for
      _                  <- logInfo(s"Send Message $messageName: ${variables.asObject.fold("-")(_.keys.mkString(", "))}")
      correlated         <- correlateWithBusinessKey(messageName, businessKey, correlate)
                              .mapError(withContext(s"Problem sending message '$messageName' to start process"))
      (response, keyed)   = correlated
      processInstanceKey <- ZIO
                              .fromOption(response.processInstanceKey)
                              .orElseFail(EngineError.ProcessError(
                                s"Message '$messageName' was correlated, but no process instance key returned."
                              ))
      // Without correlation key the message can only start an instance - Zeebe correlates a
      // waiting event only by its key. And with a business id it may start it on the partition of
      // that id, not on the message's: `startedBy` would take that start for a running instance.
      _                  <- ZIO.when(keyed)(ensureStarted(messageName, response.messageKey, processInstanceKey, pendingMarker))
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
    *
    * Known limit: if an instance of «Einmalige Ausführung» needs longer than `subscriptionWait` to
    * open that subscription (a cluster under load), a start at the same time is refused twice and
    * starts a second instance with the same `businessKey`. Starts one after the other are not
    * affected. Other 404s (no such message, another tenant) cost the wait and two requests more.
    *
    * Returns the response and whether the message that got it had a correlation key.
    */
  private def correlateWithBusinessKey(
      messageName: String,
      businessKey: Option[String],
      correlate: Option[String] => IO[EngineError, C8RestModel.MessageCorrelationResult]
  ): IO[EngineError, (C8RestModel.MessageCorrelationResult, Boolean)] =
    def notFound(err: EngineError) = err match
      case EngineError.ServiceRequestError(404, _) => true
      case _                                       => false
    businessKey match
      case None      => correlate(None).map(_ -> false)
      case Some(key) =>
        val withKey = correlate(Some(key)).map(_ -> true)
        withKey
          .catchSome { case err if notFound(err) => withKey.delay(timings.subscriptionWait) }
          .catchSome:
            case err if notFound(err) =>
              logWarning(
                s"Message '$messageName' with correlation key '$key' refused - an instance with it runs and waits for " +
                  "no such message (or none starts with it): sent again without key."
              ) *> correlate(None).map(_ -> false).mapError(withContext(
                s"Refused with correlation key '$key' (${err.errorMsg}), then sent again without key"
              ))
  end correlateWithBusinessKey

  /** The message started the instance - or landed in a running one: then no process was started,
    * answered with 409, and the pending identity marker the message set there is removed.
    */
  private def ensureStarted(
      messageName: String,
      messageKey: String,
      processInstanceKey: String,
      pendingMarker: PendingMarker
  ): IO[EngineError, Unit] =
    C8ProcessInstanceService.startedBy(messageKey, processInstanceKey) match
      case Some(true)  => ZIO.unit
      case None        =>
        ZIO.logError(
          s"Message '$messageName': the keys (message $messageKey, instance $processInstanceKey) are not Zeebe keys - " +
            "cannot tell a start from a running instance, taken as started (no unique execution)."
        )
      case Some(false) =>
        val conflict     =
          s"Message '$messageName' was correlated to a running process instance ($processInstanceKey) - no process was started, " +
            "its variables are set there"
        val removeMarker = pendingMarker match
          case PendingMarker.Sent    => clearIdentityPending(processInstanceKey)
          case PendingMarker.NotSent => ZIO.unit
        logWarning(conflict) *>
          removeMarker
            .as(None)
            .catchAll: err =>
              val notRemoved = s"its pending identity marker could not be removed, its workers wait for a correlation: ${err.errorMsg}"
              ZIO.logError(s"Process $processInstanceKey: $notRemoved").as(Some(notRemoved))
            .flatMap: notRemoved =>
              ZIO.fail(EngineError.ServiceRequestError(409, (conflict +: notRemoved.toSeq).mkString(" - ")))
  end ensureStarted

  /** The message landed in a running instance and set its pending marker (C8 cannot delete a
    * variable). Its workers would wait for a correlation that never comes - unless the instance has
    * one: then the marker is ignored (`WorkerHandler.verifyIdentityCorrelation` checks it only
    * without correlation, see `IdentityBindingSpec`). So the marker is cleared only if no
    * correlation shows up.
    *
    * The instance's own start may still be signing (a second start right after the first): its
    * correlation follows within milliseconds (signed locally, one request). It is waited for up to
    * ~750 ms - clearing the marker before it would let a worker run without the identity of the
    * first start. This delays only the 409 of such a start.
    *
    * The search is eventually consistent: a correlation that is set but not found yet only leads to
    * a cleared marker it makes harmless anyway. Clearing is wrong only if the first start has not
    * set its correlation after the wait - it hangs or failed; then its workers run without
    * identity instead of ending in an incident. A failing search clears nothing (fail closed) and
    * is said in the 409.
    */
  private def clearIdentityPending(processInstanceKey: String): IO[EngineError, Unit] =
    val correlationSet =
      searchVariables(Some(processInstanceKey), Seq(InputParams._identityCorrelation.toString)).map(_.nonEmpty)
    def awaitCorrelation(checks: Int): IO[EngineError, Boolean] =
      correlationSet.flatMap:
        case false if checks > 1 =>
          awaitCorrelation(checks - 1).delay(timings.correlationCheckInterval)
        case found               => ZIO.succeed(found)
    awaitCorrelation(timings.correlationChecks)
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

  /** Did the start message carry the pending identity marker (`_identityCorrelationPending`)? If it
    * landed in a running instance, the marker is there now - and must be removed.
    */
  enum PendingMarker:
    case Sent, NotSent

  /** The `businessKey` as business id of the instance (C8 8.10) - for a start by id and by
    * message. A blank key is none. The engine checks the rest: at most 256 characters (400), and
    * unique among the running instances of the process if the cluster enforces it (409 - final, the
    * gateway tries no other engine). Uniqueness is off by default.
    */
  private[c8] def businessIdField(businessKey: Option[String]): Option[(String, Json)] =
    businessKey.filterNot(_.isBlank).map(id => "businessId" -> id.asJson)

  /** The waits of a start by message - the defaults are used in production (`C8ProcessEngine`),
    * the tests shorten them.
    *
    * @param correlationChecks
    *   how often a running instance is checked for its correlation before its pending marker is
    *   cleared - see `clearIdentityPending`
    * @param correlationCheckInterval
    *   how far apart these checks are
    * @param subscriptionWait
    *   how long a refused start waits before it is sent with its key once more - see
    *   `correlateWithBusinessKey`
    */
  final case class StartTimings(
      correlationChecks: Int = 4,
      correlationCheckInterval: Duration = 250.millis,
      subscriptionWait: Duration = 250.millis
  )

  /** Did this message start the instance? A key holds its partition in the upper bits and grows
    * within a partition: an instance the message started is created after it, on its partition. A
    * running instance it landed in is older - or on another partition. This is Zeebe's key layout
    * (`Protocol.encodePartitionId`), not a documented contract. None if they are no Zeebe keys.
    *
    * Two messages with the same key at the same time: a partition processes them one after the
    * other, and the first creates its instance while it is processed. So the second message's key
    * is newer than that instance - landed in it, it is no start (c8run test: two at the same time).
    *
    * Only for a message with correlation key - it equals its business id, so both hash to the same
    * partition and Zeebe starts the instance there. A message with a business id but no correlation
    * key starts it on the partition of the business id (8.10), which this check cannot tell from a
    * running instance.
    */
  def startedBy(messageKey: String, processInstanceKey: String): Option[Boolean] =
    for
      message  <- messageKey.toLongOption
      instance <- processInstanceKey.toLongOption
    yield partitionOf(instance) == partitionOf(message) && instance > message

  private def partitionOf(key: Long): Long = key >> 51

end C8ProcessInstanceService
