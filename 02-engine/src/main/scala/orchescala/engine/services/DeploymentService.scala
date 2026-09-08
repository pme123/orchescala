package orchescala.engine.services

import orchescala.engine.domain.{DeploymentInfo, DeploymentResource, DeploymentResult, EngineError, EngineType}
import zio.IO

trait DeploymentService extends EngineService:

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
