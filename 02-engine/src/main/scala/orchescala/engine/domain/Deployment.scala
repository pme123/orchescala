package orchescala.engine.domain

import java.time.Instant
import orchescala.engine.domain.EngineType

case class DeploymentResource(
    name: String,
    content: Array[Byte],
    resourceType: DeploymentResourceType
)

enum DeploymentResourceType:
  case Bpmn, Dmn, Form, Script

case class DeploymentResult(
    deploymentId: String,
    name: String,
    engineType: EngineType,
    deploymentTime: Instant,
    deployedProcesses: Seq[ProcessDefinitionInfo],
    deployedDecisions: Seq[DecisionDefinitionInfo],
    deployedForms: Seq[FormInfo],
    deployedScripts: Seq[ScriptInfo]
)

case class DeploymentInfo(
    id: String,
    name: String,
    deploymentTime: Option[Instant]
)

case class ProcessDefinitionInfo(id: String, key: String, version: Int)
case class DecisionDefinitionInfo(id: String, key: String, version: Int)
case class FormInfo(id: String, key: String, version: Int)
case class ScriptInfo(id: String, resourceName: String)

case class DeploymentEntry(
    company: String,
    project: String,
    version: String
):
  def deploymentName: String = s"$company-$project-$version"
end DeploymentEntry

case class DeploymentManifest(deployments: Seq[DeploymentEntry])
