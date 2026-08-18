package orchescala.engine.op

import orchescala.engine.SharedClientManager
import orchescala.engine.domain.EngineError
import org.camunda.community.rest.client.invoker.ApiClient
import zio.*

/** Service trait for managing shared Op API Client for simulations */
type SharedOpClientManager = SharedClientManager[ApiClient, EngineError]

object SharedOpClientManager:

  /** ZLayer that provides SharedOpClientManager service */
  val layer: ZLayer[Any, Nothing, SharedOpClientManager] =
    SharedClientManager.createLayer[ApiClient, EngineError](
      "Op API",
      client => ZIO.attempt(client.getHttpClient.close()).ignore
    )

  /** Convenience method to access the service */
  def getOrCreateClient(clientFactory: ZIO[Any, EngineError, ApiClient]): ZIO[SharedOpClientManager, EngineError, ApiClient] =
    SharedClientManager.getOrCreateClient(clientFactory)

end SharedOpClientManager

