package orchescala.gateway

import com.auth0.jwt.JWT
import orchescala.domain.*
import zio.{IO, ZIO}

import scala.jdk.CollectionConverters.*

trait GatewayConfig:
  def port: Int
  def impersonateProcessKey: Option[String]
  def validateToken(token: String): IO[GatewayError, String]
  def extractCorrelation(
      token: String,
      in: JsonObject,
  ): IO[GatewayError, IdentityCorrelation]
end GatewayConfig

case class DefaultGatewayConfig(
    port: Int = 8888,
    impersonateProcessKey: Option[String] = None
) extends GatewayConfig:

  /** Default token validator - validates that token is not empty and returns the token. Override
    * this with your own validation logic (e.g., JWT validation, database lookup, etc.)
    */
  def validateToken(token: String): IO[GatewayError, String] =
    if token.nonEmpty then
      ZIO.succeed(token)
    else
      ZIO.fail(GatewayError.TokenValidationError(
        errorMsg = "Invalid or missing authentication token"
      ))

  def extractCorrelation(
      token: String,
      in: JsonObject,
  ): ZIO[Any, GatewayError.TokenExtractionError, IdentityCorrelation] =
    (for
      decoded <- ZIO.attempt(JWT.decode(token))
      claims  <- ZIO.attempt(decoded.getClaims.asScala)
      payload <- ZIO.attempt(new String(java.util.Base64.getDecoder.decode(decoded.getPayload)))
      _       <- ZIO.logInfo(s"Payload: $payload")
      _       <- ZIO.logInfo(s"Claims: ${claims}")
    yield IdentityCorrelation(
      username = claims.get("preferred_username").map(_.asString()).mkString,
      email = claims.get("email").map(_.asString()),
      impersonateProcessValue = impersonateProcessKey
        .flatMap(in.toMap.get)
        .flatMap: v =>
          v.asString
            .orElse(v.asNumber.map(_.toString))
    ))
      .mapError(ex =>
        GatewayError.TokenExtractionError(
          s"Problem extracting correlation from Token: ${ex.getMessage}"
        )
      )
end DefaultGatewayConfig

object GatewayConfig:
  def default = DefaultGatewayConfig()

end GatewayConfig
