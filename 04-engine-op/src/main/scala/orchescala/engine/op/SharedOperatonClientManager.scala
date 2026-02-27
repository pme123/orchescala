package orchescala.engine.op

import orchescala.engine.SharedClientManager
import orchescala.engine.domain.EngineError
import org.camunda.community.rest.client.invoker.ApiClient
import zio.*

/** Service trait for managing shared Operaton API Client for simulations */
type SharedOpClientManager = SharedClientManager[ApiClient, EngineError]

object SharedOperatonClientManager:

  /** ZLayer that provides SharedOperatonClientManager service */
  val layer: ZLayer[Any, Nothing, SharedOpClientManager] =
    SharedClientManager.createLayer[ApiClient, EngineError](
      "Operaton API",
      client => ZIO.attempt(client.getHttpClient.close()).ignore
    )

  /** Convenience method to access the service */
  def getOrCreateClient(clientFactory: ZIO[Any, EngineError, ApiClient]): ZIO[SharedOpClientManager, EngineError, ApiClient] =
    SharedClientManager.getOrCreateClient(clientFactory)

end SharedOperatonClientManager

