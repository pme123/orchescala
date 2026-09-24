package orchescala.engine.c8

import io.circe.{Decoder, Json}
import io.circe.generic.semiauto.deriveDecoder

import java.time.{OffsetDateTime, ZonedDateTime}
import scala.util.Try

/** Responses of the Camunda 8 REST API (v2) - only the fields the engine services use. Keys are
  * strings in the API (they exceed JavaScript's safe integer range).
  */
private[c8] object C8RestModel:

  final case class CreateProcessInstanceResult(processInstanceKey: String)

  final case class ProcessInstanceResult(
      processInstanceKey: String,
      processDefinitionId: String,
      processDefinitionName: Option[String],
      processDefinitionVersion: Int,
      processDefinitionKey: String,
      parentProcessInstanceKey: Option[String],
      rootProcessInstanceKey: Option[String],
      startDate: OffsetDateTime,
      endDate: Option[OffsetDateTime],
      state: String,
      tenantId: Option[String]
  )

  final case class VariableResult(
      variableKey: String,
      name: String,
      value: Option[String],
      isTruncated: Option[Boolean],
      processInstanceKey: Option[String],
      tenantId: Option[String]
  )

  final case class IncidentResult(
      incidentKey: String,
      processDefinitionId: Option[String],
      processInstanceKey: Option[String],
      errorType: String,
      errorMessage: Option[String],
      creationTime: OffsetDateTime,
      state: Option[String],
      tenantId: Option[String],
      jobKey: Option[String]
  )

  final case class MessageCorrelationResult(messageKey: String, processInstanceKey: Option[String])
  final case class MessagePublicationResult(messageKey: String)

  final case class UserTaskResult(
      userTaskKey: String,
      elementId: Option[String],
      name: Option[String],
      assignee: Option[String],
      state: Option[String],
      creationDate: Option[OffsetDateTime],
      dueDate: Option[OffsetDateTime],
      followUpDate: Option[OffsetDateTime],
      priority: Option[Int],
      processDefinitionKey: Option[String],
      processDefinitionId: Option[String],
      processInstanceKey: Option[String],
      externalFormReference: Option[String],
      formKey: Option[String],
      tenantId: Option[String]
  )

  final case class ProcessDefinitionResult(
      processDefinitionKey: String,
      processDefinitionId: String,
      version: Int
  )

  final case class DeployedProcess(
      processDefinitionKey: String,
      processDefinitionId: String,
      processDefinitionVersion: Int
  )
  final case class DeployedDecision(
      decisionDefinitionKey: String,
      decisionDefinitionId: String,
      version: Int
  )
  final case class DeployedForm(formKey: String, formId: String, version: Int)
  final case class DeploymentMetadata(
      processDefinition: Option[DeployedProcess],
      decisionDefinition: Option[DeployedDecision],
      form: Option[DeployedForm]
  )
  final case class DeploymentResult(deploymentKey: String, deployments: Seq[DeploymentMetadata])

  // same leniency as the SDK (ParseUtil): ISO offset date-time, else zoned date-time
  given Decoder[OffsetDateTime] = Decoder.decodeString.emapTry: str =>
    Try(OffsetDateTime.parse(str)).orElse(Try(ZonedDateTime.parse(str).toOffsetDateTime))

  given Decoder[CreateProcessInstanceResult] = deriveDecoder
  given Decoder[ProcessInstanceResult]       = deriveDecoder
  given Decoder[VariableResult]              = deriveDecoder
  given Decoder[IncidentResult]              = deriveDecoder
  given Decoder[MessageCorrelationResult]    = deriveDecoder
  given Decoder[MessagePublicationResult]    = deriveDecoder
  given Decoder[UserTaskResult]              = deriveDecoder
  given Decoder[ProcessDefinitionResult]     = deriveDecoder
  given Decoder[DeployedProcess]             = deriveDecoder
  given Decoder[DeployedDecision]            = deriveDecoder
  given Decoder[DeployedForm]                = deriveDecoder
  given Decoder[DeploymentMetadata]          = deriveDecoder
  given Decoder[DeploymentResult]            = deriveDecoder

  /** A string filter property: exact match for one value, `$in` for several. */
  def nameFilter(names: Seq[String]): Option[Json] =
    names match
      case Seq()       => None
      case Seq(single) => Some(Json.fromString(single))
      case many        => Some(Json.obj("$in" -> Json.arr(many.map(Json.fromString)*)))

  /** Filter object without the unset (None) properties. */
  def filter(properties: (String, Option[Json])*): Json =
    Json.obj(properties.collect { case (key, Some(value)) => key -> value }*)

end C8RestModel
