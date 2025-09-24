package orchescala.engine.gateway

import orchescala.domain.CamundaVariable.*
import orchescala.domain.{CamundaProperty, CamundaVariable, JsonProperty}
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
      in: Json,
      businessKey: Option[String] = None
  ): IO[EngineError, ProcessInfo] =
    tryServicesWithErrorCollection[ProcessInstanceService, ProcessInfo](
      _.startProcessAsync(processDefId, in, businessKey),
      "startProcessAsync",
      cacheUpdateKey = Some((processInfo: ProcessInfo) => processInfo.processInstanceId)
    )

  def getVariables(processInstanceId: String, inOut: Product): IO[EngineError, Seq[JsonProperty]] =
    tryServicesWithErrorCollection[ProcessInstanceService, Seq[JsonProperty]](
      _.getVariables(processInstanceId, inOut),
      "getVariables",
      Some(processInstanceId)
    )

end GProcessInstanceService
