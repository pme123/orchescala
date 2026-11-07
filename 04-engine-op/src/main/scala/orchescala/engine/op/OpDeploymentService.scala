package orchescala.engine.op

import orchescala.engine.c7.C7DeploymentService
import orchescala.engine.domain.{DeploymentEntry, DeploymentResource, EngineError}
import orchescala.engine.EngineConfig
import orchescala.engine.services.{ManifestResolver, RepositoryManifestResolver}
import org.camunda.community.rest.client.invoker.ApiClient
import zio.{IO, ZIO}

class OpDeploymentService(using
    apiClientZIO: IO[EngineError, ApiClient],
    engineConfig: EngineConfig
) extends C7DeploymentService(using apiClientZIO, engineConfig),
      OpService:

  // Operaton has the API of Camunda 7 - a project without a folder `operaton` deploys its
  // `camunda` (C7) resources
  override protected lazy val manifestResolver: ManifestResolver =
    val operaton = RepositoryManifestResolver(
      "operaton",
      fallbackToRoot = true,
      repositories = engineConfig.deploymentRepositories
    )
    val camunda  = RepositoryManifestResolver(
      "camunda",
      fallbackToRoot = true,
      repositories = engineConfig.deploymentRepositories
    )
    new ManifestResolver:
      override def resolve(entry: DeploymentEntry): IO[EngineError, Seq[DeploymentResource]] =
        operaton.resolve(entry).flatMap: resources =>
          if resources.nonEmpty then ZIO.succeed(resources)
          else
            ZIO.logDebug(s"No folder operaton in ${entry.deploymentName} - deploying its folder camunda") *>
              camunda.resolve(entry)
  end manifestResolver

end OpDeploymentService
