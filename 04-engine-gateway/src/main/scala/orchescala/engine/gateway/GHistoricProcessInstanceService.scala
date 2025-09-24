package orchescala.engine.gateway

import orchescala.engine.domain.HistoricProcessInstance
import orchescala.engine.services.HistoricProcessInstanceService
import orchescala.engine.{EngineConfig, EngineError}
import org.camunda.community.rest.client.api.HistoricProcessInstanceApi
import org.camunda.community.rest.client.dto.HistoricProcessInstanceDto
import org.camunda.community.rest.client.invoker.ApiClient
import zio.{IO, ZIO}

class GHistoricProcessInstanceService(using
    services: Seq[HistoricProcessInstanceService]
) extends HistoricProcessInstanceService:

  def getProcessInstance(processInstanceId: String): IO[EngineError, HistoricProcessInstance] =
    tryServicesWithErrorCollection[HistoricProcessInstanceService, HistoricProcessInstance](
      _.getProcessInstance(processInstanceId),
      "getProcessInstance"
    )


end GHistoricProcessInstanceService
