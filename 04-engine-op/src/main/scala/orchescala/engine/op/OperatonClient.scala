package orchescala.engine.op

import org.camunda.community.rest.client.invoker.ApiClient
import orchescala.engine.domain.EngineError
import orchescala.engine.rest.{ClientCredentialsFlow, HttpClientProvider, OAuthConfig}
import zio.*

/** Base trait for Operaton clients that provide ApiClient instances */
trait OperatonClient:
  def client: ZIO[SharedOpClientManager, EngineError, ApiClient]

/** Operaton client for local/direct connections */
trait OperatonLocalClient extends OperatonClient:

  protected def operatonRestUrl: String

  lazy val client: ZIO[SharedOpClientManager, EngineError, ApiClient] =
    SharedOpClientManager.getOrCreateClient:
      ZIO.attempt:
        val apiClient = new ApiClient()
        apiClient.setBasePath(operatonRestUrl)
      .mapError: ex =>
        EngineError.UnexpectedError(s"Problem creating Operaton API Client: $ex")

end OperatonLocalClient

/** Operaton client with basic authentication */
trait OperatonBasicAuthClient extends OperatonClient:

  protected def operatonRestUrl: String
  protected def username: String
  protected def password: String

  lazy val client: ZIO[SharedOpClientManager, EngineError, ApiClient] =
    SharedOpClientManager.getOrCreateClient:
      ZIO.attempt:
        val apiClient = new ApiClient()
        apiClient.setBasePath(operatonRestUrl)
        apiClient.setUsername(username)
        apiClient.setPassword(password)
        apiClient
      .mapError: ex =>
        EngineError.UnexpectedError(s"Problem creating Operaton API Client: $ex")

end OperatonBasicAuthClient

class OperatonOAuth2Client(operatonRestUrl: String, oAuthConfig: OAuthConfig.ClientCredentials)
    extends OperatonClient:
  lazy val authFlow = ClientCredentialsFlow(oAuthConfig)

  lazy val client: ZIO[SharedOpClientManager, EngineError, ApiClient] =
    SharedOpClientManager.getOrCreateClient:
      (for
        _      <- ZIO.logDebug(s"Creating Operaton Engine Client: ${oAuthConfig.ssoBaseUrl}")
        client <- ZIO.attempt(ApiClient())
        _      <- ZIO.attempt:
                    client.setBasePath(operatonRestUrl)
        token  <- authFlow.clientCredentialsToken().provideLayer(HttpClientProvider.live)
        _      <- ZIO.attempt:
                    client.addDefaultHeader("Authorization", s"Bearer $token")
      yield client)
        .tapError: err =>
          ZIO.logError(s"Problem creating Operaton Engine Client: $err")
        .mapError: ex =>
          EngineError.UnexpectedError(s"Problem creating Operaton Engine Client: $ex")
end OperatonOAuth2Client

/** Operaton client with Bearer token authentication (token provided per request) */
trait OperatonBearerTokenClient extends OperatonClient:

  protected def operatonRestUrl: String

  /** Creates a client with the provided Bearer token. Note: This creates a new client for each
    * token, so it should not be cached in SharedOperatonClientManager.
    */
  def clientWithToken(token: String): ZIO[Any, EngineError, ApiClient] =
    ZIO.attempt:
      val apiClient = new ApiClient()
      apiClient.setBasePath(operatonRestUrl)
      apiClient.addDefaultHeader("Authorization", s"Bearer $token")
      apiClient
    .mapError: ex =>
      EngineError.UnexpectedError(s"Problem creating Operaton API Client with token: $ex")

  // Default client without token (for compatibility)
  lazy val client: ZIO[SharedOpClientManager, EngineError, ApiClient] =
    ZIO.fail(EngineError.UnexpectedError("OperatonBearerTokenClient must provide a token."))

end OperatonBearerTokenClient

class OperatonDefaultBearerTokenClient(val operatonRestUrl: String) extends OperatonBearerTokenClient

object OperatonClient:

  /** Helper to create an IO[EngineError, ApiClient] from an OperatonClient that can be used in engine
    * services.
    *
    * For OperatonBearerTokenClient, this will check AuthContext on every request and create a fresh
    * client with the token if present. This ensures that pass-through authentication works
    * correctly even when tokens change between requests.
    */
  def resolveClient(operatonClient: OperatonClient)
      : ZIO[SharedOpClientManager, Nothing, IO[EngineError, ApiClient]] =
    operatonClient match
      case bearerClient: OperatonBearerTokenClient =>
        ZIO.logDebug("Using OperatonBearerTokenClient")
          .as:
            // For bearer token clients, check AuthContext on every request
            import orchescala.engine.AuthContext
            AuthContext.get.flatMap: authContext =>
              authContext.bearerToken match
                case Some(token) =>
                  ZIO.logDebug(
                    s"Using token from AuthContext: ${token.take(20)}...${token.takeRight(10)}"
                  ) *>
                    // Use fresh client with token from AuthContext (pass-through authentication)
                    bearerClient.clientWithToken(token)
                case None        =>
                  ZIO.logDebug("No token in AuthContext, using default client") *>
                    // No token in context, fail with error (bearer token client requires token)
                    ZIO.fail(EngineError.UnexpectedError(
                      "OperatonBearerTokenClient requires a token in AuthContext"
                    ))

      case _ =>
        ZIO.logDebug("Using default client") *>
          // For other client types, eagerly resolve the client and return it as an IO
          ZIO.serviceWithZIO[SharedOpClientManager]: _ =>
            operatonClient.client
              .map: apiClient =>
                // Return the cached client wrapped in ZIO.succeed
                ZIO.logDebug("Return cached client")
                  .as(apiClient)
              .catchAll: err =>
                // If client creation fails, return an IO that will fail when executed
                ZIO.logError(s"Problem creating Operaton API Client: $err")
                  .as(ZIO.fail(err))

end OperatonClient

