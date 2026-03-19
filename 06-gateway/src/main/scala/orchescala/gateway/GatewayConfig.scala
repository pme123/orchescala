package orchescala.gateway

import com.auth0.jwt.JWT
import orchescala.domain.*
import orchescala.engine.{DefaultEngineConfig, EngineConfig, EnvironmentDetector}
import orchescala.worker.{DefaultWorkerConfig, WorkerConfig}
import zio.{IO, ZIO}

import scala.jdk.CollectionConverters.*

/** Authentication configuration for the API documentation endpoints (`/docs`).
  *
  * Choose one of:
  *   - [[DocsAuth.Disabled]] – no authentication (default)
  *   - [[DocsAuth.BasicAuth]] – HTTP Basic Authentication
  *   - [[DocsAuth.OAuth2AuthCode]] – OAuth 2.0 Authorization Code Grant
  */
sealed trait DocsAuth
object DocsAuth:
  /** No authentication required. */
  case object Disabled extends DocsAuth

  /** HTTP Basic Authentication.
    *
    * The browser will display a native credential dialog.
    */
  case class BasicAuth(
      username: String,
      password: String
  ) extends DocsAuth

  /** OAuth 2.0 Authorization Code Grant (Keycloak).
    *
    * The gateway handles the callback at `/docs/oauth2/callback` to exchange the
    * authorization code for an access token, which is stored in a secure HTTP-only cookie.
    * After a successful exchange the user is redirected to the clean `/docs` page.
    *
    * The `redirect_uri` (`http(s)://<gateway-host>/docs/oauth2/callback`) is derived
    * automatically from each incoming request's `Host` header and does not need to be
    * configured. Register it as a valid redirect URI in Keycloak.
    *
    * The Keycloak endpoints are derived from `ssoBaseUrl` and `realm`:
    *   - authorization: `{ssoBaseUrl}/realms/{realm}/protocol/openid-connect/auth`
    *   - token:         `{ssoBaseUrl}/realms/{realm}/protocol/openid-connect/token`
    *
    * Example:
    * {{{
    * lazy val ssoBaseUrl =
    *   (sys.env.getOrElse("FSSO_BASE_URL", "http://host.lima.internal:8090") + "/auth")
    *     .replace("/auth/auth", "/auth")
    *
    * DocsAuth.OAuth2AuthCode(
    *   ssoBaseUrl   = ssoBaseUrl,
    *   realm        = "my-realm",
    *   clientId     = "my-client",
    *   clientSecret = "my-secret"
    * )
    * }}}
    *
    * @param ssoBaseUrl
    *   Base URL of the Keycloak instance, e.g. `http://host.lima.internal:8090/auth`.
    * @param realm
    *   Keycloak realm name.
    * @param clientId
    *   OAuth 2.0 client identifier registered in Keycloak.
    * @param clientSecret
    *   OAuth 2.0 client secret.
    * @param scopes
    *   Space-separated OAuth scopes, e.g. `"openid profile"`.
    */
  case class OAuth2AuthCode(
      ssoBaseUrl: String,
      realm: String,
      clientId: String,
      clientSecret: String,
      scopes: String = "openid profile"
  ) extends DocsAuth:
    private val base: String        = ssoBaseUrl.stripSuffix("/")
    def authorizationUrl: String    = s"$base/realms/$realm/protocol/openid-connect/auth"
    def tokenUrl: String            = s"$base/realms/$realm/protocol/openid-connect/token"

end DocsAuth

trait GatewayConfig:
  def engineConfig: EngineConfig
  def workerConfig: WorkerConfig
  def gatewayPort: Int
  def validateToken(token: String): IO[GatewayError, String]
  def extractCorrelation(
      token: String,
      in: JsonObject
  ): IO[GatewayError, IdentityCorrelation]

  /** Resolves the base URL of a worker app by project name, used for forwarding docs requests.
    * Returns None if the project docs are not available remotely.
    */
  def docsAppUrl: (projectName: String) => Option[String]

  /** Authentication scheme for the `/docs` routes. Defaults to [[DocsAuth.Disabled]]. */
  def docsAuth: DocsAuth = DocsAuth.Disabled

end GatewayConfig

case class DefaultGatewayConfig(
    engineConfig: EngineConfig,
    workerConfig: WorkerConfig,
    impersonateProcessKey: Option[String] = None,
    gatewayPort: Int = 8888,
    docsAppUrl: (projectName: String) => Option[String] = projectName =>
      Some(
        s"http://${
            if EnvironmentDetector.isLocalhost then "localhost"
            else projectName
          }:5555"
      ),
    override val docsAuth: DocsAuth = DocsAuth.Disabled
) extends GatewayConfig:

  /** Default token validator - validates that token is not empty and returns the token. Override
    * this with your down validation logic (e.g., JWT validation, database lookup, etc.)
    */
  def validateToken(token: String): IO[GatewayError, String] =
    if token.nonEmpty then
      ZIO.logInfo("Token is valid")
        .as(token)
    else
      ZIO.logError("Token is empty!") *>
        ZIO.fail(GatewayError.TokenValidationError(
        errorMsg = "Invalid or missing authentication token"
      ))

  def extractCorrelation(
      token: String,
      in: JsonObject
  ): ZIO[Any, GatewayError.TokenExtractionError, IdentityCorrelation] =
    (for
      decoded <- ZIO.attempt(JWT.decode(token))
      claims  <- ZIO.attempt(decoded.getClaims.asScala)
      payload <- ZIO.attempt(new String(java.util.Base64.getDecoder.decode(decoded.getPayload)))
      _       <- ZIO.logDebug(s"Payload: $payload")
      _       <- ZIO.logDebug(s"Claims: ${claims}")
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
