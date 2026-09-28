package orchescala.engine.c7

import com.sun.net.httpserver.HttpServer
import io.circe.{Json, JsonObject, parser}
import orchescala.domain.IdentityCorrelation
import orchescala.engine.{DefaultEngineConfig, EngineConfig}
import orchescala.engine.domain.EngineError
import org.camunda.community.rest.client.invoker.ApiClient
import zio.*
import zio.test.*

import java.net.InetSocketAddress
import java.nio.charset.StandardCharsets
import java.util.concurrent.ConcurrentLinkedQueue
import scala.jdk.CollectionConverters.*

/** The two steps of a start with an identity: start (marked pending), then set the signed correlation. */
object C7IdentityPendingTest extends ZIOSpecDefault:

  private case class Call(method: String, path: String, body: String)

  /** C7 stub: a start answers a process instance, the variables PATCH `patchStatus`. */
  private def engine(patchStatus: Int): ZIO[Scope, Throwable, (String, ConcurrentLinkedQueue[Call])] =
    ZIO.acquireRelease(
      ZIO.attempt:
        val calls  = ConcurrentLinkedQueue[Call]()
        val server = HttpServer.create(InetSocketAddress("localhost", 0), 0)
        server.createContext(
          "/",
          exchange =>
            val path = exchange.getRequestURI.getPath
            calls.add(Call(
              exchange.getRequestMethod,
              path,
              String(exchange.getRequestBody.readAllBytes(), StandardCharsets.UTF_8)
            ))
            if path.endsWith("/variables") then
              exchange.sendResponseHeaders(patchStatus, -1)
            else
              val body = """{"id":"pi-1","variables":{}}""".getBytes(StandardCharsets.UTF_8)
              exchange.getResponseHeaders.add("Content-Type", "application/json")
              exchange.sendResponseHeaders(200, body.length)
              exchange.getResponseBody.write(body)
            exchange.close()
        )
        server.start()
        (server, calls)
    )((server, _) => ZIO.succeed(server.stop(0)))
      .map((server, calls) => (s"http://localhost:${server.getAddress.getPort}", calls))

  private def service(baseUrl: String) =
    given IO[EngineError, ApiClient] = ZIO.succeed:
      val client = ApiClient(ApiHttpClient.pooled())
      client.setBasePath(baseUrl)
      client
    given EngineConfig = DefaultEngineConfig(identitySigningKey = Some("secret"))
    C7ProcessInstanceService()

  private def json(body: String) = parser.parse(body).toOption.get.hcursor

  def spec = suite("C7 start with an identity")(
    test("the start is marked pending, the second step sets the correlation and removes the marker") {
      for
        (baseUrl, calls) <- engine(patchStatus = 204)
        _                <- service(baseUrl)
                              .startProcessAsync("p", JsonObject("a" -> Json.fromInt(1)), None, None, Some(IdentityCorrelation("alice")))
      yield
        val start = calls.asScala.find(_.path.endsWith("/start")).get
        val patch = calls.asScala.find(_.path.endsWith("/process-instance/pi-1/variables")).get
        assertTrue(
          json(start.body).downField("variables").downField("_identityCorrelationPending").downField("value")
            .as[Boolean].contains(true),
          json(patch.body).downField("modifications").downField("_identityCorrelation").succeeded,
          json(patch.body).downField("deletions").as[Seq[String]].contains(Seq("_identityCorrelationPending"))
        )
    },
    test("the second step fails: the process runs - its id is returned, not an error (no second start)") {
      for
        (baseUrl, _) <- engine(patchStatus = 500)
        info         <- service(baseUrl)
                          .startProcessAsync("p", JsonObject(), None, None, Some(IdentityCorrelation("alice")))
      yield assertTrue(info.processInstanceId == "pi-1")
    },
    test("a caller cannot set the marker") {
      for
        (baseUrl, calls) <- engine(patchStatus = 204)
        _                <- service(baseUrl)
                              .startProcessAsync("p", JsonObject("_identityCorrelationPending" -> Json.True), None, None, None)
      yield
        val start = calls.asScala.find(_.path.endsWith("/start")).get
        assertTrue(json(start.body).downField("variables").downField("_identityCorrelationPending").failed)
    }
  )
end C7IdentityPendingTest
