package orchescala.engine.gateway

import orchescala.engine.EngineConfig
import orchescala.engine.domain.{EngineError, Incident}
import orchescala.engine.services.IncidentService
import org.camunda.community.rest.client.api.IncidentApi
import org.camunda.community.rest.client.dto.IncidentDto
import org.camunda.community.rest.client.invoker.ApiClient
import zio.{IO, ZIO}

import scala.jdk.CollectionConverters.*

class GIncidentService(using
    services: Seq[IncidentService]
) extends IncidentService, GService:

  def getIncidents(
      incidentId: Option[String] = None,
      processInstanceId: Option[String] = None
  ): IO[EngineError, List[Incident]] =
    tryServicesWithErrorCollection[IncidentService, List[Incident]](
      _.getIncidents(incidentId, processInstanceId),
      "getIncidents",
      processInstanceId.orElse(incidentId),
      Some((incidents: List[Incident]) => incidents.headOption.map(_.id).getOrElse("NOT-SET"))
    )

end GIncidentService
