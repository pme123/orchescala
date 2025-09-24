package orchescala.engine.c8

import io.camunda.client.CamundaClient
import orchescala.engine.SharedClientManager
import orchescala.engine.domain.EngineError
import zio.*

/** Service trait for managing shared Camunda C8 client */
type SharedC8ClientManager = SharedClientManager[CamundaClient, EngineError]

object SharedC8ClientManager:

  /** ZLayer that provides SharedC8ClientManager service */
  val layer: ZLayer[Any, Nothing, SharedC8ClientManager] =
    SharedClientManager.createLayer[CamundaClient, EngineError](
      "C8",
      client =>
        ZIO
          .attempt(client.close())
          .tapBoth(
            err => ZIO.logError(s"Error closing shared C8 client: ${err.getMessage}"),
            _ => ZIO.logInfo("Shared C8 client closed successfully")
          ).ignore
    )

  /** Convenience method to access the service */
  def getOrCreateClient(clientFactory: ZIO[Any, EngineError, CamundaClient])
      : ZIO[SharedC8ClientManager, EngineError, CamundaClient] =
    SharedClientManager.getOrCreateClient(clientFactory)

end SharedC8ClientManager
