package orchescala.engine.rest

import orchescala.domain.OrchescalaLogger
import orchescala.engine.domain.EngineError.ServiceError
import sttp.client3.*
import sttp.client3.circe.asJson
import zio.ZIO

trait PasswordGrantFlowable extends OAuth2Flow:
  def config: OAuthConfig.PasswordGrant
  def retrieveTokenSync()(using logger: OrchescalaLogger): Either[ServiceError, String]
  def retrieveToken(): ZIO[SttpClientBackend, ServiceError, String]
  
class PasswordGrantFlow(val config: OAuthConfig.PasswordGrant) extends PasswordGrantFlowable:

  def retrieveTokenSync()(using logger: OrchescalaLogger): Either[ServiceError, String] =
    TokenCache.cache.getIfPresent(username)
      .map: token =>
        logger.debug(s"Admin Token from Cache: $username")
        Right(token)
      .getOrElse:
        authResponse
          .body
          .map(t => t.access_token)
          .left
          .map(err =>
            ServiceError(
              s"Could not get a token for '$username'!\n$err"
            )
          )
          .map: token =>
            logger.info(
              s"Added Admin Token to Cache self acquired: $username - ${token.take(5)}...${token.takeRight(5)}"
            )
            TokenCache.cache.put(username, token)
            token

  def retrieveToken(): ZIO[SttpClientBackend, ServiceError, String] =
    ZIO.fromOption(TokenCache.cache.getIfPresent(username))
      .zipLeft(ZIO.logDebug(s"Admin Token from Cache: $username"))
      .orElse:
        ZIO.serviceWithZIO[SttpClientBackend]: backend =>
          ZIO.logDebug(s"PasswordGrantFlow: Requesting Token for: ${config.toString}") *>
            tokenRequest.body(requestBody)
              .response(asJson[TokenResponse])
              .send(backend)
              .map(_.body.map(t => t.access_token))
              .flatMap(ZIO.fromEither)
              .mapError(err =>
                ServiceError(
                  s"Could not get a token for '$username'!\n$err"
                )
              )
              .tap: token =>
                ZIO.logInfo(
                  s"Added Admin Token to Cache: $username - ${token.take(5)}...${token.takeRight(5)}"
                ).as(TokenCache.cache.put(username, token))

  protected def identityUrl    = config.identityUrl
  private lazy val username    = config.username
  private lazy val requestBody = config.asMap

  private def authResponse =
    tokenRequest.body(requestBody).response(asJson[TokenResponse]).send(syncBackend)

end PasswordGrantFlow
