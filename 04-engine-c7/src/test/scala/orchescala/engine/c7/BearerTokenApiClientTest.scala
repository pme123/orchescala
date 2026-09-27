package orchescala.engine.c7

import com.sun.net.httpserver.HttpServer
import org.camunda.community.rest.client.api.VersionApi
import zio.test.*
import zio.{Scope, ZIO}

import java.net.InetSocketAddress
import java.nio.charset.StandardCharsets
import java.util.concurrent.ConcurrentLinkedQueue
import scala.jdk.CollectionConverters.*

object BearerTokenApiClientTest extends ZIOSpecDefault:

  /** Local server answering `/version`, recording the Authorization header of every request. */
  private val versionServer: ZIO[Scope, Throwable, (String, ConcurrentLinkedQueue[String])] =
    ZIO.acquireRelease(
      ZIO.attempt:
        val authHeaders = ConcurrentLinkedQueue[String]()
        val server      = HttpServer.create(InetSocketAddress("localhost", 0), 0)
        server.createContext(
          "/version",
          exchange =>
            authHeaders.add(exchange.getRequestHeaders.getFirst("Authorization"))
            val body = """{"version":"7.24.0"}""".getBytes(StandardCharsets.UTF_8)
            exchange.getResponseHeaders.add("Content-Type", "application/json")
            exchange.sendResponseHeaders(200, body.length)
            exchange.getResponseBody.write(body)
            exchange.close()
        )
        server.start()
        (server, authHeaders)
    )((server, _) => ZIO.succeed(server.stop(0)))
      .map((server, authHeaders) => (s"http://localhost:${server.getAddress.getPort}", authHeaders))

  def spec = suite("BearerTokenApiClient")(
    test("clients for different tokens share one connection pool and object mapper") {
      val clientA = BearerTokenApiClient("http://localhost:8080/engine-rest", "tokenA")
      val clientB = BearerTokenApiClient("http://localhost:8080/engine-rest", "tokenB")
      assertTrue(
        clientA ne clientB,
        clientA.getHttpClient eq clientB.getHttpClient,
        clientA.getObjectMapper eq clientB.getObjectMapper,
        clientA.getBasePath == "http://localhost:8080/engine-rest"
      )
    },
    test("each client sends its own token, also when used concurrently") {
      for
        (baseUrl, authHeaders) <- versionServer
        tokens                  = (1 to 20).map(i => s"token$i")
        versions               <- ZIO.foreachPar(tokens): token =>
                                    ZIO.attemptBlocking:
                                      VersionApi(BearerTokenApiClient(baseUrl, token))
                                        .getRestAPIVersion()
                                        .getVersion
      yield assertTrue(
        versions.forall(_ == "7.24.0"),
        authHeaders.asScala.toSeq.sorted == tokens.map(t => s"Bearer $t").sorted
      )
    }
  )
end BearerTokenApiClientTest
