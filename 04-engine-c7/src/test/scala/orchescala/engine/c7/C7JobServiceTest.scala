package orchescala.engine.c7

import com.sun.net.httpserver.HttpServer
import io.circe.parser
import orchescala.engine.{DefaultEngineConfig, EngineConfig}
import orchescala.engine.domain.EngineError
import org.camunda.community.rest.client.invoker.ApiClient
import zio.*
import zio.test.*

import java.net.InetSocketAddress
import java.nio.charset.StandardCharsets
import java.util.concurrent.ConcurrentLinkedQueue
import scala.jdk.CollectionConverters.*

object C7JobServiceTest extends ZIOSpecDefault:

  /** C7 stub: no jobs - records the job queries. */
  private val engine: ZIO[Scope, Throwable, (String, ConcurrentLinkedQueue[String])] =
    ZIO.acquireRelease(
      ZIO.attempt:
        val queries = ConcurrentLinkedQueue[String]()
        val server  = HttpServer.create(InetSocketAddress("localhost", 0), 0)
        server.createContext(
          "/",
          exchange =>
            queries.add(String(exchange.getRequestBody.readAllBytes(), StandardCharsets.UTF_8))
            val body = "[]".getBytes(StandardCharsets.UTF_8)
            exchange.getResponseHeaders.add("Content-Type", "application/json")
            exchange.sendResponseHeaders(200, body.length)
            exchange.getResponseBody.write(body)
            exchange.close()
        )
        server.start()
        (server, queries)
    )((server, _) => ZIO.succeed(server.stop(0)))
      .map((server, queries) => (s"http://localhost:${server.getAddress.getPort}", queries))

  private def service(baseUrl: String) =
    given IO[EngineError, ApiClient] = ZIO.succeed:
      val client = ApiClient(ApiHttpClient.pooled())
      client.setBasePath(baseUrl)
      client
    given EngineConfig = DefaultEngineConfig()
    C7JobService()

  private def timers(query: String) = parser.parse(query).toOption.get.hcursor.get[Boolean]("timers").toOption

  def spec = suite("C7 jobs")(
    test("timersOnly: only the jobs of timers - the timer step triggered the first job") {
      for
        (baseUrl, queries) <- engine
        _                  <- service(baseUrl).getJobs(Some("pi-1"), timersOnly = true)
        _                  <- service(baseUrl).getJobs(Some("pi-1"))
      yield
        val sent = queries.asScala.toList
        assertTrue(timers(sent.head).contains(true), timers(sent(1)).isEmpty)
    }
  )
end C7JobServiceTest
