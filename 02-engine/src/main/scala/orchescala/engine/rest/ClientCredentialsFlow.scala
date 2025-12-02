package orchescala.engine.rest

import orchescala.engine.domain.EngineError.ServiceError
import sttp.client3.*
import sttp.client3.circe.asJson
import zio.ZIO

class ClientCredentialsFlow(config: OAuthConfig.ClientCredentials) extends OAuth2Flow:

  def clientCredentialsToken(): ZIO[SttpClientBackend, ServiceError, String] =
    ZIO.fromOption(TokenCache.cache.getIfPresent("clientCredentialsToken"))
      .zipLeft(ZIO.logDebug(s"Admin Token from Cache: clientCredentialsToken"))
      .orElse:
        ZIO.serviceWithZIO[SttpClientBackend]: backend =>
          ZIO.logDebug(s"ClientCredentialsFlow: Requesting Token for: ${config.toString}") *>
            tokenRequest.body(requestBody)
              .response(asJson[TokenResponse])
              .send(backend)
              .map(_.body.map(t => t.access_token))
              .flatMap(ZIO.fromEither)
              .mapError: err =>
                ServiceError(
                  s"Could not get a token for '${requestBody("client_id")}' -> ClientCredentials!\n$err\n\n$identityUrl"
                )
              .tap: token =>
                ZIO.logInfo(
                  s"Added Admin Token to Cache self acquired: ${config.client_id} - ${token.take(20)}...${token.takeRight(10)}"
                ).as(TokenCache.cache.put("clientCredentialsToken", token))

  protected def identityUrl    = config.identityUrl
  private lazy val requestBody = config.asMap

end ClientCredentialsFlow
