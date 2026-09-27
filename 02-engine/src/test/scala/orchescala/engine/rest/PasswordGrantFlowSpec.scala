package orchescala.engine.rest

import com.sun.net.httpserver.HttpServer
import orchescala.domain.OrchescalaLogger
import orchescala.engine.Slf4JLogger
import zio.*
import zio.test.*

import java.net.InetSocketAddress
import java.nio.charset.StandardCharsets

object PasswordGrantFlowSpec extends ZIOSpecDefault:

  given OrchescalaLogger = Slf4JLogger.logger(getClass.getName)

  /** Keycloak stub: the token is `token-<client_id>`. */
  private val keycloak: ZIO[Scope, Throwable, String] =
    ZIO.acquireRelease(
      ZIO.attempt:
        val server = HttpServer.create(InetSocketAddress("localhost", 0), 0)
        server.createContext(
          "/realms/r/protocol/openid-connect/token",
          exchange =>
            val form     = String(exchange.getRequestBody.readAllBytes(), StandardCharsets.UTF_8)
            val clientId = form.split('&').collectFirst { case s"client_id=$id" => id }.get
            val body     =
              s"""{"access_token":"token-$clientId","scope":"openid","token_type":"Bearer","expires_in":300}"""
                .getBytes(StandardCharsets.UTF_8)
            exchange.getResponseHeaders.add("Content-Type", "application/json")
            exchange.sendResponseHeaders(200, body.length)
            exchange.getResponseBody.write(body)
            exchange.close()
        )
        server.start()
        server
    )(server => ZIO.succeed(server.stop(0)))
      .map(server => s"http://localhost:${server.getAddress.getPort}")

  private def flow(ssoBaseUrl: String, clientId: String) =
    PasswordGrantFlow(
      OAuthConfig.PasswordGrant("r", ssoBaseUrl, clientId, "secret", "openid", "techuser", "pw")
    )

  def spec = suite("PasswordGrantFlow")(
    test("background refresh works for two clients with the same user") {
      for
        ssoBaseUrl <- keycloak
        flowA       = flow(ssoBaseUrl, "client-a")
        flowB       = flow(ssoBaseUrl, "client-b")
        _          <- ZIO.attempt(flowA.startBackgroundRefresh())
        // before: same refresher key (identity provider + user) - B's refresher never started
        _          <- ZIO.attempt(flowB.startBackgroundRefresh())
        tokens     <- (ZIO.sleep(100.millis) *> ZIO.succeed((flowA.cachedToken, flowB.cachedToken)))
                        .repeatUntil((a, b) => a.isDefined && b.isDefined)
                        .timeout(10.seconds)
        _          <- ZIO.succeed:
                        flowA.stopBackgroundRefresh()
                        flowB.stopBackgroundRefresh()
      yield assertTrue(tokens.contains((Some("token-client-a"), Some("token-client-b"))))
    }
  ) @@ TestAspect.withLiveClock
end PasswordGrantFlowSpec
