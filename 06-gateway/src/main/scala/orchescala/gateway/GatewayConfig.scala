package orchescala.gateway

import com.auth0.jwt.JWT
import orchescala.domain.*
import orchescala.engine.{DefaultEngineConfig, EngineConfig, EnvironmentDetector}
import orchescala.engine.rest.TokenFingerprint
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
    * After a successful exchange the user is redirected back to the originally requested
    * protected page (`/docs` or `/site`).
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
    * @param tokenValidation
    *   How the token in the docs cookie is verified - default `TokenValidation.keycloak(ssoBaseUrl,
    *   realm)`.
    */
  case class OAuth2AuthCode(
      ssoBaseUrl: String,
      realm: String,
      clientId: String,
      clientSecret: String,
      scopes: String = "openid profile",
      tokenValidation: Option[TokenValidation.Jwt | TokenValidation.AnyOf] = None
  ) extends DocsAuth:
    /** How the token in the docs cookie is verified - default: the Keycloak realm above. Set it if
      * the tokens' `iss` differs from `{ssoBaseUrl}/realms/{realm}` (e.g. a Keycloak frontend URL).
      */
    lazy val docsTokenValidation: TokenValidation =
      tokenValidation.getOrElse(TokenValidation.keycloak(ssoBaseUrl, realm))
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

  /** Resolves the base URL of the worker app that serves the UI bundle of a project
    * (`/app/{projectName}/` → `{baseUrl}/ui/`). Defaults to [[docsAppUrl]] - the same worker app.
    * Returns None if the project has no UI.
    */
  def uiAppUrl: (projectName: String) => Option[String] = docsAppUrl

  /** `Content-Security-Policy` header for the UI bundle (`/app/...`). None by default - the policy
    * depends on the app, e.g. the identity provider it talks to.
    */
  def uiContentSecurityPolicy: Option[String] = None

  /** The largest file of a UI bundle the gateway forwards (bytes) - a bigger answer is a 502.
    * Each forwarded file is held in memory while it is sent, so this bounds the heap per request.
    * Keep `WorkerConfig.uiMaxFileSize` of the worker apps at most this value.
    */
  def uiMaxFileSize: Long = orchescala.worker.UiRoutes.defaultMaxFileSize

  /** How many UI files the gateway forwards at the same time - each is held in memory while it is
    * sent, so the heap for UI files is at most `uiMaxConcurrentForwards × uiMaxFileSize` (default
    * 32 × 10 MB). Further requests wait. Bundle files are mostly far smaller than the limit.
    */
  def uiMaxConcurrentForwards: Int = 32

  /** Authentication scheme for the `/docs` routes. Defaults to [[DocsAuth.Disabled]]. */
  def docsAuth: DocsAuth = DocsAuth.Disabled

  /** How [[validateToken]] checks the Bearer token - reported at startup. */
  def tokenValidation: TokenValidation = TokenValidation.PresenceOnly

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
    override val docsAuth: DocsAuth = DocsAuth.Disabled,
    /** Use [[TokenValidation.Jwt]] (e.g. `TokenValidation.keycloak(ssoBaseUrl, realm)`) or
      * [[TokenValidation.AnyOf]] for several identity providers - with
      * [[TokenValidation.PresenceOnly]] the identity claims are not verified (warned at startup).
      */
    override val tokenValidation: TokenValidation = TokenValidation.PresenceOnly
) extends GatewayConfig:

  private lazy val tokenVerifier: Option[TokenVerifier] = TokenVerifier(tokenValidation)

  /** Validates the Bearer token according to [[tokenValidation]] and returns it. Override this for
    * other validation logic (e.g. token introspection, database lookup).
    */
  def validateToken(token: String): IO[GatewayError, String] =
    if token.isBlank then
      ZIO.logWarning("Request without authentication token") *>
        ZIO.fail(GatewayError.TokenValidationError(
          errorMsg = "Invalid or missing authentication token"
        ))
    else
      tokenVerifier
        .fold(ZIO.unit)(_.validate(token).unit)
        .tapError(reason => ZIO.logWarning(s"Rejected token ${TokenFingerprint(token)}: $reason"))
        .mapError(GatewayError.TokenValidationError(_))
        .as(token)

  def extractCorrelation(
      token: String,
      in: JsonObject
  ): ZIO[Any, GatewayError.TokenExtractionError, IdentityCorrelation] =
    (for
      decoded <- ZIO.attempt(JWT.decode(token))
      claims  <- ZIO.attempt(decoded.getClaims.asScala)
      // no payload / claims in the logs - they carry personal data (name, email, ...)
      _       <- ZIO.logDebug(s"IdentityCorrelation from token ${TokenFingerprint(token)}")
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
