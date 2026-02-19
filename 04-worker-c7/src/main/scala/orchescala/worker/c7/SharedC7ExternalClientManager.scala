package orchescala.worker.c7

import org.camunda.bpm.client.ExternalTaskClient
import orchescala.engine.SharedClientManager
import orchescala.engine.domain.EngineType
import zio.{ZIO, *}

import scala.collection.concurrent.TrieMap

/** Service trait for managing shared Camunda C7 ExternalTaskClient - now delegates to generic SharedExternalClientManager */

object SharedC7ExternalClientManager:

  // Cache layers by engine type to ensure the same layer is reused
  // This prevents creating a new layer every time, which is critical for proper sharing
  private val cachedLayers: TrieMap[EngineType, ZLayer[Any, Nothing, SharedClientManager[ExternalTaskClient, Throwable]]] =
    TrieMap()

  /**
   * Get or create a shared ZLayer for managing ExternalTaskClient for any engine type.
   *
   * IMPORTANT: This method caches the layer by engine type. Multiple calls with the same
   * engine type will return the SAME cached layer, ensuring proper client sharing.
   *
   * This allows reusing C7 workers for Operation (Op) by simply providing a different engine type.
   */
  def layer(engineType: EngineType): ZLayer[Any, Nothing, SharedClientManager[ExternalTaskClient, Throwable]] =
    cachedLayers.getOrElseUpdate(
      engineType,
      createLayer(engineType)
    )

  /**
   * Create a new ZLayer for managing shared ExternalTaskClient.
   * Use layer(engineType) instead to get cached layers!
   */
  private def createLayer(engineType: EngineType): ZLayer[Any, Nothing, SharedClientManager[ExternalTaskClient, Throwable]] =
    SharedClientManager.createLayer[ExternalTaskClient, Throwable](
      s"$engineType ExternalTask",
      client =>
        ZIO
          .attempt(client.stop())
          .tapBoth(
            err => ZIO.logError(s"Error closing shared $engineType client: $err"),
            _ => ZIO.logInfo(s"Shared $engineType client closed successfully")
          ).ignore
    )

  /**
   * Get or create a client using the shared manager
   */
  def getOrCreateClient(clientFactory: ZIO[Any, Throwable, ExternalTaskClient]): ZIO[SharedClientManager[ExternalTaskClient, Throwable], Throwable, ExternalTaskClient] =
    SharedClientManager.getOrCreateClient(clientFactory)

end SharedC7ExternalClientManager
