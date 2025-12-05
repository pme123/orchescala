package orchescala.engine
package c7

import orchescala.domain.CamundaVariable.*
import orchescala.domain.{CamundaProperty, CamundaVariable, IdentityCorrelation, JsonProperty}
import orchescala.engine.*
import orchescala.engine.domain.EngineType.C7
import orchescala.engine.domain.{EngineError, ProcessInfo}
import orchescala.engine.services.ProcessInstanceService
import org.camunda.community.rest.client.api.{ProcessDefinitionApi, ProcessInstanceApi}
import org.camunda.community.rest.client.dto.{StartProcessInstanceDto, VariableValueDto}
import org.camunda.community.rest.client.invoker.ApiClient
import zio.ZIO.{logDebug, logInfo}
import zio.{IO, ZIO}

import scala.jdk.CollectionConverters.*

class C7ProcessInstanceService(using
    apiClientZIO: IO[EngineError, ApiClient],
    engineConfig: EngineConfig
) extends ProcessInstanceService, C7Service:

  override def startProcessAsync(
      processDefId: String,
      in: JsonObject,
      businessKey: Option[String],
      tenantId: Option[String],
      identityCorrelation: Option[IdentityCorrelation]
  ): IO[EngineError, ProcessInfo] =

    for
      apiClient        <- apiClientZIO
      inVariables      <- ZIO.succeed(
        if identityCorrelation.isEmpty then in
        else
          in.add("identityCorrelation", identityCorrelation.asJson.deepDropNullValues)
      )
      _                <- logDebug(s"Starting Process '$processDefId' with variables: $in")
      processVariables <- C7VariableMapper.toC7Variables(inVariables.asJson)
      _                <- logDebug(s"Starting Process '$processDefId' with variables: $processVariables")
      instance         <-
        callStartProcessAsync(processDefId, businessKey, tenantId, apiClient, processVariables)
    yield ProcessInfo(
      processInstanceId = instance.getId,
      businessKey = Option(instance.getBusinessKey),
      status = ProcessInfo.ProcessStatus.Active,
      engineType = C7
    )
  end startProcessAsync

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

end C7ProcessInstanceService
