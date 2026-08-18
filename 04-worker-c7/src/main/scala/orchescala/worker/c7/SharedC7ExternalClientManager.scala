package orchescala.worker.c7

import org.camunda.bpm.client.ExternalTaskClient
import orchescala.engine.SharedClientManager
import zio.{ZIO, *}

/** Service trait for managing shared Camunda C7 ExternalTaskClient */
type SharedC7ExternalClientManager = SharedClientManager[ExternalTaskClient, Throwable]

object SharedC7ExternalClientManager:

  /** ZLayer that provides SharedC7ExternalClientManager service */
  lazy val layer: ZLayer[Any, Nothing, SharedC7ExternalClientManager] =
    SharedClientManager.createLayer[ExternalTaskClient, Throwable](
      "C7 ExternalTask",
      client =>
        ZIO
          .attempt(client.stop())
    )

  /** Convenience method to access the service */
  def getOrCreateClient(clientFactory: ZIO[Any, Throwable, ExternalTaskClient])
      : ZIO[SharedC7ExternalClientManager, Throwable, ExternalTaskClient] =
    SharedClientManager.getOrCreateClient(clientFactory)

end SharedC7ExternalClientManager
