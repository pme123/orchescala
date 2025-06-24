package orchescala.engine.domain

import java.time.OffsetDateTime
import orchescala.domain.*

case class Incident(
    id: String,
    processDefinitionId: Option[String] = None,
    processInstanceId: Option[String] = None,
    executionId: Option[String] = None,
    incidentTimestamp: OffsetDateTime,
    incidentType: String,
    activityId: Option[String] = None,
    failedActivityId: Option[String] = None,
    causeIncidentId: Option[String] = None,
    rootCauseIncidentId: Option[String] = None,
    configuration: Option[String] = None,
    tenantId: Option[String] = None,
    incidentMessage: Option[String] = None,
    jobDefinitionId: Option[String] = None,
    annotation: Option[String] = None
)

object Incident:
  given InOutCodec[Incident] = deriveInOutCodec