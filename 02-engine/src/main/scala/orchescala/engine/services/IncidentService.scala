package orchescala.engine.services

import orchescala.engine.EngineError
import orchescala.engine.domain.Incident
import zio.IO

trait IncidentService:
  def getIncidents(
      incidentId: Option[String] = None,
      processInstanceId: Option[String] = None
  ): IO[EngineError, List[Incident]]
end IncidentService
