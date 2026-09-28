package orchescala.engine.domain

import java.time.Instant
import orchescala.engine.domain.EngineType

case class DeploymentResource(
    name: String,
    content: Array[Byte],
    resourceType: DeploymentResourceType
)

object DeploymentResource:

  /** The engines deploy a resource under its file name - `a/process.bpmn` and `b/process.bpmn`
    * overwrote each other (C7: the same temp file, only one was deployed), silently.
    */
  def uniqueFileNames(resources: Seq[DeploymentResource]): zio.IO[EngineError, Unit] =
    val duplicates = resources
      .groupBy(r => java.nio.file.Paths.get(r.name).getFileName.toString)
      .collect { case (fileName, rs) if rs.size > 1 => s"$fileName (${rs.map(_.name).mkString(", ")})" }
    if duplicates.isEmpty then zio.ZIO.unit
    else
      zio.ZIO.fail(EngineError.ServiceRequestError(
        400,
        s"Deployment resources with the same file name: ${duplicates.toSeq.sorted.mkString("; ")}"
      ))
  end uniqueFileNames

end DeploymentResource

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

/** One deployed unit as reported by `DeploymentService.getDeployments`.
  *
  * C7/Op: one entry per deployment (`id` = deployment id, `name` = deployment name). C8: Zeebe
  * has no deployment entity to list, so one entry per deployed process definition
  * (`id` = processDefinitionKey, `name` = bpmn process id) with its `version`.
  */
case class DeploymentInfo(
    id: String,
    name: String,
    deploymentTime: Option[Instant],
    engineType: Option[EngineType] = None,
    version: Option[Int] = None
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
