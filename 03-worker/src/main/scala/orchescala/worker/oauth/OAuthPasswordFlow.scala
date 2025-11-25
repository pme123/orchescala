package orchescala.worker.oauth

import orchescala.domain.{InOutDecoder, OrchescalaLogger}
import orchescala.worker.*
import orchescala.worker.WorkerError.ServiceAuthError
import sttp.client3.*
import zio.ZIO

trait OAuthPasswordFlow:
  def fssoRealm: String
  def fssoBaseUrl: String

  def identityUrl =
    uri"$fssoBaseUrl/realms/$fssoRealm/protocol/openid-connect/token"

  final lazy val grant_type_client_credentials = "client_credentials"
  final lazy val grant_type_impersonate        = "urn:ietf:params:oauth:grant-type:token-exchange"
  final lazy val grant_type_password           = "password"

  def client_id: String
  def client_secret: String
  def scope: String
  // Grant Type password
  def username: String
  def password: String

  def tokenService = TokenService(
    identityUrl,
    tokenRequestBody,
    clientCredentialsTokenRequestBody,
    impersonateTokenRequestBody
  )

  def adminToken(tokenKey: String = username)(using
      logger: OrchescalaLogger
  ): Either[ServiceAuthError, String] =
    TokenCache.cache.getIfPresent(tokenKey)
      .map: token =>
        logger.debug(s"Admin Token from Cache: $tokenKey")
        Right(token)
      .getOrElse:
        tokenService.adminToken()
          .map: token =>
            logger.info(
              s"Added Admin Token to Cache self acquired: $username - ${token.take(20)}...${token.takeRight(10)}"
            )
            TokenCache.cache.put(username, token)
            token

  def adminTokenZio(tokenKey: String = username)(using
      logger: OrchescalaLogger
  ): ZIO[SttpClientBackend, ServiceAuthError, String] =
    ZIO.fromOption(TokenCache.cache.getIfPresent(tokenKey))
      .zipLeft(ZIO.logDebug(s"Admin Token from Cache: $tokenKey"))
      .orElse:
        tokenService.adminTokenZio()
          .tap: token =>
            ZIO.logInfo(
              s"Added Admin Token to Cache: $username - ${token.take(20)}...${token.takeRight(10)}"
            ).as(TokenCache.cache.put(username, token))

  def clientCredentialsTokenZio(): ZIO[SttpClientBackend, ServiceAuthError, String] =
    ZIO.fromOption(TokenCache.cache.getIfPresent("clientCredentialsToken"))
      .zipLeft(ZIO.logDebug(s"Admin Token from Cache: clientCredentialsToken"))
      .orElse:
        tokenService.clientCredentialsTokenZio()
          .tap: token =>
            ZIO.logInfo(
              s"Added Admin Token to Cacheself acquired: $client_id - ${token.take(20)}...${token.takeRight(10)}"
            ).as(TokenCache.cache.put("clientCredentials", token))

  def impersonateToken(username: String, adminToken: String): IO[ServiceAuthError, String] =
    ZIO.fromOption(TokenCache.cache.getIfPresent(username))
      .zipLeft(ZIO.logInfo(s"Token from Cache: $username"))
      .orElse:
        tokenService.impersonateToken(username, adminToken)
          .tap: token =>
            ZIO.succeed(TokenCache.cache.put(username, token)) *>
              ZIO.logInfo(
                s"Added Token to Cache self acquired: $username - ${token.take(20)}...${token.takeRight(10)}"
              )

  lazy val tokenRequestBody = Map(
    "grant_type"    -> grant_type_password,
    "client_id"     -> client_id,
    "client_secret" -> client_secret,
    "scope"         -> scope,
    "username"      -> username,
    "password"      -> password
  )

  lazy val clientCredentialsTokenRequestBody = Map(
    "grant_type"    -> grant_type_client_credentials,
    "client_id"     -> client_id,
    "client_secret" -> client_secret,
    "scope"         -> scope
  )

  lazy val impersonateTokenRequestBody = Map(
    "grant_type"    -> grant_type_impersonate,
    "client_id"     -> client_id,
    "client_secret" -> client_secret,
    "scope"         -> scope
    // "subject_token" -> adminToken,
    // "requested_subject" -> username
  )

end OAuthPasswordFlow

case class TokenResponse(
    access_token: String,
    scope: String,
    token_type: String,
    refresh_token: Option[String]
)
given InOutDecoder[TokenResponse] = deriveDecoder
