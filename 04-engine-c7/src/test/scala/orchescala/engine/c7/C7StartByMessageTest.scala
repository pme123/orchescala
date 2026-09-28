package orchescala.engine.c7

import com.sun.net.httpserver.HttpServer
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

object C7StartByMessageTest extends ZIOSpecDefault:

  private val correlatedToRunning =
    """[{"resultType":"Execution","execution":{"id":"ex-1","processInstanceId":"running-pi"}}]"""
  private val started             =
    """[{"resultType":"ProcessDefinition","processInstance":{"id":"new-pi"}}]"""

  /** C7 stub: /message answers `messageResult`, records the requests (method, path, body). */
  private def engine(messageResult: String): ZIO[Scope, Throwable, (String, ConcurrentLinkedQueue[String])] =
    ZIO.acquireRelease(
      ZIO.attempt:
        val requests = ConcurrentLinkedQueue[String]()
        val server   = HttpServer.create(InetSocketAddress("localhost", 0), 0)
        server.createContext(
          "/",
          exchange =>
            val requestBody = String(exchange.getRequestBody.readAllBytes(), StandardCharsets.UTF_8)
            requests.add(s"${exchange.getRequestMethod} ${exchange.getRequestURI.getPath} $requestBody")
            val body =
              (if exchange.getRequestURI.getPath.endsWith("/message") then messageResult else "")
                .getBytes(StandardCharsets.UTF_8)
            exchange.getResponseHeaders.add("Content-Type", "application/json")
            if body.isEmpty then exchange.sendResponseHeaders(204, -1)
            else
              exchange.sendResponseHeaders(200, body.length)
              exchange.getResponseBody.write(body)
            exchange.close()
        )
        server.start()
        (server, requests)
    )((server, _) => ZIO.succeed(server.stop(0)))
      .map((server, requests) => (s"http://localhost:${server.getAddress.getPort}", requests))

  private def service(baseUrl: String) =
    given IO[EngineError, ApiClient] = ZIO.succeed:
      val client = ApiClient(ApiHttpClient.pooled())
      client.setBasePath(baseUrl)
      client
    given EngineConfig = DefaultEngineConfig(identitySigningKey = Some("secret"))
    C7ProcessInstanceService()

  private val alice = Some(IdentityCorrelation("alice"))

  def spec = suite("C7 start process by message")(
    test("a message correlated to a running instance is no start - and gets no identity") {
      for
        (baseUrl, requests) <- engine(correlatedToRunning)
        exit                <- service(baseUrl).startProcessByMessage("msg", identityCorrelation = alice).exit
      yield assertTrue(
        exit.causeOption.flatMap(_.failureOption).exists:
          case EngineError.ServiceRequestError(409, msg) => msg.contains("running-pi")
          case _                                         => false
        ,
        // the caller's identity was signed onto the running instance
        !requests.asScala.exists(r =>
          r.contains("/process-instance/running-pi/variables") && r.contains("\"_identityCorrelation\"")
        ),
        // the pending marker, delivered with the message, is removed again
        requests.asScala.exists(r =>
          r.contains("/process-instance/running-pi/variables") && r.contains("_identityCorrelationPending")
        )
      )
    },
    test("a started process gets the signed identity") {
      for
        (baseUrl, requests) <- engine(started)
        info                <- service(baseUrl).startProcessByMessage("msg", identityCorrelation = alice)
      yield assertTrue(
        info.processInstanceId == "new-pi",
        requests.asScala.exists(_.contains("/process-instance/new-pi/variables"))
      )
    }
  )
end C7StartByMessageTest
