package orchescala.worker

import org.asynchttpclient.{DefaultAsyncHttpClient, DefaultAsyncHttpClientConfig}
import sttp.client3.SttpBackend
import sttp.client3.asynchttpclient.zio.{AsyncHttpClientZioBackend, ZioWebSocketsStreams}
import zio.{Task, Unsafe, ZIO, ZLayer}

type SttpClientBackend = SttpBackend[Task, ZioWebSocketsStreams]

object HttpClientProvider:

  // A shared, cached instance of the backend
  lazy val cachedBackend: SttpClientBackend = Unsafe.unsafe:
    implicit unsafe =>
      WorkerRuntime.zioRuntime.unsafe.run(createBackend).getOrThrow()

  private lazy val createBackend: ZIO[Any, Throwable, SttpClientBackend] =
    ZIO.logInfo("Creating shared HTTP client") *>
      ZIO.attempt {
        val config = new DefaultAsyncHttpClientConfig.Builder()
          .setThreadPoolName("async-http-client")
          .setIoThreadsCount(1)
          .setUseNativeTransport(false)
          .setMaxConnections(50)
          .setMaxConnectionsPerHost(10)
          .setConnectTimeout(30000)
          .setReadTimeout(30000)
          .setKeepAlive(true)
          .setPooledConnectionIdleTimeout(30000) // Close idle connections after 30 seconds
          .build()

        val client = new DefaultAsyncHttpClient(config)
        AsyncHttpClientZioBackend.usingClient(runtime = WorkerRuntime.zioRuntime, client = client)
      }

  // Keep the layer for compatibility
  lazy val live: ZLayer[Any, Throwable, SttpClientBackend] = ZLayer
    .succeed(cachedBackend)

  lazy val threadPoolFinalizer = ZIO
    .addFinalizer:
      ZIO
        .attempt:
          cachedBackend.close()
        .catchAll: ex =>
          ZIO.logError(s"Error closing HTTP client.\n$ex")
        .zipLeft(ZIO.logInfo("HTTP client closed successfully"))
end HttpClientProvider
