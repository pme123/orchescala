package orchescala.worker.op

import org.operaton.bpm.client.ExternalTaskClient
import orchescala.engine.SharedClientManager
import zio.{ZIO, *}

/** Service trait for managing shared Operaton ExternalTaskClient */
type SharedOpExternalClientManager = SharedClientManager[ExternalTaskClient, Throwable]

object SharedOpExternalClientManager:

  /** ZLayer that provides SharedOperatonExternalClientManager service */
  val layer: ZLayer[Any, Nothing, SharedOpExternalClientManager] =
    SharedClientManager.createLayer[ExternalTaskClient, Throwable](
      "Operaton ExternalTask",
      client =>
        ZIO
          .attempt(client.stop())
          .tapBoth(
            err => ZIO.logError(s"Error closing shared Operaton client: $err"),
            _ => ZIO.logInfo("Shared Operaton client closed successfully")
          ).ignore
    )

  /** Convenience method to access the service */
  def getOrCreateClient(clientFactory: ZIO[Any, Throwable, ExternalTaskClient])
      : ZIO[SharedOpExternalClientManager, Throwable, ExternalTaskClient] =
    SharedClientManager.getOrCreateClient(clientFactory)

end SharedOpExternalClientManager

