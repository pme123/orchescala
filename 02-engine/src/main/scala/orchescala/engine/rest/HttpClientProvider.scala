package orchescala.engine.rest

import orchescala.engine.{EngineRuntime, Slf4JLogger}
import org.asynchttpclient.{AsyncHttpClient, DefaultAsyncHttpClient, DefaultAsyncHttpClientConfig}
import sttp.client3.SttpBackend
import sttp.client3.asynchttpclient.zio.{AsyncHttpClientZioBackend, ZioWebSocketsStreams}
import zio.{Task, Unsafe, ZIO, ZLayer}

type SttpClientBackend = SttpBackend[Task, ZioWebSocketsStreams]

object HttpClientProvider:

  // A shared, cached instance of the backend
  lazy val cachedBackend: SttpClientBackend = Unsafe.unsafe:
    implicit unsafe =>
      EngineRuntime.zioRuntime.unsafe.run(createBackend.provideLayer(EngineRuntime.logger)).getOrThrow()

  // A shared, cached instance of the underlying AsyncHttpClient
  private lazy val sharedHttpClient: AsyncHttpClient =
    val client = Unsafe.unsafe:
      implicit unsafe =>
        EngineRuntime.zioRuntime.unsafe.run(createHttpClient.provideLayer(EngineRuntime.logger)).getOrThrow()
    // Register a JVM shutdown hook to close the HTTP client on JVM exit.
    // This avoids the problem of closing the globally cached client at the end
    // of each ZIO scope, which would break later simulations in the same JVM.
    java.lang.Runtime.getRuntime.addShutdownHook(new Thread(() =>
      Unsafe.unsafe:
        implicit unsafe =>
          val _ = EngineRuntime.zioRuntime.unsafe.run(
            (cachedBackend.close() *> ZIO.attempt(client.close()))
              .catchAll(ex => ZIO.logError(s"Error closing HTTP client.\n$ex"))
              .zipLeft(ZIO.logInfo("HTTP client closed via shutdown hook"))
              .provideLayer(EngineRuntime.logger)
          )
    ))
    client

  private lazy val createHttpClient: ZIO[Any, Throwable, AsyncHttpClient] =
    ZIO.logInfo("Creating shared AsyncHttpClient") *>
      ZIO.attempt {
        val config = new DefaultAsyncHttpClientConfig.Builder()
          .setThreadPoolName("async-http-client")
          .setIoThreadsCount(1)
          .setUseNativeTransport(false)
          .setMaxConnections(50)
          .setMaxConnectionsPerHost(25)
          .setConnectTimeout(30000)
          .setReadTimeout(30000)
          .setKeepAlive(true)
          .setPooledConnectionIdleTimeout(30000) // Close idle connections after 30 seconds
          .build()

        new DefaultAsyncHttpClient(config)
      }

  lazy val createBackend: ZIO[Any, Throwable, SttpClientBackend] =
    ZIO.logInfo("Creating STTP client backend using shared HTTP client") *>
      ZIO.attempt:
        AsyncHttpClientZioBackend.usingClient(
          runtime = EngineRuntime.zioRuntime,
          client = sharedHttpClient
        )

  // Keep the layer for compatibility
  lazy val live: ZLayer[Any, Throwable, SttpClientBackend] = ZLayer
    .succeed(cachedBackend)

end HttpClientProvider
