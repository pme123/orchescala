package orchescala.engine.gateway

import orchescala.engine.domain.{EngineError, HistoricProcessInstance}
import orchescala.engine.services.HistoricProcessInstanceService
import orchescala.engine.EngineConfig
import org.camunda.community.rest.client.api.HistoricProcessInstanceApi
import org.camunda.community.rest.client.dto.HistoricProcessInstanceDto
import org.camunda.community.rest.client.invoker.ApiClient
import zio.{IO, ZIO}

class GHistoricProcessInstanceService(using
    services: Seq[HistoricProcessInstanceService]
) extends HistoricProcessInstanceService, GService:

  def getProcessInstance(processInstanceId: String): IO[EngineError, HistoricProcessInstance] =
    tryServicesWithErrorCollection[HistoricProcessInstanceService, HistoricProcessInstance](
      _.getProcessInstance(processInstanceId),
      "getProcessInstance",
      Some(processInstanceId)
    )

end GHistoricProcessInstanceService
