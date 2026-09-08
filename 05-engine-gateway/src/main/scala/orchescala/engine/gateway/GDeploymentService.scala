package orchescala.engine.gateway

import orchescala.engine.domain.{DeploymentInfo, DeploymentResource, DeploymentResult, EngineError, EngineType}
import orchescala.engine.services.DeploymentService
import zio.{IO, ZIO}

class GDeploymentService(using
    services: Seq[DeploymentService]
) extends DeploymentService,
      GService:

  override def deploy(
      name: String,
      resources: Seq[DeploymentResource],
      targetEngine: Option[EngineType] = None
  ): IO[EngineError, DeploymentResult] =
    targetEngine match
      case Some(engineType) =>
        ZIO
          .fromOption(services.find(_.engineType == engineType))
          .orElseFail(
            EngineError.ProcessError(
              s"No deployment service found for engine type $engineType"
            )
          )
          .flatMap(_.deploy(name, resources, Some(engineType)))
      case None             =>
        tryServicesWithErrorCollection[DeploymentService, DeploymentResult](
          _.deploy(name, resources, None),
          "deploy"
        )
  end deploy

  override def getDeployments(
      targetEngine: Option[EngineType] = None
  ): IO[EngineError, Seq[DeploymentInfo]] =
    targetEngine match
      case Some(engineType) =>
        ZIO
          .fromOption(services.find(_.engineType == engineType))
          .orElseFail(
            EngineError.ProcessError(
              s"No deployment service found for engine type $engineType"
            )
          )
          .flatMap(_.getDeployments(Some(engineType)))
      case None             =>
        tryServicesWithErrorCollection[DeploymentService, Seq[DeploymentInfo]](
          _.getDeployments(None),
          "getDeployments"
        )
  end getDeployments

  override def deleteDeployment(
      deploymentId: String,
      cascade: Boolean = false,
      targetEngine: Option[EngineType] = None
  ): IO[EngineError, Unit] =
    targetEngine match
      case Some(engineType) =>
        ZIO
          .fromOption(services.find(_.engineType == engineType))
          .orElseFail(
            EngineError.ProcessError(
              s"No deployment service found for engine type $engineType"
            )
          )
          .flatMap(_.deleteDeployment(deploymentId, cascade, Some(engineType)))
      case None             =>
        tryServicesWithErrorCollection[DeploymentService, Unit](
          _.deleteDeployment(deploymentId, cascade, None),
          "deleteDeployment"
        )
  end deleteDeployment

end GDeploymentService
