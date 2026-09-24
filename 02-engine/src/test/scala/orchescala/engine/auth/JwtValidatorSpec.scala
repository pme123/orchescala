package orchescala.engine.auth

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

  private def jwksOf(kid: String, key: RSAPublicKey) =
    s"""{"keys":[{"kid":"$kid","kty":"RSA","use":"sig",
       |  "n":"${b64(key.getModulus.toByteArray)}","e":"${b64(key.getPublicExponent.toByteArray)}"}]}""".stripMargin

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

  private def rejected(result: Exit[String, ?], reason: String) =
    result match
      case Exit.Failure(cause) =>
        cause.failureOption.exists(_.toLowerCase.contains(reason.toLowerCase))
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
    suite("AnyOf - several identity providers (e.g. one Keycloak for C7, another for C8)")(
      test("accepts the tokens of every configured issuer, rejects all others") {
        val (keyB, privateB) = keyPair()
        val issuerB          = "https://sso-c8.example.com/realms/c8"
        val fetched          = java.util.concurrent.ConcurrentLinkedQueue[String]()
        val backend: SttpClientBackend =
          AsyncHttpClientZioBackend.stub
            .whenAnyRequest
            .thenRespondF: request =>
              fetched.add(request.uri.toString)
              val body =
                if request.uri.host.contains("sso-c8.example.com") then jwksOf("kid-b", keyB)
                else jwksOf("key-1", publicKey)
              ZIO.succeed(Response(body, StatusCode.Ok))
        val verifier = TokenVerifier(
          TokenValidation.AnyOf(TokenValidation.Jwt(issuer), TokenValidation.Jwt(issuerB)),
          backend
        ).get
        val noIssuer = JWT.create().withKeyId("key-1").sign(Algorithm.RSA256(null, privateKey))
        for
          fromA        <- verifier.validate(token()).exit
          fromB        <- verifier.validate(
                            token(kid = "kid-b", iss = issuerB, algorithm = Algorithm.RSA256(null, privateB))
                          ).exit
          untrusted    <- verifier.validate(token(iss = "https://evil.example.com/realms/x")).exit
          // claims issuer A, but signed with B's key (with B's kid)
          mixed        <- verifier.validate(
                            token(kid = "kid-b", iss = issuer, algorithm = Algorithm.RSA256(null, privateB))
                          ).exit
          missingIss   <- verifier.validate(noIssuer).exit
        yield assertTrue(
          fromA.isSuccess,
          fromB.isSuccess,
          rejected(untrusted, "'https://evil.example.com/realms/x' is not trusted"),
          rejected(mixed, "no signing key 'kid-b'"),
          rejected(missingIss, "no issuer"),
          // keys only ever come from the configured URLs
          fetched.toArray.toSet == Set(
            s"$issuer/protocol/openid-connect/certs",
            s"$issuerB/protocol/openid-connect/certs"
          )
        )
      },
      test("the issuers must be distinct") {
        for exit <- ZIO.attempt(
                      TokenValidation.AnyOf(TokenValidation.Jwt(issuer), TokenValidation.Jwt(issuer))
                    ).exit
        yield assertTrue(exit.isFailure)
      }
    )
  ) @@ TestAspect.withLiveClock
end JwtValidatorSpec
