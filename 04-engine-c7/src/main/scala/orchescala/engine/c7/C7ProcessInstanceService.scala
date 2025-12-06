package orchescala.engine
package c7

import orchescala.domain.CamundaVariable.*
import orchescala.domain.{CamundaProperty, CamundaVariable, IdentityCorrelation, IdentityCorrelationSigner, JsonProperty}
import orchescala.engine.*
import orchescala.engine.domain.EngineType.C7
import orchescala.engine.domain.{EngineError, MessageCorrelationResult, ProcessInfo}
import orchescala.engine.services.ProcessInstanceService
import org.camunda.community.rest.client.api.{ProcessDefinitionApi, ProcessInstanceApi}
import org.camunda.community.rest.client.dto.{PatchVariablesDto, StartProcessInstanceDto, VariableValueDto}
import org.camunda.community.rest.client.invoker.ApiClient
import zio.ZIO.{logDebug, logInfo, logWarning}
import zio.{IO, ZIO}

import scala.jdk.CollectionConverters.*

class C7ProcessInstanceService(using
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
      apiClient        <- apiClientZIO
      _                <- logDebug(s"Starting Process '$processDefId' with variables: $in")
      processVariables <- C7VariableMapper.toC7Variables(in.asJson)
      instance         <- callStartProcessAsync(processDefId, businessKey, tenantId, apiClient, processVariables)
    yield ProcessInfo(
      processInstanceId = instance.getId,
      businessKey = Option(instance.getBusinessKey),
      status = ProcessInfo.ProcessStatus.Active,
      engineType = C7
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
      apiClient <- apiClientZIO

      // Step 1: Start process WITHOUT correlation
      _                <- logDebug(s"Starting Process '$processDefId' (will sign correlation after)")
      processVariables <- C7VariableMapper.toC7Variables(in.asJson)
      instance         <- callStartProcessAsync(processDefId, businessKey, tenantId, apiClient, processVariables)
      processInstanceId = instance.getId

      // Step 2: Sign correlation with processInstanceId
      signedCorrelation <- signCorrelation(correlation, processInstanceId)

      // Step 3: Set signed correlation as process variable
      _ <- setCorrelationVariable(apiClient, processInstanceId, signedCorrelation)
      _ <- logInfo(s"Set signed IdentityCorrelation for process instance '$processInstanceId'")

    yield ProcessInfo(
      processInstanceId = processInstanceId,
      businessKey = Option(instance.getBusinessKey),
      status = ProcessInfo.ProcessStatus.Active,
      engineType = C7
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
   * Set the signed correlation as a process variable using Camunda REST API
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
        .attempt:
          val modifications = new PatchVariablesDto()
            .modifications(Map("identityCorrelation" -> correlationDto).asJava)
          new ProcessInstanceApi(apiClient)
            .modifyProcessInstanceVariables(processInstanceId, modifications)
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
      apiClient: ApiClient,
      processVariables: Map[String, VariableValueDto]
  ) =
    ZIO
      .attempt:
        tenantId.orElse(engineConfig.tenantId)
          .map: tenantId =>
            new ProcessDefinitionApi(apiClient)
              .startProcessInstanceByKeyAndTenantId(
                processDefId,
                tenantId,
                new StartProcessInstanceDto()
                  .variables(processVariables.asJava)
                  .businessKey(businessKey.orNull)
              )
          .getOrElse:
            new ProcessDefinitionApi(apiClient)
              .startProcessInstanceByKey(
                processDefId,
                new StartProcessInstanceDto()
                  .variables(processVariables.asJava)
                  .businessKey(businessKey.orNull)
              )
      .mapError: err =>
        EngineError.ProcessError(
          s"Problem starting Process '$processDefId': $err"
        )

  def getVariablesInternal(
      processInstanceId: String,
      variableFilter: Option[Seq[String]]
  ): IO[EngineError, Seq[JsonProperty]] =
    for
      apiClient    <- apiClientZIO
      variableDtos <-
        ZIO
          .attempt:
            new ProcessInstanceApi(apiClient)
              .getProcessInstanceVariables(processInstanceId, false)
          .mapError: err =>
            EngineError.ProcessError(
              s"Problem getting Variables for Process Instance '$processInstanceId': $err"
            )
      variables    <-
        ZIO
          .foreach(filterVariables(variableFilter, variableDtos)):
            case k -> dto =>
              toVariableValue(dto).map(v => JsonProperty(k, v.toJson))
          .mapError: err =>
            EngineError.ProcessError(
              s"Problem converting Variables for Process Instance '$processInstanceId' to Json: $err"
            )
      _            <- logInfo(s"Variables for Process Instance '$processInstanceId': $variables")
    yield variables.toSeq

  private def filterVariables(
      variableFilter: Option[Seq[String]],
      variableDtos: java.util.Map[String, VariableValueDto]
  ) =
    if variableFilter.isEmpty then variableDtos.asScala
    else
      variableDtos
        .asScala
        .filter: p =>
          p._2.getValue != null &&
            variableFilter.toSeq.flatten.contains(p._1)

  def startProcessByMessage(
      messageName: String,
      businessKey: Option[String] = None,
      tenantId: Option[String] = None,
      variables: Option[Map[String, CamundaVariable]] = None,
      identityCorrelation: Option[IdentityCorrelation] = None
  ): IO[EngineError, ProcessInfo] =
    identityCorrelation match
      case None =>
        // No identity correlation - just send message
        startProcessByMessageWithoutCorrelation(messageName, businessKey, tenantId, variables)

      case Some(correlation) =>
        // Two-step flow: send message to start process, then set signed correlation
        startProcessByMessageWithSignedCorrelation(messageName, businessKey, tenantId, variables, correlation)
  end startProcessByMessage

  /**
   * Start process by message without identity correlation (simple flow)
   */
  private def startProcessByMessageWithoutCorrelation(
      messageName: String,
      businessKey: Option[String],
      tenantId: Option[String],
      variables: Option[Map[String, CamundaVariable]]
  ): IO[EngineError, ProcessInfo] =
    for
      _                 <- logInfo(s"Starting process by message '$messageName'")
      correlationResult <- sendMessageToStartProcess(messageName, businessKey, tenantId, variables)
      processInstanceId  = correlationResult.processInstanceId
      _                 <- logInfo(s"Process started by message '$messageName' with processInstanceId: $processInstanceId")
    yield ProcessInfo(
      processInstanceId = processInstanceId,
      businessKey = businessKey,
      status = ProcessInfo.ProcessStatus.Active,
      engineType = C7
    )
  end startProcessByMessageWithoutCorrelation

  /**
   * Start process by message with signed identity correlation (two-step flow)
   * Step 1: Send message to start process
   * Step 2: Sign correlation with processInstanceId and set as variable
   */
  private def startProcessByMessageWithSignedCorrelation(
      messageName: String,
      businessKey: Option[String],
      tenantId: Option[String],
      variables: Option[Map[String, CamundaVariable]],
      correlation: IdentityCorrelation
  ): IO[EngineError, ProcessInfo] =
    for
      apiClient <- apiClientZIO

      // Step 1: Send message to start process
      _                     <- logInfo(s"Starting process by message '$messageName' (will sign correlation after)")
      correlationResult     <- sendMessageToStartProcess(messageName, businessKey, tenantId, variables)
      processInstanceId      = correlationResult.processInstanceId

      // Step 2: Sign correlation with processInstanceId
      signedCorrelation <- signCorrelation(correlation, processInstanceId)

      // Step 3: Set signed correlation as process variable
      _ <- setCorrelationVariable(apiClient, processInstanceId, signedCorrelation)
      _ <- logInfo(s"Set signed IdentityCorrelation for process instance '$processInstanceId'")

    yield ProcessInfo(
      processInstanceId = processInstanceId,
      businessKey = businessKey,
      status = ProcessInfo.ProcessStatus.Active,
      engineType = C7
    )
  end startProcessByMessageWithSignedCorrelation

  /**
   * Send message to start a process (via Message Start Event)
   */
  private def sendMessageToStartProcess(
      messageName: String,
      businessKey: Option[String],
      tenantId: Option[String],
      variables: Option[Map[String, CamundaVariable]]
  ): IO[EngineError, MessageCorrelationResult] =
    for
      apiClient <- apiClientZIO
      response  <-
        ZIO
          .attempt:
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
            EngineError.ProcessError(
              s"Problem sending message '$messageName' to start process: $err"
            )
      result    <- mapMessageCorrelationResult(Option(response).map(_.asScala).toSeq.flatten)
    yield result
  end sendMessageToStartProcess

  /**
   * Map Camunda message correlation result to our domain model
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
              C7
            )
        case result if result.getResultType.getValue == "ProcessDefinition" =>
          Some:
            MessageCorrelationResult.ProcessInstance(
              result.getProcessInstance.getId,
              result.getProcessInstance.getId,
              C7
            )
        case _                                                              =>
          None
      .map:
        ZIO.succeed
      .getOrElse:
        ZIO.logInfo(s"No valid MessageCorrelationResult found: $response") *>
          ZIO.fail(EngineError.ProcessError(s"No valid MessageCorrelationResult found: $response"))
  end mapMessageCorrelationResult

end C7ProcessInstanceService
