package orchescala.engine.c7

import orchescala.engine.SharedClientManager
import orchescala.engine.domain.{EngineError, EngineType}
import org.camunda.community.rest.client.invoker.ApiClient
import zio.*

/** Service trait for managing shared Camunda C7 API Client for simulations */
type SharedC7ClientManager = SharedClientManager[ApiClient, EngineError]

object SharedC7ClientManager:

  /** ZLayer that provides SharedC7ClientManager service */
  val layer: ZLayer[Any, Nothing, SharedC7ClientManager] =
    SharedClientManager.createLayer[ApiClient, EngineError](
      EngineType.C7.toString,
      client => ZIO.attempt(client.getHttpClient.close()).ignore
    )

  /** Convenience method to access the service */
  def getOrCreateClient(clientFactory: ZIO[Any, EngineError, ApiClient]): ZIO[SharedC7ClientManager, EngineError, ApiClient] =
    SharedClientManager.getOrCreateClient(clientFactory)

end SharedC7ClientManager