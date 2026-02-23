package orchescala.worker.operaton

import org.operaton.bpm.client.ExternalTaskClient
import orchescala.engine.SharedClientManager
import zio.{ZIO, *}

/** Service trait for managing shared Operaton ExternalTaskClient */
type SharedOperatonExternalClientManager = SharedClientManager[ExternalTaskClient, Throwable]

object SharedOperatonExternalClientManager:

  /** ZLayer that provides SharedOperatonExternalClientManager service */
  val layer: ZLayer[Any, Nothing, SharedOperatonExternalClientManager] =
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
      : ZIO[SharedOperatonExternalClientManager, Throwable, ExternalTaskClient] =
    SharedClientManager.getOrCreateClient(clientFactory)

end SharedOperatonExternalClientManager

