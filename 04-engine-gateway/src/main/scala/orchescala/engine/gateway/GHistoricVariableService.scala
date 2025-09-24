package orchescala.engine.gateway

import orchescala.domain.CamundaVariable
import orchescala.domain.CamundaVariable.*
import orchescala.engine.EngineError
import orchescala.engine.domain.HistoricVariable
import orchescala.engine.services.HistoricVariableService
import org.camunda.community.rest.client.api.HistoricVariableInstanceApi
import org.camunda.community.rest.client.dto.HistoricVariableInstanceDto
import org.camunda.community.rest.client.invoker.ApiClient
import zio.{IO, ZIO}

class GHistoricVariableService(using
    services: Seq[HistoricVariableService]
) extends HistoricVariableService:

  def getVariables(
      variableName: Option[String],
      processInstanceId: Option[String]
  ): IO[EngineError, Seq[HistoricVariable]] =
    tryServicesWithErrorCollection[HistoricVariableService, Seq[HistoricVariable]](
      _.getVariables(variableName, processInstanceId),
      "getVariables"
    )

end GHistoricVariableService
