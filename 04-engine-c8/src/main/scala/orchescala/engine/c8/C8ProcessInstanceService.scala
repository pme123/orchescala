package orchescala.engine.c8

import orchescala.domain.{CamundaVariable, IdentityCorrelation, IdentityCorrelationSigner, InputParams, JsonProperty}
import orchescala.engine.*
import orchescala.engine.domain.EngineType.C8
import orchescala.engine.domain.{EngineError, MessageCorrelationResult, ProcessInfo}
import orchescala.engine.services.ProcessInstanceService
import zio.ZIO.{logDebug, logInfo, logWarning}
import zio.{IO, ZIO}

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
      _        <- logDebug(s"Starting Process '$processDefId' with variables: $in")
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
      // Step 1: Start process WITHOUT correlation
      _                <- logDebug(s"Starting Process '$processDefId' (will sign correlation after)")
      instance         <- callStartProcessAsync(processDefId, businessKey, tenantId, in.asJson)
      processInstanceId = instance.processInstanceKey

      // Step 2: Sign correlation with processInstanceId
      signedCorrelation <- signCorrelation(correlation, processInstanceId)

      // Step 3: Set signed correlation as process variable
      _ <- setCorrelationVariable(processInstanceId, signedCorrelation)
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

  /** Set the signed correlation as a process variable (on the process instance's root scope)
    */
  private def setCorrelationVariable(
      processInstanceId: String,
      signedCorrelation: IdentityCorrelation
  ): IO[EngineError, Unit] =
    val variables = Json.obj(
      InputParams._identityCorrelation.toString -> signedCorrelation.asJson.deepDropNullValues
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
      _             <- logInfo(s"Variables for Process Instance '$processInstanceId': $variables")
    yield variables

  def startProcessByMessage(
      messageName: String,
      businessKey: Option[String] = None,
      tenantId: Option[String] = None,
      variables: Option[JsonObject] = None,
      identityCorrelation: Option[IdentityCorrelation] = None
  ): IO[EngineError, ProcessInfo] =
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
      correlationResult <- sendMessageToStartProcess(messageName, businessKey, tenantId, variables)
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
      correlationResult <- sendMessageToStartProcess(messageName, businessKey, tenantId, variables)
      processInstanceId  = correlationResult.processInstanceId
      signedCorrelation <- signCorrelation(correlation, processInstanceId)
      _                 <- setCorrelationVariable(processInstanceId, signedCorrelation)
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
    * key of the started process instance.
    */
  private def sendMessageToStartProcess(
      messageName: String,
      businessKey: Option[String],
      tenantId: Option[String],
      processVariables: Option[JsonObject]
  ): IO[EngineError, MessageCorrelationResult] =
    val variables = processVariables
      .map(_.asJson)
      .map(_.deepMerge(businessKey
        .map(bk =>
          Json.obj("businessKey" -> bk.asJson)
        ).getOrElse(Json.obj())))
      .getOrElse(Json.obj())
    for
      _        <- logInfo(s"Send Message $messageName: $variables")
      response <- rest
                    .post[C8RestModel.MessageCorrelationResult](
                      Seq("messages", "correlation"),
                      Json.obj(
                        "name"      -> messageName.asJson, // no correlationKey: start event
                        "variables" -> variables,
                        "tenantId"  -> tenantId.orElse(engineConfig.tenantId).asJson
                      )
                    )
                    .mapError(withContext(
                      s"Problem sending message '$messageName' to start process"
                    ))
      result   <- ZIO
                    .fromOption(response.processInstanceKey)
                    .orElseFail(EngineError.ProcessError(
                      s"Message '$messageName' was correlated, but no process instance key returned."
                    ))
                    .map: processInstanceKey =>
                      MessageCorrelationResult.ProcessInstance(
                        processInstanceKey,
                        processInstanceKey,
                        C8
                      )
    yield result
    end for
  end sendMessageToStartProcess

end C8ProcessInstanceService
