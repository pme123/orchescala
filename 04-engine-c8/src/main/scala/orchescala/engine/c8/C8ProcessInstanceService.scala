package orchescala.engine.c8

import io.camunda.client.CamundaClient
import io.camunda.client.api.response.ProcessInstanceEvent
import io.camunda.client.api.search.response.Variable
import orchescala.domain.{CamundaVariable, IdentityCorrelation, IdentityCorrelationSigner, JsonProperty}
import orchescala.engine.*
import orchescala.engine.domain.EngineType.C8
import orchescala.engine.domain.{EngineError, MessageCorrelationResult, ProcessInfo}
import orchescala.engine.services.ProcessInstanceService
import zio.ZIO.{logDebug, logInfo, logWarning}
import zio.{IO, ZIO}

import scala.jdk.CollectionConverters.*

class C8ProcessInstanceService(using
    camundaClientZIO: IO[EngineError, CamundaClient],
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

  /**
   * Start process without identity correlation (simple flow)
   */
  private def startProcessWithoutCorrelation(
      processDefId: String,
      in: JsonObject,
      businessKey: Option[String],
      tenantId: Option[String]
  ): IO[EngineError, ProcessInfo] =
    for
      camundaClient <- camundaClientZIO
      _             <- logDebug(s"Starting Process '$processDefId' with variables: $in")
      instance      <- callStartProcessAsync(processDefId, businessKey, tenantId, camundaClient, in.asJson)
    yield ProcessInfo(
      processInstanceId = instance.getProcessInstanceKey.toString,
      businessKey = businessKey,
      status = ProcessInfo.ProcessStatus.Active,
      engineType = C8
    )
  end startProcessWithoutCorrelation

  /**
   * Start process with signed identity correlation (two-step flow)
   * Step 1: Start process without correlation
   * Step 2: Sign correlation with processInstanceId and set as variable
   */
  private def startProcessWithSignedCorrelation(
      processDefId: String,
      in: JsonObject,
      businessKey: Option[String],
      tenantId: Option[String],
      correlation: IdentityCorrelation
  ): IO[EngineError, ProcessInfo] =
    for
      camundaClient <- camundaClientZIO

      // Step 1: Start process WITHOUT correlation
      _                 <- logDebug(s"Starting Process '$processDefId' (will sign correlation after)")
      instance          <- callStartProcessAsync(processDefId, businessKey, tenantId, camundaClient, in.asJson)
      processInstanceId = instance.getProcessInstanceKey.toString

      // Step 2: Sign correlation with processInstanceId
      signedCorrelation <- signCorrelation(correlation, processInstanceId)

      // Step 3: Set signed correlation as process variable
      _ <- setCorrelationVariable(camundaClient, processInstanceId, signedCorrelation)
      _ <- logInfo(s"Set signed IdentityCorrelation for process instance '$processInstanceId'")

    yield ProcessInfo(
      processInstanceId = processInstanceId,
      businessKey = businessKey,
      status = ProcessInfo.ProcessStatus.Active,
      engineType = C8
    )
  end startProcessWithSignedCorrelation

  /**
   * Sign the identity correlation with the process instance ID
   */
  private def signCorrelation(
      correlation: IdentityCorrelation,
      processInstanceId: String
  ): IO[EngineError, IdentityCorrelation] =
    engineConfig.identitySigningKey match
      case None =>
        logWarning("No identitySigningKey configured - correlation will not be signed!").as(
          correlation.copy(processInstanceId = Some(processInstanceId))
        )
      case Some(secretKey) =>
        ZIO.succeed(
          IdentityCorrelationSigner.sign(correlation, processInstanceId, secretKey)
        )
  end signCorrelation

  /**
   * Set the signed correlation as a process variable using Camunda C8 client
   */
  private def setCorrelationVariable(
      camundaClient: CamundaClient,
      processInstanceId: String,
      signedCorrelation: IdentityCorrelation
  ): IO[EngineError, Unit] =
    for
      correlationJson <- ZIO.succeed(signedCorrelation.asJson.deepDropNullValues)
      variablesMap    <- ZIO.succeed(jsonToVariablesMap(Json.obj("identityCorrelation" -> correlationJson)))
      _               <- ZIO
        .attempt:
          camundaClient
            .newSetVariablesCommand(processInstanceId.toLong)
            .variables(variablesMap.asJava)
            .send()
            .join()
        .mapError: err =>
          EngineError.ProcessError(
            s"Problem setting identityCorrelation variable for process '$processInstanceId': $err"
          )
    yield ()
  end setCorrelationVariable

  private def callStartProcessAsync(
      processDefId: String,
      businessKey: Option[String],
      tenantId: Option[String],
      c8Client: CamundaClient,
      processVariables: Json
  ): IO[EngineError.ProcessError, ProcessInstanceEvent] =
    ZIO
      .attempt:
        val variables = processVariables.deepMerge(businessKey.map(bk =>
          Json.obj("businessKey" -> bk.asJson)
        ).getOrElse(Json.obj()))

        val variablesMap      = jsonToVariablesMap(variables)
        val command           = c8Client
          .newCreateInstanceCommand()
          .bpmnProcessId(processDefId)
          .latestVersion()
          .variables(variablesMap.asJava)
        val commandWithTenant =
          tenantId
            .orElse(engineConfig.tenantId)
            .map: tenantId =>
              command.tenantId(tenantId)
            .getOrElse(command)

        commandWithTenant.send().join()
      .mapError: err =>
        EngineError.ProcessError(
          s"Problem starting Process '$processDefId': $err"
        )

  def getVariablesInternal(
      processInstanceId: String,
      variableFilter: Option[Seq[String]]
  ): IO[EngineError, Seq[JsonProperty]] =
    for
      camundaClient <- camundaClientZIO
      variableDtos  <-
        ZIO
          .attempt:
            camundaClient
              .newVariableSearchRequest()
              .filter(_.processInstanceKey(processInstanceId.toLong))
              .send()
              .join()
              .items()
          .mapError: err =>
            EngineError.ProcessError(
              s"Problem getting Variables for Process Instance '$processInstanceId': $err"
            )
      variables     <-
        ZIO
          .foreach(filterVariables(variableFilter, variableDtos.asScala.toSeq)): dto =>
            toVariableValue(dto)
          .mapError: err =>
            EngineError.ProcessError(
              s"Problem converting Variables for Process Instance '$processInstanceId' to Json: $err"
            )
      _             <- logInfo(s"Variables for Process Instance '$processInstanceId': $variables")
    yield variables

  private def filterVariables(variableFilter: Option[Seq[String]], variableDtos: Seq[Variable]) =
    if variableFilter.isEmpty then variableDtos
    else
      variableDtos
        .filter: v =>
          v.getValue != null &&
            variableFilter.toSeq.flatten.contains(v.getName)

  private def toVariableValue(valueDto: Variable): IO[EngineError, JsonProperty] =
    val value = valueDto.getValue
    (value match
      case null | "null" =>
        ZIO.attempt(Json.Null)
      case str    =>
        ZIO.fromEither(parser.parse(str))
    )
      .map: v =>
        JsonProperty(valueDto.getName, v)
      .mapError: err =>
        EngineError.ProcessError(
          s"Problem converting VariableDto '${valueDto.getName} -> $value: $err"
        )

  end toVariableValue

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
        // Note: C8 message correlation doesn't return processInstanceId directly
        // We can only sign the correlation if we can query for the process instance
        // For now, log a warning and proceed without signing
        logWarning(
          s"Identity correlation signing for startProcessByMessage is not fully supported in C8 " +
          s"because message correlation doesn't return processInstanceId. " +
          s"Consider using startProcessAsync instead for processes that need identity correlation."
        ) *> startProcessByMessageWithoutCorrelation(messageName, businessKey, tenantId, variables)
  end startProcessByMessage

  /**
   * Start process by message without identity correlation
   * Note: C8 message correlation returns messageKey, not processInstanceId
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
      messageKey         = correlationResult.id
      _                 <- logInfo(s"Process started by message '$messageName' with messageKey: $messageKey")
    yield ProcessInfo(
      processInstanceId = messageKey, // Using messageKey as ID since we don't have processInstanceId
      businessKey = businessKey,
      status = ProcessInfo.ProcessStatus.Active,
      engineType = C8
    )
  end startProcessByMessageWithoutCorrelation

  /**
   * Send message to start a process (via Message Start Event)
   * Note: C8 returns messageKey, not processInstanceId
   */
  private def sendMessageToStartProcess(
      messageName: String,
      businessKey: Option[String],
      tenantId: Option[String],
      variables: Option[JsonObject]
  ): IO[EngineError, MessageCorrelationResult] =
    for
      camundaClient <- camundaClientZIO
      variablesMap  <- ZIO.succeed(variables.map(_.toVariablesMap).getOrElse(Map.empty))
      _               <- logInfo("variablesMap: " + variablesMap)
      response      <-
        ZIO
          .attempt:
            val command = camundaClient.newCorrelateMessageCommand()
              .messageName(messageName)

            val withCorrelationKey =
              businessKey match
                case Some(key) => command.correlationKey(key)
                case None      => command.withoutCorrelationKey()

            withCorrelationKey
              .tenantId(tenantId.orElse(engineConfig.tenantId).orNull)
              .variables(variablesMap)
              .send().join()
          .mapError: err =>
            EngineError.ProcessError(
              s"Problem sending message '$messageName' to start process: $err"
            )
      result        <-
        ZIO
          .attempt:
            MessageCorrelationResult.ProcessInstance(
              response.getMessageKey.toString,
              response.getMessageKey.toString, // C8 doesn't return processInstanceId
              C8
            )
          .mapError: err =>
            EngineError.ProcessError(
              s"Problem mapping MessageCorrelationResult: $err"
            )
    yield result
  end sendMessageToStartProcess

end C8ProcessInstanceService
