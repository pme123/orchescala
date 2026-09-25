package orchescala.engine.c7

import com.sun.net.httpserver.HttpServer
import org.apache.hc.core5.util.Timeout
import org.camunda.community.rest.client.api.VersionApi
import org.camunda.community.rest.client.invoker.ApiClient
import zio.*
import zio.test.*

import java.net.InetSocketAddress

object ApiHttpClientTest extends ZIOSpecDefault:

  /** An engine that accepts the connection but never answers (GC pause, DB lock). */
  private val silentEngine: ZIO[Scope, Throwable, String] =
    ZIO.acquireRelease(
      ZIO.attempt:
        val server = HttpServer.create(InetSocketAddress("localhost", 0), 0)
        server.createContext("/version", _ => Thread.sleep(30_000))
        server.setExecutor(java.util.concurrent.Executors.newCachedThreadPool())
        server.start()
        server
    )(server => ZIO.succeed(server.stop(0)))
      .map(server => s"http://localhost:${server.getAddress.getPort}")

  def spec = suite("ApiHttpClient")(
    test("a call to an engine that never answers fails after the response timeout") {
      for
        baseUrl <- silentEngine
        client   = ApiClient(ApiHttpClient.pooled(responseTimeout = Timeout.ofSeconds(1)))
        _        = client.setBasePath(baseUrl)
        result  <- ZIO.attemptBlocking(VersionApi(client).getRestAPIVersion()).exit.timed
        _       <- ZIO.attempt(client.getHttpClient.close())
      yield
        val (duration, exit) = result
        assertTrue(exit.isFailure, duration < 10.seconds) // before: waited without limit
    }
  ) @@ TestAspect.withLiveClock @@ TestAspect.timeout(60.seconds)
end ApiHttpClientTest
