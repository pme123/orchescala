package orchescala.gateway

import com.auth0.jwt.JWT
import orchescala.worker.IdentityCorrelation
import zio.{IO, ZIO}
import scala.jdk.CollectionConverters.*

case class GatewayConfig(
    port: Int = 8888,
    impersonateProcessKey: Option[String] = None,
    validateToken: String => IO[GatewayError, String] = GatewayConfig.defaultTokenValidator,
    extractCorrelation: String => IO[GatewayError, IdentityCorrelation] =
      GatewayConfig.defaultExtractCorrelation
)

object GatewayConfig:
  def default = GatewayConfig()

  /** Default token validator - validates that token is not empty and returns the token. Override
    * this with your own validation logic (e.g., JWT validation, database lookup, etc.)
    */
  def defaultTokenValidator(token: String): IO[GatewayError, String] =
    if token.nonEmpty then
      ZIO.succeed(token)
    else
      ZIO.fail(GatewayError.TokenValidationError(
        errorMsg = "Invalid or missing authentication token"
      ))

  def defaultExtractCorrelation(token: String) =
    (for
      decoded <- ZIO.attempt(JWT.decode(token))
      claims  <- ZIO.attempt(decoded.getClaims.asScala)
      payload <- ZIO.attempt(new String(java.util.Base64.getDecoder.decode(decoded.getPayload)))
      _       <- ZIO.logInfo(s"Payload: $payload")
      _       <- ZIO.logInfo(s"Claims: ${claims}")
    yield IdentityCorrelation(
      username = claims.get("preferred_username").map(_.asString()).mkString,
      secret = claims.get("secret").map(_.asString()).mkString,
      email = claims.get("email").map(_.asString()),
      impersonateProcessValue = None
    ))
      .mapError(ex =>
        GatewayError.TokenExtractionError(
          s"Problem extracting correlation from Token: ${ex.getMessage}"
        )
      )

end GatewayConfig
