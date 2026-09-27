package orchescala.engine.rest

import orchescala.engine.domain.EngineError.ServiceError
import sttp.client3.*
import sttp.client3.circe.asJson
import zio.ZIO

trait ClientCredentialsFlowable extends OAuth2Flow:
  def config: OAuthConfig.ClientCredentials
  def clientCredentialsToken(): ZIO[SttpClientBackend, ServiceError, String]

class ClientCredentialsFlow(val config: OAuthConfig.ClientCredentials) extends ClientCredentialsFlowable:

  def clientCredentialsToken(): ZIO[SttpClientBackend, ServiceError, String] =
    ZIO.fromOption(TokenCache.get(cacheKey))
      .zipLeft(ZIO.logDebug(s"Admin Token from Cache: clientCredentialsToken"))
      .orElse:
        ZIO.serviceWithZIO[SttpClientBackend]: backend =>
          ZIO.logDebug(s"ClientCredentialsFlow: Requesting Token for: ${config.toString}") *>
            tokenRequest.body(requestBody)
              .response(asJson[TokenResponse])
              .send(backend)
              .map(_.body)
              .flatMap(ZIO.fromEither)
              .mapError: err =>
                ServiceError(
                  s"Could not get a token for '${requestBody("client_id")}' -> ClientCredentials!\n$err"
                )
              .map: tokenResponse =>
                TokenCache.put(
                  cacheKey,
                  tokenResponse.access_token,
                  tokenResponse.expires_in
                )
                tokenResponse.access_token
              .tap: token =>
                ZIO.logInfo(
                  s"Added Admin Token to Cache self acquired: ${config.client_id} - ${TokenFingerprint(token)}"
                )

  protected def identityUrl    = config.identityUrl
  // one token per identity provider and client - a single global key handed the token of one
  // client to another (e.g. the engine client's to the simulation's worker app login)
  private[engine] lazy val cacheKey = s"clientCredentials|$identityUrl|${config.client_id}"
  private lazy val requestBody = config.asMap

end ClientCredentialsFlow
