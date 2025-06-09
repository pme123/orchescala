package orchescala.engine
package c7

import orchescala.engine.domain.Incident
import orchescala.engine.inOut.IncidentService
import org.camunda.community.rest.client.api.IncidentApi
import org.camunda.community.rest.client.dto.IncidentDto
import org.camunda.community.rest.client.invoker.ApiClient
import zio.{IO, ZIO}
import scala.jdk.CollectionConverters.*

class C7IncidentService(using
    apiClientZIO: IO[EngineError, ApiClient],
    engineConfig: EngineConfig
) extends IncidentService:

  def getIncidents(
      incidentId: Option[String] = None,
      processInstanceId: Option[String] = None
  ): IO[EngineError, List[Incident]] =
    for
      apiClient    <- apiClientZIO
      incidentDtos <-
        ZIO
          .attempt:
            new IncidentApi(apiClient)
              .getIncidents(
                incidentId.orNull,           // incidentId
                null,                        // incidentType
                null,                        // incidentMessage
                null,                        // incidentMessageLike
                null,                        // processDefinitionId
                null,                        // processDefinitionKeyIn
                processInstanceId.orNull,    // processInstanceId
                null,                        // executionId
                null,                        // activityId
                null,                        // failedActivityId
                null,                        // causeIncidentId
                null,                        // rootCauseIncidentId
                null,                        // configuration
                null,                        // tenantIdIn
                null,                        // jobDefinitionIdIn
                null,                        // sortBy
                null,                        // sortOrder
                null,                        // firstResult
                null,                        // maxResults
                null,                        // jobId
                null                         // annotation
              )
          .mapError: err =>
            EngineError.ProcessError(
              s"Problem getting Incidents: ${err.getMessage}"
            )
    yield mapToIncidents(incidentDtos)

  private def mapToIncidents(
      incidents: java.util.List[IncidentDto]
  ): List[Incident] =
    incidents.asScala.toList.map(mapToIncident)

  private def mapToIncident(
      incident: IncidentDto
  ): Incident =
    Incident(
      id = incident.getId,
      processDefinitionId = Option(incident.getProcessDefinitionId),
      processInstanceId = Option(incident.getProcessInstanceId),
      executionId = Option(incident.getExecutionId),
      incidentTimestamp = incident.getIncidentTimestamp,
      incidentType = incident.getIncidentType,
      activityId = Option(incident.getActivityId),
      failedActivityId = Option(incident.getFailedActivityId),
      causeIncidentId = Option(incident.getCauseIncidentId),
      rootCauseIncidentId = Option(incident.getRootCauseIncidentId),
      configuration = Option(incident.getConfiguration),
      tenantId = Option(incident.getTenantId),
      incidentMessage = Option(incident.getIncidentMessage),
      jobDefinitionId = Option(incident.getJobDefinitionId),
      annotation = Option(incident.getAnnotation)
    )
end C7IncidentService
