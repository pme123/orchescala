package orchescala.engine.c7

import com.sun.net.httpserver.HttpServer
import io.circe.{Json, JsonObject, parser}
import orchescala.engine.{DefaultEngineConfig, EngineConfig}
import orchescala.engine.domain.EngineError
import org.camunda.community.rest.client.invoker.ApiClient
import zio.*
import zio.test.*

import java.net.InetSocketAddress
import java.nio.charset.StandardCharsets
import java.util.concurrent.ConcurrentLinkedQueue
import scala.jdk.CollectionConverters.*

object C7IdentityCorrelationFilterTest extends ZIOSpecDefault:

  /** C7 stub: answers every request with a started process instance, records the bodies. */
  private val engine: ZIO[Scope, Throwable, (String, ConcurrentLinkedQueue[String])] =
    ZIO.acquireRelease(
      ZIO.attempt:
        val bodies = ConcurrentLinkedQueue[String]()
        val server = HttpServer.create(InetSocketAddress("localhost", 0), 0)
        server.createContext(
          "/",
          exchange =>
            bodies.add(String(exchange.getRequestBody.readAllBytes(), StandardCharsets.UTF_8))
            val body = """{"id":"pi-1","variables":{}}""".getBytes(StandardCharsets.UTF_8)
            exchange.getResponseHeaders.add("Content-Type", "application/json")
            exchange.sendResponseHeaders(200, body.length)
            exchange.getResponseBody.write(body)
            exchange.close()
        )
        server.start()
        (server, bodies)
    )((server, _) => ZIO.succeed(server.stop(0)))
      .map((server, bodies) => (s"http://localhost:${server.getAddress.getPort}", bodies))

  def spec = suite("C7 caller supplied _identityCorrelation")(
    test("is removed before the process starts") {
      for
        (baseUrl, bodies) <- engine
        given IO[EngineError, ApiClient] = ZIO.succeed:
                                             val client = ApiClient(ApiHttpClient.pooled())
                                             client.setBasePath(baseUrl)
                                             client
        given EngineConfig = DefaultEngineConfig()
        forged = JsonObject(
                   "amount"               -> Json.fromInt(1),
                   "_identityCorrelation" -> Json.obj("username" -> Json.fromString("alice"))
                 )
        _ <- C7ProcessInstanceService().startProcessAsync("p", forged, None, None, None)
      yield
        val variables = parser.parse(bodies.asScala.head).toOption.get.hcursor.downField("variables")
        assertTrue(
          variables.downField("amount").succeeded,
          variables.downField("_identityCorrelation").failed
        )
    }
  )
end C7IdentityCorrelationFilterTest
