package orchescala.engine.c8

import orchescala.engine.*
import orchescala.engine.domain.{EngineError, Incident}
import orchescala.engine.services.IncidentService
import zio.{IO, ZIO}

class C8IncidentService(using
    rest: C8RestClient,
    engineConfig: EngineConfig
) extends IncidentService, C8Service:

  def getIncidents(
      incidentId: Option[String] = None,
      processInstanceId: Option[String] = None
  ): IO[EngineError, List[Incident]] =
    for
      incidentKey        <- ZIO.foreach(incidentId)(toKey("incidentId"))
      processInstanceKey <- ZIO.foreach(processInstanceId)(toKey("processInstanceId"))
      incidentDtos       <-
        rest
          .searchAll[C8RestModel.IncidentResult](
            Seq("incidents", "search"),
            C8RestModel.filter(
              "incidentKey"        -> incidentKey.map(Json.fromString),
              "processInstanceKey" -> processInstanceKey.map(Json.fromString)
            )
          )
          .mapError(withContext("Problem getting Incidents"))
    yield incidentDtos.toList.map(mapToIncident)

  private def mapToIncident(incident: C8RestModel.IncidentResult): Incident =
    Incident(
      id = incident.incidentKey,
      processDefinitionId = incident.processDefinitionId,
      processInstanceId = incident.processInstanceKey,
      executionId = None,         // not supported
      incidentTimestamp = incident.creationTime,
      incidentType = incident.errorType,
      activityId = None,          // not supported
      failedActivityId = None,    // not supported
      causeIncidentId = None,     // not supported
      rootCauseIncidentId = None, // not supported
      configuration = None,       // not supported
      tenantId = incident.tenantId,
      incidentMessage = incident.errorMessage,
      jobDefinitionId = incident.jobKey,
      annotation = None,          // not supported
      state = incident.state
    )
end C8IncidentService
