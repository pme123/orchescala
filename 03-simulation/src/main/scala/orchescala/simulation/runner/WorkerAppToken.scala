package orchescala.simulation.runner

import orchescala.engine.domain.EngineError
import orchescala.engine.domain.EngineError.ServiceError
import orchescala.engine.rest.{ClientCredentialsFlow, OAuthConfig, PasswordGrantFlow, SttpClientBackend}
import zio.ZIO

/** The Bearer token a simulation sends to the worker app (`SimulationConfig.workerAppAuth`). */
private[simulation] object WorkerAppToken:

  /** Sent without `workerAppAuth` - only accepted by a worker app with `PresenceOnly`. */
  val noToken = "No token needed"

  def apply(auth: Option[OAuthConfig]): ZIO[SttpClientBackend, EngineError, String] =
    auth match
      case None                                    => ZIO.succeed(noToken)
      case Some(config: OAuthConfig.ClientCredentials) =>
        ClientCredentialsFlow(config).clientCredentialsToken()
      case Some(config: OAuthConfig.PasswordGrant)     =>
        PasswordGrantFlow(config).retrieveToken()
      case Some(_: OAuthConfig.TokenExchange)          =>
        ZIO.fail(ServiceError("TokenExchange is not supported as worker app login of a simulation."))

end WorkerAppToken
