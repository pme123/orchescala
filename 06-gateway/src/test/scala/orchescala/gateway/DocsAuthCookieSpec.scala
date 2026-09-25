package orchescala.gateway

import com.auth0.jwt.JWT
import com.auth0.jwt.algorithms.Algorithm
import com.sun.net.httpserver.HttpServer
import orchescala.engine.DefaultEngineConfig
import orchescala.worker.DefaultWorkerConfig
import zio.*
import zio.http.*
import zio.test.*

import java.net.InetSocketAddress
import java.nio.charset.StandardCharsets
import java.security.KeyPairGenerator
import java.security.interfaces.{RSAPrivateKey, RSAPublicKey}
import java.time.Instant
import java.util.Base64

object DocsAuthCookieSpec extends ZIOSpecDefault:

  private val issuer = "https://sso.test/realms/r"

  private val (publicKey, privateKey) =
    val generator = KeyPairGenerator.getInstance("RSA")
    generator.initialize(2048)
    val pair      = generator.generateKeyPair()
    pair.getPublic.asInstanceOf[RSAPublicKey] -> pair.getPrivate.asInstanceOf[RSAPrivateKey]

  private def b64(bytes: Array[Byte]) =
    Base64.getUrlEncoder.withoutPadding.encodeToString(if bytes.head == 0 then bytes.tail else bytes)

  /** Keycloak's certs endpoint with the key the tokens are signed with. */
  private val jwksServer: ZIO[Scope, Throwable, String] =
    ZIO.acquireRelease(
      ZIO.attempt:
        val server = HttpServer.create(InetSocketAddress("localhost", 0), 0)
        server.createContext(
          "/certs",
          exchange =>
            val body =
              s"""{"keys":[{"kid":"k1","kty":"RSA","use":"sig","n":"${b64(publicKey.getModulus.toByteArray)}","e":"${b64(publicKey.getPublicExponent.toByteArray)}"}]}"""
                .getBytes(StandardCharsets.UTF_8)
            exchange.sendResponseHeaders(200, body.length)
            exchange.getResponseBody.write(body)
            exchange.close()
        )
        server.start()
        server
    )(server => ZIO.succeed(server.stop(0)))
      .map(server => s"http://localhost:${server.getAddress.getPort}/certs")

  private def token(expiresAt: Instant = Instant.now().plusSeconds(300)) =
    JWT.create().withKeyId("k1").withIssuer(issuer).withExpiresAt(expiresAt)
      .sign(Algorithm.RSA256(null, privateKey))

  private def docsRoutes(jwksUrl: String) =
    given GatewayConfig = DefaultGatewayConfig(
      engineConfig = DefaultEngineConfig(),
      workerConfig = DefaultWorkerConfig(DefaultEngineConfig()),
      docsAuth = DocsAuth.OAuth2AuthCode(
        ssoBaseUrl = "https://sso.test",
        realm = "r",
        clientId = "docs",
        clientSecret = "secret",
        tokenValidation = Some(TokenValidation.Jwt(issuer, jwksUrl = Some(jwksUrl)))
      )
    )
    OpenApiRoutes().routes

  private def getDocs(cookie: String) =
    Request.get(URL.decode("/docs").toOption.get).addHeader(Header.Cookie(
      NonEmptyChunk(Cookie.Request("orchescala_docs_token", cookie))
    ))

  private def isLoginRedirect(response: Response) =
    response.status == Status.Found &&
      response.header(Header.Location).exists(_.url.encode.contains("/protocol/openid-connect/auth"))

  def spec = suite("Docs login cookie")(
    test("a made-up cookie no longer opens the docs - it leads to the login") {
      for
        jwksUrl  <- jwksServer
        response <- docsRoutes(jwksUrl).runZIO(getDocs("x"))
      yield assertTrue(isLoginRedirect(response))
    },
    test("an expired token leads to the login") {
      for
        jwksUrl  <- jwksServer
        response <- docsRoutes(jwksUrl).runZIO(getDocs(token(Instant.now().minusSeconds(120))))
      yield assertTrue(isLoginRedirect(response))
    },
    test("a valid token of the realm opens the docs") {
      for
        jwksUrl  <- jwksServer
        response <- docsRoutes(jwksUrl).runZIO(getDocs(token()))
      yield assertTrue(!isLoginRedirect(response))
    }
  ) @@ TestAspect.withLiveClock
end DocsAuthCookieSpec
