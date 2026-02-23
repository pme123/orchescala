package orchescala.worker.operaton

import orchescala.engine.EngineRuntime
import org.apache.hc.client5.http.config.ConnectionConfig
import org.apache.hc.client5.http.impl.io.{
  PoolingHttpClientConnectionManager,
  PoolingHttpClientConnectionManagerBuilder
}
import org.apache.hc.core5.pool.{PoolConcurrencyPolicy, PoolReusePolicy}
import org.apache.hc.core5.util.{TimeValue, Timeout}
import zio.{Scope, Unsafe, ZIO}

/**
 * Provides a shared HTTP connection manager for Operaton clients
 * to avoid creating new connections for each client
 */
object SharedHttpClientManager:
  
  // A shared, cached instance of the connection manager
  lazy val connectionManager: PoolingHttpClientConnectionManager = Unsafe.unsafe :
    implicit unsafe =>
      EngineRuntime.zioRuntime.unsafe.run(createConnectionManager.provideLayer(EngineRuntime.logger)).getOrThrow()
  
  private lazy val createConnectionManager: ZIO[Any, Throwable, PoolingHttpClientConnectionManager] =
    ZIO.logInfo("Creating shared HTTP connection manager for Operaton clients") *>
    ZIO.attempt {

      // Create default connection configuration
      val defaultConnectionConfig = ConnectionConfig.custom()
        .setConnectTimeout(Timeout.ofSeconds(30))
        .setSocketTimeout(Timeout.ofSeconds(30))
        // Increase TTL to reduce connection churn - set to 24 hours
        .setTimeToLive(TimeValue.ofHours(24))
        // Increase validation time to reduce connection churn
        .setValidateAfterInactivity(Timeout.ofHours(1))
        .build()

      // Create the connection manager with the builder
      val manager = PoolingHttpClientConnectionManagerBuilder.create()
        .setDefaultConnectionConfig(defaultConnectionConfig)
        .setMaxConnPerRoute(10)
        .setMaxConnTotal(50)
        .setPoolConcurrencyPolicy(PoolConcurrencyPolicy.STRICT)
        // Use FIFO instead of LIFO to distribute load more evenly
        .setConnPoolPolicy(PoolReusePolicy.FIFO)
        .build()

      manager
    }

  /**
   * ZIO finalizer to properly close the connection manager
   * This should be added to your application's shutdown sequence
   */
  lazy val engineConnectionManagerFinalizer: ZIO[Scope, Nothing, Any] = ZIO
    .addFinalizer {
      ZIO
        .attempt {
          connectionManager.close()
        }
        .catchAll { ex =>
          ZIO.logError(s"Error closing Operaton HTTP connection manager: ${ex.getMessage}")
        }
        .zipLeft(ZIO.logInfo("Operaton HTTP connection manager closed successfully"))
    }
    .uninterruptible
end SharedHttpClientManager

