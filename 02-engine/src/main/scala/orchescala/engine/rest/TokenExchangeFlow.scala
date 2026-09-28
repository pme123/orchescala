package orchescala.engine.rest

import orchescala.engine.domain.EngineError.ServiceError
import sttp.client3.circe.asJson
import zio.{IO, ZIO}

trait TokenExchangeFlowable extends OAuth2Flow:
  def clientCredConfig: OAuthConfig.ClientCredentials
  def retrieveToken(username: String): ZIO[SttpClientBackend, ServiceError, String]

class TokenExchangeFlow(
    val clientCredConfig: OAuthConfig.ClientCredentials
) extends TokenExchangeFlowable:

  def retrieveToken(username: String): ZIO[SttpClientBackend, ServiceError, String] =
    clientCredFlow
      .clientCredentialsToken()
      .flatMap: token =>
        exchangeToken(username, token)

  private lazy val clientCredFlow = ClientCredentialsFlow(clientCredConfig)

  private def exchangeToken(username: String, clientCredToken: String): IO[ServiceError, String] =
    val config = OAuthConfig.TokenExchange(clientCredConfig)
    val body   = config.asMap(username, clientCredToken)
    // no username in the log - the person the token is for
    ZIO.logDebug(s"TokenExchangeFlow: Requesting Token with ${TokenFingerprint(clientCredToken)}") *>
      // the call blocks (up to tokenCallHardTimeout) - not on ZIO's few threads
      ZIO.blocking(ZIO.fromEither(
        withHardTimeout(authResponse(body))
          .flatMap(_.body.left.map(_.toString))
          .map(t => t.access_token)
      )).mapError: err =>
        ServiceError(orchescala.engine.LogSafe.withDetails(
          s"Could not get impersonated token - ${TokenFingerprint(clientCredToken)}!",
          s"requested subject: $username\n$err"
        ))
  end exchangeToken

  protected lazy val identityUrl = clientCredConfig.identityUrl

  private def authResponse(body: Map[String, String]) =
    tokenRequest.body(body)
      .response(asJson[TokenResponse])
      .send(syncBackend)

end TokenExchangeFlow
