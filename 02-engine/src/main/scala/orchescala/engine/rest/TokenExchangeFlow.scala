package orchescala.engine.rest

import orchescala.engine.domain.EngineError.ServiceError
import sttp.client3.circe.asJson
import zio.{IO, ZIO}

class TokenExchangeFlow(
    clientCredConfig: OAuthConfig.ClientCredentials
) extends OAuth2Flow:

  def retrieveToken(username: String): ZIO[SttpClientBackend, ServiceError, String] =
    clientCredFlow
      .clientCredentialsToken()
      .flatMap: token =>
        exchangeToken(username, token)

  private lazy val clientCredFlow = ClientCredentialsFlow(clientCredConfig)

  private def exchangeToken(username: String, clientCredToken: String): IO[ServiceError, String] =
    val config = OAuthConfig.TokenExchange(clientCredConfig)
    val body   = config.asMap(username, clientCredToken)
    ZIO.logDebug(s"TokenExchangeFlow: Requesting Token for: ${config.toString(username, clientCredToken)}") *>
      ZIO.fromEither(
        authResponse(body)
          .body
          .map(t => t.access_token)
      ).mapError: err =>
        ServiceError(
          s"Could not get impersonated token for $username - ${clientCredToken.take(20)}...${clientCredToken.takeRight(10)}!\n$err\n\n$identityUrl"
        )
  end exchangeToken

  protected lazy val identityUrl = clientCredConfig.identityUrl

  private def authResponse(body: Map[String, String]) =
    tokenRequest.body(body)
      .response(asJson[TokenResponse])
      .send(syncBackend)

end TokenExchangeFlow
