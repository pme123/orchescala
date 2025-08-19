package orchescala.engine.c7

import org.camunda.community.rest.client.invoker.ApiClient
import orchescala.engine.{EngineError, SharedClientManager}
import zio.*

/** Service trait for managing shared Camunda C7 API Client for simulations */
type SharedC7ClientManager = SharedClientManager[ApiClient, EngineError]

object SharedC7ClientManager:

  /** ZLayer that provides SharedC7ClientManager service */
  val layer: ZLayer[Any, Nothing, SharedC7ClientManager] =
    SharedClientManager.createLayer[ApiClient, EngineError](
      "C7 API",
      client => ZIO.attempt(client.getHttpClient.close()).ignore
    )

  /** Convenience method to access the service */
  def getOrCreateClient(clientFactory: ZIO[Any, EngineError, ApiClient]): ZIO[SharedC7ClientManager, EngineError, ApiClient] =
    SharedClientManager.getOrCreateClient(clientFactory)

end SharedC7ClientManager