package orchescala.engine.w4s

import orchescala.engine.EngineConfig
import orchescala.engine.domain.*
import orchescala.engine.services.IncidentService
import zio.{IO, ZIO}

class W4SIncidentService(using
    engineConfig: EngineConfig
) extends IncidentService, W4SService:

  def getIncidents(
      incidentId: Option[String] = None,
      processInstanceId: Option[String] = None
  ): IO[EngineError, List[Incident]] =
    ZIO.fail(EngineError.ProcessError(
      "W4S engine does not support incident queries. Errors are handled within the workflow."
    ))

end W4SIncidentService

