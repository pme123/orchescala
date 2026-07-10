package orchescala.worker.c7

import orchescala.engine.EngineRuntime
import org.apache.hc.client5.http.config.ConnectionConfig
import org.apache.hc.client5.http.impl.io.{
  PoolingHttpClientConnectionManager,
  PoolingHttpClientConnectionManagerBuilder
}
import org.apache.hc.core5.pool.{PoolConcurrencyPolicy, PoolReusePolicy}
import org.apache.hc.core5.util.{TimeValue, Timeout}
import zio.{Scope, Unsafe, ZIO}

import java.util.concurrent.{Executors, TimeUnit}

/**
 * Provides a shared HTTP connection manager for Camunda clients
 * to avoid creating new connections for each client
 */
object SharedHttpClientManager:
  
  // A shared, cached instance of the connection manager
  lazy val connectionManager: PoolingHttpClientConnectionManager = Unsafe.unsafe :
    implicit unsafe =>
      EngineRuntime.zioRuntime.unsafe.run(createConnectionManager.provideLayer(EngineRuntime.logger)).getOrThrow()
  
  private lazy val createConnectionManager: ZIO[Any, Throwable, PoolingHttpClientConnectionManager] =
    ZIO.logInfo("Creating shared HTTP connection manager for Camunda clients") *>
    ZIO.attempt {

      // Create default connection configuration
      val defaultConnectionConfig = ConnectionConfig.custom()
        .setConnectTimeout(Timeout.ofSeconds(30))
        .setSocketTimeout(Timeout.ofSeconds(30))
        // OpenShift HAProxy closes idle connections after ~30s; keep TTL short to avoid stale connections
        .setTimeToLive(TimeValue.ofMinutes(5))
        // Validate connections after 20s of inactivity (below OpenShift HAProxy idle timeout)
        .setValidateAfterInactivity(Timeout.ofSeconds(20))
        .build()

      // Create the connection manager with the builder
      // maxConnPerRoute must comfortably exceed maxTasks (concurrent task complete/fail calls)
      // plus 1 for the long-polling fetchAndLock connection, otherwise the pool gets exhausted
      // and new requests block until connectionRequestTimeout (default 3 minutes) elapses.
      val manager = PoolingHttpClientConnectionManagerBuilder.create()
        .setDefaultConnectionConfig(defaultConnectionConfig)
        .setMaxConnPerRoute(30)
        .setMaxConnTotal(60)
        .setPoolConcurrencyPolicy(PoolConcurrencyPolicy.STRICT)
        // Use FIFO instead of LIFO to distribute load more evenly
        .setConnPoolPolicy(PoolReusePolicy.FIFO)
        .build()

      startIdleConnectionMonitor(manager)

      manager
    }

  /**
   * Periodically evicts expired and long-idle connections from the pool.
   * Without this, connections silently dropped by an intermediate proxy (e.g. OpenShift
   * HAProxy) can accumulate in the pool as unusable, shrinking the effective pool size
   * over time until fetchAndLock requests can no longer acquire a connection.
   */
  private def startIdleConnectionMonitor(manager: PoolingHttpClientConnectionManager): Unit =
    val scheduler = Executors.newSingleThreadScheduledExecutor { r =>
      val t = new Thread(r, "camunda-http-conn-evictor")
      t.setDaemon(true)
      t
    }
    scheduler.scheduleWithFixedDelay(
      () =>
        try
          manager.closeExpired()
          manager.closeIdle(TimeValue.ofSeconds(30))
        catch case _: Throwable => (),
      30,
      30,
      TimeUnit.SECONDS
    )

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
          ZIO.logError(s"Error closing Camunda HTTP connection manager: ${ex.getMessage}")
        }
        .zipLeft(ZIO.logInfo("Camunda HTTP connection manager closed successfully"))
    }
    .uninterruptible
end SharedHttpClientManager