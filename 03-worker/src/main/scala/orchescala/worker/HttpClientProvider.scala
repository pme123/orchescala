package orchescala.worker

import org.asynchttpclient.{AsyncHttpClient, DefaultAsyncHttpClient, DefaultAsyncHttpClientConfig}
import sttp.client3.SttpBackend
import sttp.client3.asynchttpclient.zio.{AsyncHttpClientZioBackend, ZioWebSocketsStreams}
import zio.{Task, Unsafe, ZIO, ZLayer}

type SttpClientBackend = SttpBackend[Task, ZioWebSocketsStreams]

object HttpClientProvider:

  // A shared, cached instance of the backend
  lazy val cachedBackend: SttpClientBackend = Unsafe.unsafe:
    implicit unsafe =>
      WorkerRuntime.zioRuntime.unsafe.run(createBackend.provideLayer(ZioLogger.logger)).getOrThrow()

  // A shared, cached instance of the underlying AsyncHttpClient
  private lazy val sharedHttpClient: AsyncHttpClient = Unsafe.unsafe:
    implicit unsafe =>
      WorkerRuntime.zioRuntime.unsafe.run(createHttpClient.provideLayer(ZioLogger.logger)).getOrThrow()

  private lazy val createHttpClient: ZIO[Any, Throwable, AsyncHttpClient] =
    ZIO.logInfo("Creating shared AsyncHttpClient") *>
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

        new DefaultAsyncHttpClient(config)
      }

  lazy val createBackend: ZIO[Any, Throwable, SttpClientBackend] =
    ZIO.logInfo("Creating STTP client backend using shared HTTP client") *>
      ZIO.succeed(
        AsyncHttpClientZioBackend.usingClient(
          runtime = WorkerRuntime.zioRuntime,
          client = sharedHttpClient
        )
      )

  // Keep the layer for compatibility
  lazy val live: ZLayer[Any, Throwable, SttpClientBackend] = ZLayer
    .succeed(cachedBackend)

  lazy val threadPoolFinalizer = ZIO
    .addFinalizer:
      (cachedBackend.close() *> ZIO.attempt(sharedHttpClient.close()))
        .catchAll: ex =>
          ZIO.logError(s"Error closing HTTP client.\n$ex")
        .zipLeft(ZIO.logInfo("HTTP client closed successfully"))
end HttpClientProvider
