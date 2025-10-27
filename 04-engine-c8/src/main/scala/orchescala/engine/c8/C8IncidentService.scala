package orchescala.engine.c8

import io.camunda.client.CamundaClient
import io.camunda.client.api.search.response as camunda
import orchescala.engine.*
import orchescala.engine.domain.{EngineError, Incident}
import orchescala.engine.services.IncidentService
import zio.ZIO.{logDebug, logInfo}
import zio.{IO, ZIO}

import java.time.OffsetDateTime
import scala.jdk.CollectionConverters.*

class C8IncidentService(using
    camundaClientZIO: IO[EngineError, CamundaClient],
    engineConfig: EngineConfig
) extends IncidentService, C8Service:

  def getIncidents(
      incidentId: Option[String] = None,
      processInstanceId: Option[String] = None
  ): IO[EngineError, List[Incident]] =
    for
      camundaClient <- camundaClientZIO
      incidentDtos <-
        ZIO
          .attempt:
            camundaClient
              .newIncidentSearchRequest()
              .filter(f =>
                (incidentId, processInstanceId) match
                  case (Some(incId), Some(pid)) =>
                    f.incidentKey(incId.toLong)
                      .processInstanceKey(pid.toLong)
                  case (Some(incId), _)         => f.incidentKey(incId.toLong)
                  case (_, Some(pid))           => f.processInstanceKey(pid.toLong)
                  case _                        => ()
                end match
              )
              .send()
              .join()
              .items()
          .mapError: err =>
            EngineError.ProcessError(
              s"Problem getting Incidents: $err"
            )
    yield mapToIncidents(incidentDtos)

  private def mapToIncidents(
      incidents: java.util.List[camunda.Incident]
  ): List[Incident] =
    incidents.asScala.toList.map(mapToIncident)

  private def mapToIncident(
      incident: camunda.Incident
  ): Incident =
    Incident(
      id = incident.getIncidentKey.toString,
      processDefinitionId = Option(incident.getProcessDefinitionId),
      processInstanceId = Option(incident.getProcessInstanceKey).map(_.toString),
      executionId = None, // not supported
      incidentTimestamp = OffsetDateTime.parse(incident.getCreationTime),
      incidentType = incident.getErrorType.toString,
      activityId = None, // not supported
      failedActivityId = None, // not supported
      causeIncidentId = None,  // not supported
      rootCauseIncidentId = None, // not supported
      configuration = None, // not supported
      tenantId = Option(incident.getTenantId),
      incidentMessage = Option(incident.getErrorMessage),
      jobDefinitionId = Option(incident.getJobKey).map(_.toString),
      annotation = None, // not supported
      state = Option(incident.getState).map(_.toString)
    )
end C8IncidentService
