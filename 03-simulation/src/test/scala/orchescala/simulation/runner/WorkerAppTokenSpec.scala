package orchescala.simulation.runner

import orchescala.engine.rest.{OAuthConfig, SttpClientBackend}
import sttp.client3.*
import sttp.client3.asynchttpclient.zio.AsyncHttpClientZioBackend
import sttp.model.StatusCode
import zio.*
import zio.test.*

import java.util.concurrent.ConcurrentLinkedQueue
import scala.jdk.CollectionConverters.*

object WorkerAppTokenSpec extends ZIOSpecDefault:

  /** Keycloak stub: the token is `<grant_type>-<client_id>`, every token request is recorded. */
  private final class Keycloak:
    val requests = ConcurrentLinkedQueue[String]()

    val layer: ULayer[SttpClientBackend] = ZLayer.succeed(
      AsyncHttpClientZioBackend.stub
        .whenAnyRequest
        .thenRespondF: request =>
          val form = request.body match
            case StringBody(s, _, _) => s
            case other               => other.toString
          requests.add(form)
          val params = form.split('&').map(_.split('=')).collect { case Array(k, v) => k -> v }.toMap
          val token  = s"${params("grant_type")}-${params("client_id")}"
          ZIO.succeed(Response(
            s"""{"access_token":"$token","scope":"openid","token_type":"Bearer","expires_in":300}""",
            StatusCode.Ok
          ))
    )
  end Keycloak

  private def clientCredentials(clientId: String) =
    OAuthConfig.ClientCredentials("realm", "http://sso", clientId, "secret", "openid")

  def spec = suite("WorkerAppToken")(
    test("without workerAppAuth: no real token (as before)") {
      val keycloak = Keycloak()
      for token <- WorkerAppToken(None).provideLayer(keycloak.layer)
      yield assertTrue(token == WorkerAppToken.noToken, keycloak.requests.isEmpty)
    },
    test("client credentials: token from Keycloak, cached") {
      val keycloak = Keycloak()
      val auth     = Some(clientCredentials("sim-client-1"))
      for
        first  <- WorkerAppToken(auth).provideLayer(keycloak.layer)
        second <- WorkerAppToken(auth).provideLayer(keycloak.layer)
      yield assertTrue(
        first == "client_credentials-sim-client-1",
        second == first,
        keycloak.requests.size == 1
      )
    },
    test("client credentials: each client gets its own token (no shared cache entry)") {
      val keycloak = Keycloak()
      for
        a <- WorkerAppToken(Some(clientCredentials("client-a"))).provideLayer(keycloak.layer)
        b <- WorkerAppToken(Some(clientCredentials("client-b"))).provideLayer(keycloak.layer)
      yield assertTrue(a == "client_credentials-client-a", b == "client_credentials-client-b")
    },
    test("password grant: token of the technical user") {
      val keycloak = Keycloak()
      val auth     = OAuthConfig.PasswordGrant("realm", "http://sso", "sim-client", "secret", "openid", "techuser-sim", "pw")
      for token <- WorkerAppToken(Some(auth)).provideLayer(keycloak.layer)
      yield assertTrue(
        token == "password-sim-client",
        keycloak.requests.asScala.exists(_.contains("username=techuser-sim"))
      )
    }
  )
end WorkerAppTokenSpec
