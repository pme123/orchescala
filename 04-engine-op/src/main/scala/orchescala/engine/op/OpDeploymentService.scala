package orchescala.engine.op

import orchescala.engine.c7.C7DeploymentService
import orchescala.engine.domain.EngineError
import orchescala.engine.EngineConfig
import orchescala.engine.services.{ManifestResolver, RepositoryManifestResolver}
import org.camunda.community.rest.client.invoker.ApiClient
import zio.IO

class OpDeploymentService(using
    apiClientZIO: IO[EngineError, ApiClient],
    engineConfig: EngineConfig
) extends C7DeploymentService(using apiClientZIO, engineConfig),
      OpService:

  override protected lazy val manifestResolver: ManifestResolver =
    RepositoryManifestResolver(
      "operaton",
      fallbackToRoot = true,
      repositories = engineConfig.deploymentRepositories
    )

end OpDeploymentService
