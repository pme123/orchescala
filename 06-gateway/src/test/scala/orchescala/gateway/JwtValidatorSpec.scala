package orchescala.gateway

import com.auth0.jwt.JWT
import com.auth0.jwt.algorithms.Algorithm
import orchescala.engine.rest.SttpClientBackend
import sttp.client3.*
import sttp.client3.asynchttpclient.zio.AsyncHttpClientZioBackend
import sttp.model.StatusCode
import zio.*
import zio.test.*

import java.security.KeyPairGenerator
import java.security.interfaces.{RSAPrivateKey, RSAPublicKey}
import java.time.Instant
import java.util.Base64
import java.util.concurrent.atomic.AtomicInteger

object JwtValidatorSpec extends ZIOSpecDefault:

  private val issuer = "https://sso.example.com/auth/realms/test"

  private def keyPair() =
    val generator = KeyPairGenerator.getInstance("RSA")
    generator.initialize(2048)
    val pair      = generator.generateKeyPair()
    pair.getPublic.asInstanceOf[RSAPublicKey] -> pair.getPrivate.asInstanceOf[RSAPrivateKey]

  private val (publicKey, privateKey) = keyPair()
  private val (_, otherPrivateKey)    = keyPair()

  private def b64(bytes: Array[Byte]) =
    Base64.getUrlEncoder.withoutPadding.encodeToString(
      if bytes.head == 0 then bytes.tail else bytes // unsigned big-endian, as in a JWKS
    )

  private def jwks(kid: String) =
    s"""{"keys":[
       |  {"kid":"enc-key","kty":"RSA","use":"enc","n":"${b64(publicKey.getModulus.toByteArray)}","e":"AQAB"},
       |  {"kid":"$kid","kty":"RSA","use":"sig","alg":"RS256",
       |   "n":"${b64(publicKey.getModulus.toByteArray)}","e":"${b64(publicKey.getPublicExponent.toByteArray)}"}
       |]}""".stripMargin

  /** Serves the JWKS (or fails with `status`) and counts the fetches. */
  private final class IdentityProvider(kid: String = "key-1", status: Int = 200):
    val fetches = AtomicInteger(0)

    val backend: SttpClientBackend =
      AsyncHttpClientZioBackend.stub
        .whenAnyRequest
        .thenRespondF: _ =>
          fetches.incrementAndGet()
          ZIO.succeed(Response(jwks(kid), StatusCode(status)))

    def validator(config: TokenValidation.Jwt = TokenValidation.Jwt(issuer)): JwtValidator =
      JwtValidator(config, backend)
  end IdentityProvider

  private def token(
      kid: String = "key-1",
      iss: String = issuer,
      audience: Seq[String] = Seq("gateway"),
      expiresAt: Instant = Instant.now().plusSeconds(300),
      algorithm: Algorithm = Algorithm.RSA256(null, privateKey)
  ): String =
    JWT.create()
      .withKeyId(kid)
      .withIssuer(iss)
      .withAudience(audience*)
      .withClaim("preferred_username", "alice")
      .withExpiresAt(expiresAt)
      .sign(algorithm)

  private def rejected(result: Exit[GatewayError, ?], reason: String) =
    result match
      case Exit.Failure(cause) =>
        cause.failureOption.exists:
          case GatewayError.TokenValidationError(msg) => msg.toLowerCase.contains(reason.toLowerCase)
          case _                                     => false
      case _                   => false

  def spec = suite("JwtValidator")(
    test("accepts a token signed with a key of the issuer") {
      val idp = IdentityProvider()
      for jwt <- idp.validator().validate(token())
      yield assertTrue(jwt.getClaim("preferred_username").asString == "alice", idp.fetches.get == 1)
    },
    test("keys are cached - one JWKS fetch for many tokens") {
      val idp       = IdentityProvider()
      val validator = idp.validator()
      for _ <- ZIO.foreachDiscard(1 to 10)(_ => validator.validate(token()))
      yield assertTrue(idp.fetches.get == 1)
    },
    test("rejects forged and invalid tokens") {
      val idp       = IdentityProvider()
      val validator = idp.validator()
      val header    = b64("""{"alg":"none","typ":"JWT","kid":"key-1"}""".getBytes)
      val payload   = b64(s"""{"iss":"$issuer","preferred_username":"admin"}""".getBytes)
      for
        otherKey    <- validator.validate(token(algorithm = Algorithm.RSA256(null, otherPrivateKey))).exit
        algNone     <- validator.validate(s"$header.$payload.").exit
        // "algorithm confusion": HMAC with the (public!) RSA key as secret
        hmac        <- validator.validate(token(algorithm = Algorithm.HMAC256(publicKey.getEncoded))).exit
        wrongIssuer <- validator.validate(token(iss = "https://evil.example.com/realms/test")).exit
        expired     <- validator.validate(token(expiresAt = Instant.now().minusSeconds(120))).exit
        notAJwt     <- validator.validate("just-a-string").exit
      yield assertTrue(
        rejected(otherKey, "signature"),
        rejected(algNone, "'none' is not accepted"),
        rejected(hmac, "'HS256' is not accepted"),
        rejected(wrongIssuer, "iss"),
        rejected(expired, "expired"),
        rejected(notAJwt, "not a JWT")
      )
    },
    test("checks the audience if configured") {
      val idp       = IdentityProvider()
      val validator = idp.validator(TokenValidation.Jwt(issuer, audience = Seq("gateway")))
      for
        ok    <- validator.validate(token(audience = Seq("account", "gateway"))).exit
        wrong <- validator.validate(token(audience = Seq("account"))).exit
      yield assertTrue(ok.isSuccess, rejected(wrong, "aud"))
    },
    test("an unknown key id refetches the keys - at most once per interval") {
      val idp       = IdentityProvider(kid = "key-2") // rotated
      val validator = idp.validator()
      for
        first  <- validator.validate(token(kid = "key-2")).exit // first fetch
        _      <- validator.validate(token(kid = "made-up-1")).exit
        _      <- validator.validate(token(kid = "made-up-2")).exit
      yield assertTrue(first.isSuccess, idp.fetches.get == 1)
    },
    test("identity provider down: token rejected, no defect") {
      val idp = IdentityProvider(status = 503)
      for result <- idp.validator().validate(token()).exit
      yield assertTrue(rejected(result, "no signing key"))
    },
    test("DefaultGatewayConfig answers a rejected token with 401") {
      val config = DefaultGatewayConfig(
        engineConfig = orchescala.engine.DefaultEngineConfig(),
        workerConfig = orchescala.worker.DefaultWorkerConfig(orchescala.engine.DefaultEngineConfig()),
        tokenValidation = TokenValidation.Jwt(issuer, jwksUrl = Some("http://unreachable.invalid/certs"))
      )
      for
        blank   <- config.validateToken("").exit
        invalid <- config.validateToken("just-a-string").exit
      yield assertTrue(
        blank.causeOption.flatMap(_.failureOption).map(GatewayError.ServiceRequestError(_).errorCode)
          .contains(401),
        invalid.causeOption.flatMap(_.failureOption).map(GatewayError.ServiceRequestError(_).errorCode)
          .contains(401)
      )
    }
  ) @@ TestAspect.withLiveClock
end JwtValidatorSpec
