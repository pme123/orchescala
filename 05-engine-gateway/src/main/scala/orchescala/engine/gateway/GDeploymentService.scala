package orchescala.engine.gateway

import orchescala.engine.domain.{DeploymentInfo, DeploymentManifest, DeploymentResource, DeploymentResult, EngineError, EngineType}
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
        // a listing needs every engine - not just the first one that answers
        // (tryServicesWithErrorCollection stops at the first success)
        ZIO
          .foreachPar(services): service =>
            service
              .getDeployments(Some(service.engineType))
              .map(_.map(_.copy(engineType = Some(service.engineType))))
              .either
              .map(service.engineType -> _)
          .flatMap: results =>
            val failures = results.collect { case (engineType, Left(err)) => engineType -> err }
            val infos    = results.collect { case (_, Right(infos)) => infos }.flatten
            if results.isEmpty then
              ZIO.fail(EngineError.ProcessError("No services available for getDeployments"))
            else if failures.size == results.size then
              ZIO.fail(EngineError.ProcessError(
                s"All services failed for getDeployments: ${failures.map((e, err) => s"$e: ${err.errorMsg}").mkString("; ")}"
              ))
            else
              ZIO
                .foreachDiscard(failures): (engineType, err) =>
                  ZIO.logWarning(s"getDeployments failed for $engineType - left out: ${err.errorMsg}")
                .as(infos)
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

  override def postDeployments(
      manifest: DeploymentManifest,
      targetEngine: Option[EngineType] = None
  ): IO[EngineError, Seq[DeploymentResult]] =
    targetEngine match
      case Some(engineType) =>
        ZIO
          .fromOption(services.find(_.engineType == engineType))
          .orElseFail(
            EngineError.ProcessError(
              s"No deployment service found for engine type $engineType"
            )
          )
          .flatMap(service =>
            service
              .postDeployments(manifest, Some(engineType))
              .map(_.map(_.copy(engineType = service.engineType)))
          )
      case None             =>
        if services.isEmpty then
          ZIO.fail(EngineError.ProcessError("No deployment services available"))
        else
          ZIO
            .foreach(services): service =>
              ZIO.logInfo(s"Deploying manifest to ${service.engineType}") *>
                service
                  .postDeployments(manifest, Some(service.engineType))
                  .map(_.map(_.copy(engineType = service.engineType)))
            .map(_.flatten)
  end postDeployments

end GDeploymentService
