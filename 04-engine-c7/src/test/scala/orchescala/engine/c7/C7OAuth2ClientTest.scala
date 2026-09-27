package orchescala.engine.c7

import com.sun.net.httpserver.HttpServer
import orchescala.engine.rest.{OAuthConfig, TokenCache}
import org.camunda.community.rest.client.api.VersionApi
import zio.*
import zio.test.*

import java.net.InetSocketAddress
import java.nio.charset.StandardCharsets
import java.util.concurrent.ConcurrentLinkedQueue
import scala.jdk.CollectionConverters.*

object C7OAuth2ClientTest extends ZIOSpecDefault:

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

  def spec = suite("C7OAuth2Client")(
    test("uses the current token on every call - a refreshed token replaces an expired one") {
      for
        (baseUrl, authHeaders) <- versionServer
        oAuth2Client            = new C7OAuth2Client:
                                    val camundaRestUrl = baseUrl
                                    val oAuthConfig    = OAuthConfig.ClientCredentials(
                                      "realm", "http://sso.invalid", "c7-client", "secret", "openid"
                                    )
        cacheKey                = oAuth2Client.authFlow.cacheKey
        call                    = oAuth2Client.client
                                    .provideLayer(SharedC7ClientManager.layer)
                                    .flatMap(api => ZIO.attemptBlocking(VersionApi(api).getRestAPIVersion()))
        _                      <- ZIO.succeed(TokenCache.put(cacheKey, "token-1", Some(300)))
        _                      <- call
        // the cached token expired and was refetched (simulated by replacing the cache entry)
        _                      <- ZIO.succeed(TokenCache.put(cacheKey, "token-2", Some(300)))
        _                      <- call
      yield assertTrue(authHeaders.asScala.toSeq == Seq("Bearer token-1", "Bearer token-2"))
    }
  )
end C7OAuth2ClientTest
