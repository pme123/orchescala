package orchescala.engine.services

import orchescala.engine.domain.*
import zio.IO

trait IncidentService extends EngineService:
  def getIncidents(
      incidentId: Option[String] = None,
      processInstanceId: Option[String] = None
  ): IO[EngineError, List[Incident]]
end IncidentService
