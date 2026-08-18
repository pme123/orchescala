package orchescala.engine.gateway

import orchescala.domain.CamundaVariable.*
import orchescala.domain.{CamundaProperty, CamundaVariable, IdentityCorrelation, JsonProperty}
import orchescala.engine.*
import orchescala.engine.domain.{EngineError, ProcessInfo}
import orchescala.engine.services.ProcessInstanceService
import org.camunda.community.rest.client.api.{ProcessDefinitionApi, ProcessInstanceApi}
import org.camunda.community.rest.client.dto.{StartProcessInstanceDto, VariableValueDto}
import org.camunda.community.rest.client.invoker.ApiClient
import zio.ZIO.{logDebug, logInfo}
import zio.{IO, ZIO}

import scala.jdk.CollectionConverters.*

class GProcessInstanceService( using
    services: Seq[ProcessInstanceService]
) extends ProcessInstanceService, GService:
  
  override def startProcessAsync(
      processDefId: String,
      in: JsonObject,
      businessKey: Option[String],
      tenantId: Option[String],
      identityCorrelation: Option[IdentityCorrelation]
  ): IO[EngineError, ProcessInfo] =
    tryServicesWithErrorCollection[ProcessInstanceService, ProcessInfo](
      _.startProcessAsync(processDefId, in, businessKey, tenantId, identityCorrelation),
      "startProcessAsync",
      cacheUpdateKey = Some((processInfo: ProcessInfo) => processInfo.processInstanceId)
    )

  def startProcessByMessage(
      messageName: String,
      businessKey: Option[String] = None,
      tenantId: Option[String] = None,
      variables: Option[JsonObject] = None,
      identityCorrelation: Option[IdentityCorrelation] = None
  ): IO[EngineError, ProcessInfo] =
    tryServicesWithErrorCollection[ProcessInstanceService, ProcessInfo](
      _.startProcessByMessage(messageName, businessKey, tenantId, variables, identityCorrelation),
      "startProcessByMessage",
      cacheUpdateKey = Some((processInfo: ProcessInfo) => processInfo.processInstanceId)
    )

  def getVariablesInternal(processInstanceId: String, variableFilter: Option[Seq[String]]): IO[EngineError, Seq[JsonProperty]] =
    tryServicesWithErrorCollection[ProcessInstanceService, Seq[JsonProperty]](
      _.getVariablesInternal(processInstanceId, variableFilter),
      "getVariables",
      Some(processInstanceId)
    )

end GProcessInstanceService
