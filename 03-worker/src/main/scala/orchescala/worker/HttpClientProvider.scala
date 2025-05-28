package orchescala.worker

import sttp.client3.{SttpBackend, SttpBackendOptions}
import sttp.client3.asynchttpclient.zio.{AsyncHttpClientZioBackend, ZioWebSocketsStreams}
import zio.{Task, ZIO, ZLayer}
import org.asynchttpclient.{AsyncHttpClient, DefaultAsyncHttpClient, DefaultAsyncHttpClientConfig}
import io.netty.channel.EventLoopGroup
import io.netty.channel.nio.NioEventLoopGroup
import io.netty.util.concurrent.DefaultThreadFactory
import java.util.concurrent.{Executors, ThreadFactory, ThreadPoolExecutor}
import java.util.concurrent.TimeUnit

type SttpClientBackend = SttpBackend[Task, ZioWebSocketsStreams]

object HttpClientProvider:

  // Create a layer that provides a shared HTTP client with limited threads
  val live: ZLayer[Any, Throwable, SttpClientBackend] =
    ZLayer.scoped:
      for
        // Create a fixed thread pool with a custom thread factory
        threadPool <- ZIO.acquireRelease(ZIO.attempt:
                        val threadFactory = new DefaultThreadFactory("async-http-client", true)
                        val executor      = Executors.newFixedThreadPool(
                          4,
                          threadFactory
                        ).asInstanceOf[ThreadPoolExecutor]
                        executor): executor =>
                        ZIO.attempt:
                          executor.shutdown()
                          if !executor.awaitTermination(10, TimeUnit.SECONDS) then
                            executor.shutdownNow()
                        .catchAll: ex =>
                          ZIO.logError(s"Error shutting down thread pool: ${ex.getMessage}")

        // Create a custom event loop group with our thread pool
        eventLoopGroup <- ZIO.acquireRelease(ZIO.attempt:
                            new NioEventLoopGroup(1, threadPool)): group =>
                            ZIO.attempt:
                              group.shutdownGracefully(0, 10, TimeUnit.SECONDS)
                            .catchAll: ex =>
                              ZIO.logError(
                                s"Error shutting down event loop group: ${ex.getMessage}"
                              )

        // Create a custom AsyncHttpClient with our event loop group
        asyncHttpClient <- ZIO.acquireRelease(
                             ZIO.attempt:
                               val config = new DefaultAsyncHttpClientConfig.Builder()
                                 .setEventLoopGroup(eventLoopGroup)
                                 .setThreadPoolName("async-http-client")
                                 .setIoThreadsCount(1)
                                 .setUseNativeTransport(false)
                                 .setMaxConnections(50)
                                 .setMaxConnectionsPerHost(10)
                                 .setConnectTimeout(30000)
                                 .setReadTimeout(30000)
                                 .setKeepAlive(true)
                                 .build()

                               new DefaultAsyncHttpClient(config)
                           ): client =>
                             ZIO.attempt(client.close()).catchAll: ex =>
                               ZIO.logError(s"Error closing AsyncHttpClient: ${ex.getMessage}")

        // Create the STTP backend using our custom AsyncHttpClient
      yield AsyncHttpClientZioBackend.usingClient(runtime = WorkerRuntime.zioRuntime, client = asyncHttpClient)
end HttpClientProvider
