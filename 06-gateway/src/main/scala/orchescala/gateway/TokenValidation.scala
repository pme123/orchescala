package orchescala.gateway

import com.auth0.jwt.JWT
import com.auth0.jwt.algorithms.Algorithm
import com.auth0.jwt.interfaces.DecodedJWT
import io.circe.parser
import orchescala.engine.rest.{HttpClientProvider, SttpClientBackend}
import sttp.client3.*
import zio.*

import java.math.BigInteger
import java.security.KeyFactory
import java.security.interfaces.RSAPublicKey
import java.security.spec.RSAPublicKeySpec
import java.util.Base64
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/** How the gateway validates the Bearer token of a request.
  *
  *   - [[TokenValidation.PresenceOnly]]: only checks that a token is there. The claims (user name,
  *     email) are NOT verified - but the gateway signs them into the `IdentityCorrelation` of the
  *     process. Only acceptable if every engine rejects invalid tokens itself.
  *   - [[TokenValidation.Jwt]]: verifies the JWT - signature against the issuer's JWKS, expiry
  *     (`exp`, `nbf`), issuer and (optionally) audience.
  */
sealed trait TokenValidation

object TokenValidation:

  case object PresenceOnly extends TokenValidation

  /** @param issuer
    *   the expected `iss` claim, e.g. `https://sso.example.com/auth/realms/my-realm` - exactly as
    *   in the tokens (Keycloak takes it from its frontend URL)
    * @param jwksUrl
    *   where to get the signing keys - e.g. an internal URL when the gateway cannot reach the
    *   public issuer URL. Default: Keycloak's `{issuer}/protocol/openid-connect/certs`.
    * @param audience
    *   if set, the token's `aud` must contain one of them
    * @param algorithms
    *   accepted signature algorithms (only RSA: RS256, RS384, RS512)
    * @param leewaySeconds
    *   tolerated clock skew for `exp` / `nbf` / `iat`
    */
  case class Jwt(
      issuer: String,
      jwksUrl: Option[String] = None,
      audience: Seq[String] = Seq.empty,
      algorithms: Set[String] = Set("RS256"),
      leewaySeconds: Long = 30
  ) extends TokenValidation:
    lazy val keysUrl: String =
      jwksUrl.getOrElse(s"${issuer.stripSuffix("/")}/protocol/openid-connect/certs")

  /** Keycloak realm: issuer `{ssoBaseUrl}/realms/{realm}`, keys from its `certs` endpoint. */
  def keycloak(ssoBaseUrl: String, realm: String, audience: Seq[String] = Seq.empty): Jwt =
    Jwt(issuer = s"${ssoBaseUrl.stripSuffix("/")}/realms/$realm", audience = audience)

end TokenValidation

/** Verifies JWTs according to a [[TokenValidation.Jwt]] configuration.
  *
  * The signing keys are fetched from the JWKS endpoint and cached. An unknown key id (Keycloak key
  * rotation) triggers a refetch - at most once per `minRefetchInterval`, so tokens with made-up
  * key ids cannot flood the identity provider.
  */
final class JwtValidator(
    config: TokenValidation.Jwt,
    backend: => SttpClientBackend = HttpClientProvider.cachedBackend,
    keysTtl: Duration = 10.minutes,
    minRefetchInterval: Duration = 30.seconds
):
  import JwtValidator.*

  // key id -> key, and when they were fetched (epoch millis)
  private val cache       = AtomicReference[(Map[String, RSAPublicKey], Long)]((Map.empty, 0L))
  private val refetchLock = Unsafe.unsafe(implicit unsafe => Semaphore.unsafe.make(1))

  /** The verified token - or a [[GatewayError.TokenValidationError]] (answered with 401). */
  def validate(token: String): IO[GatewayError, DecodedJWT] =
    for
      decoded   <- ZIO.attempt(JWT.decode(token)).orElseFail(invalid("the token is not a JWT"))
      algorithm <- ZIO
                     .succeed(decoded.getAlgorithm)
                     .filterOrFail(config.algorithms.contains)(
                       invalid(s"signature algorithm '${decoded.getAlgorithm}' is not accepted")
                     )
      key       <- publicKey(Option(decoded.getKeyId))
      verified  <- ZIO
                     .attempt(verifier(algorithm, key).verify(decoded))
                     .mapError(ex => invalid(ex.getMessage))
    yield verified

  private def verifier(algorithm: String, key: RSAPublicKey) =
    val alg = algorithm match
      case "RS384" => Algorithm.RSA384(key, null)
      case "RS512" => Algorithm.RSA512(key, null)
      case _       => Algorithm.RSA256(key, null)
    val withIssuer = JWT.require(alg).withIssuer(config.issuer).acceptLeeway(config.leewaySeconds)
    (if config.audience.isEmpty then withIssuer
     else withIssuer.withAnyOfAudience(config.audience*)).build()
  end verifier

  private def publicKey(keyId: Option[String]): IO[GatewayError, RSAPublicKey] =
    def lookup(keys: Map[String, RSAPublicKey]): Option[RSAPublicKey] =
      keyId match
        case Some(kid) => keys.get(kid)
        case None      => Option.when(keys.size == 1)(keys.values.head) // no kid: only if unambiguous

    Clock.currentTime(TimeUnit.MILLISECONDS).flatMap: now =>
      val (keys, fetchedAt) = cache.get
      lookup(keys).filter(_ => now - fetchedAt < keysTtl.toMillis) match
        case Some(key) => ZIO.succeed(key)
        case None      =>
          refetchLock.withPermit:
            val (keys, fetchedAt) = cache.get // another fiber may just have fetched
            val refetch           =
              if now - fetchedAt < minRefetchInterval.toMillis then ZIO.succeed(keys)
              else fetchKeys.tap(fresh => ZIO.succeed(cache.set(fresh -> now)))
            refetch
              .catchAll: err =>
                // identity provider down: keep verifying with the keys we have
                ZIO.logWarning(s"${err.errorMsg} - using the cached keys").as(keys)
              .flatMap: keys =>
                ZIO.fromOption(lookup(keys)).orElseFail(
                  invalid(s"no signing key '${keyId.getOrElse("-")}' at ${config.keysUrl}")
                )
  end publicKey

  private lazy val fetchKeys: IO[GatewayError, Map[String, RSAPublicKey]] =
    (for
      uri      <- ZIO.fromEither(sttp.model.Uri.parse(config.keysUrl))
      response <- basicRequest
                    .get(uri)
                    .readTimeout(scala.concurrent.duration.Duration(10, TimeUnit.SECONDS))
                    .response(asStringAlways)
                    .send(backend)
      body     <- if response.code.isSuccess then ZIO.succeed(response.body)
                  else ZIO.fail(s"status ${response.code.code}")
      keys     <- ZIO.fromEither(parseJwks(body))
      _        <- ZIO.logInfo(s"Loaded ${keys.size} JWT signing key(s) from ${config.keysUrl}")
    yield keys)
      .mapError(err =>
        GatewayError.TokenValidationError(s"Could not load the JWT signing keys from ${config.keysUrl}: $err")
      )

end JwtValidator

object JwtValidator:

  private def invalid(reason: String): GatewayError =
    GatewayError.TokenValidationError(s"Invalid token: $reason")

  /** The RSA signature keys of a JWKS document (`{"keys":[{"kid","kty","n","e",...}]}`). */
  private[gateway] def parseJwks(json: String): Either[String, Map[String, RSAPublicKey]] =
    parser.parse(json).left.map(_.message).flatMap: doc =>
      doc.hcursor.downField("keys").values.toRight("no 'keys' in JWKS").map: keys =>
        keys.toSeq.flatMap: key =>
          val c = key.hcursor
          for
            kid <- c.get[String]("kid").toOption
            if c.get[String]("kty").toOption.contains("RSA")
            if !c.get[String]("use").toOption.contains("enc") // encryption keys never sign
            n   <- c.get[String]("n").toOption
            e   <- c.get[String]("e").toOption
            key <- scala.util.Try(rsaKey(n, e)).toOption // skip malformed keys
          yield kid -> key
        .toMap

  private def rsaKey(modulus: String, exponent: String): RSAPublicKey =
    def unsigned(b64: String) = BigInteger(1, Base64.getUrlDecoder.decode(b64))
    KeyFactory
      .getInstance("RSA")
      .generatePublic(RSAPublicKeySpec(unsigned(modulus), unsigned(exponent)))
      .asInstanceOf[RSAPublicKey]

end JwtValidator
