package orchescala.engine.c7

import orchescala.engine.*
import orchescala.engine.domain.ProcessInfo
import orchescala.engine.json.JProcessInstanceService
import org.camunda.community.rest.client.api.ProcessDefinitionApi
import org.camunda.community.rest.client.dto.{StartProcessInstanceDto, VariableValueDto}
import org.camunda.community.rest.client.invoker.ApiClient
import zio.{IO, ZIO}

import scala.jdk.CollectionConverters.*

class JC7ProcessInstanceService(using apiClientZIO: IO[EngineError, ApiClient], engineConfig: EngineConfig)
    extends JProcessInstanceService:

  override def startProcessAsync(
      processDefId: String,
      in: Json,
      businessKey: Option[String] = None
  ): IO[EngineError, ProcessInfo] =

    for
      apiClient        <- apiClientZIO
      _                <- ZIO.logInfo(s"Starting Process '$processDefId' with variables: $in")
      processVariables <- C7VariableMapper.toC7Variables(in)
      _                <- ZIO.logInfo(s"Starting Process '$processDefId' with variables: $processVariables")
      instance         <- callStartProcessAsync(processDefId, businessKey, apiClient, processVariables)
    yield ProcessInfo(
      processInstanceId = instance.getId,
      businessKey = Option(instance.getBusinessKey),
      status = ProcessInfo.ProcessStatus.Active
    )
  end startProcessAsync

  private def callStartProcessAsync(
      processDefId: String,
      businessKey: Option[String],
      apiClient: ApiClient,
      processVariables: Map[String, VariableValueDto]
  ) =
    ZIO
      .attempt:
        engineConfig.tenantId
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
          s"Problem starting Process '$processDefId': ${err.getMessage}"
        )

  def startProcess(
      processDefId: String,
      in: Json,
      businessKey: Option[String]
  ): IO[EngineError, Json] = ???

  def sendMessage(
      messageDefId: String,
      in: Json
  ): IO[EngineError, ProcessInfo] = ???

  def sendSignal(
      signalDefId: String,
      in: Json
  ): IO[EngineError, ProcessInfo] = ???
end JC7ProcessInstanceService
