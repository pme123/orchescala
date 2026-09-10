package orchescala.engine.services

import orchescala.engine.domain.{DeploymentInfo, DeploymentManifest, DeploymentResource, DeploymentResult, EngineError, EngineType}
import zio.{IO, ZIO}

trait DeploymentService extends EngineService:

  protected def manifestResolver: ManifestResolver = ManifestResolver.unsupported

  def deploy(
      name: String,
      resources: Seq[DeploymentResource],
      targetEngine: Option[EngineType] = None
  ): IO[EngineError, DeploymentResult]

  def getDeployments(
      targetEngine: Option[EngineType] = None
  ): IO[EngineError, Seq[DeploymentInfo]]

  def deleteDeployment(
      deploymentId: String,
      cascade: Boolean = false,
      targetEngine: Option[EngineType] = None
  ): IO[EngineError, Unit]

  def deployManifest(
      manifest: DeploymentManifest,
      targetEngine: Option[EngineType] = None
  ): IO[EngineError, Seq[DeploymentResult]] =
    ZIO.foreach(manifest.deployments): entry =>
      manifestResolver
        .resolve(entry)
        .flatMap: resources =>
          deploy(entry.deploymentName, resources, targetEngine)
end DeploymentService
