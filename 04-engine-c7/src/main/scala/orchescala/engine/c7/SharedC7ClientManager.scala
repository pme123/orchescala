package orchescala.engine.c7

import orchescala.engine.SharedClientManager
import orchescala.engine.domain.EngineError
import orchescala.engine.rest.SttpClientBackend
import org.camunda.community.rest.client.invoker.ApiClient
import zio.*

/** Service trait for managing shared Camunda C7 API Client for simulations */
type SharedC7ClientManager = SharedClientManager[ApiClient, EngineError]

object SharedC7ClientManager:

  /** ZLayer that provides SharedC7ClientManager service */
  lazy val layer: ZLayer[Any, Nothing, SharedC7ClientManager] =
    SharedClientManager.createLayer[ApiClient, EngineError](
      "C7 Client",
      client => ZIO
        .attempt(client.getHttpClient.close())
    )

  /** Convenience method to access the service */
  def getOrCreateClient(clientFactory: ZIO[Any, EngineError, ApiClient]): ZIO[SharedC7ClientManager, EngineError, ApiClient] =
    SharedClientManager.getOrCreateClient(clientFactory)

end SharedC7ClientManager