package orchescala.engine.gateway

import orchescala.engine.{EngineConfig, EngineError}
import orchescala.engine.domain.Incident
import orchescala.engine.services.IncidentService
import org.camunda.community.rest.client.api.IncidentApi
import org.camunda.community.rest.client.dto.IncidentDto
import org.camunda.community.rest.client.invoker.ApiClient
import zio.{IO, ZIO}

import scala.jdk.CollectionConverters.*

class GIncidentService(using
    services: Seq[IncidentService]
) extends IncidentService:

  def getIncidents(
      incidentId: Option[String] = None,
      processInstanceId: Option[String] = None
  ): IO[EngineError, List[Incident]] =
    tryServicesWithErrorCollection[IncidentService, List[Incident]](
      _.getIncidents(incidentId, processInstanceId),
      "getIncidents"
    )

end GIncidentService
