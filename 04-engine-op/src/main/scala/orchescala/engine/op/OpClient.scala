package orchescala.engine.op

import org.camunda.community.rest.client.invoker.ApiClient
import orchescala.engine.c7.{ApiHttpClient, BearerTokenApiClient}
import orchescala.engine.domain.EngineError
import orchescala.engine.rest.{ClientCredentialsFlow, HttpClientProvider, OAuthConfig, TokenFingerprint}
import zio.*

/** Base trait for Op clients that provide ApiClient instances */
trait OpClient:
  def client: ZIO[SharedOpClientManager, EngineError, ApiClient]

/** Op client for local/direct connections */
trait OpLocalClient extends OpClient:

  protected def operatonRestUrl: String

  lazy val client: ZIO[SharedOpClientManager, EngineError, ApiClient] =
    SharedOpClientManager.getOrCreateClient:
      ZIO.attempt:
        val apiClient = new ApiClient(ApiHttpClient.pooled())
        apiClient.setBasePath(operatonRestUrl)
      .mapError: ex =>
        EngineError.UnexpectedError(s"Problem creating Op API Client: $ex")

end OpLocalClient

/** Op client with basic authentication */
trait OpBasicAuthClient extends OpClient:

  protected def operatonRestUrl: String
  protected def username: String
  protected def password: String

  lazy val client: ZIO[SharedOpClientManager, EngineError, ApiClient] =
    SharedOpClientManager.getOrCreateClient:
      ZIO.attempt:
        val apiClient = new ApiClient(ApiHttpClient.pooled())
        apiClient.setBasePath(operatonRestUrl)
        apiClient.setUsername(username)
        apiClient.setPassword(password)
        apiClient
      .mapError: ex =>
        EngineError.UnexpectedError(s"Problem creating Op API Client: $ex")

end OpBasicAuthClient

class OpOAuth2Client(operatonRestUrl: String, oAuthConfig: OAuthConfig.ClientCredentials)
    extends OpClient:
  lazy val authFlow = ClientCredentialsFlow(oAuthConfig)

  /** A client with the current token, per call: the token comes from the cache and is refreshed
    * shortly before it expires (asynchronously, never inside the HTTP connection pool). The client
    * only holds base path and header, on the shared connection pool (see BearerTokenApiClient).
    * Before, one client was built with the first token and shared for the whole runtime - every
    * call failed with 401 once that token expired (Keycloak: usually after 5 minutes).
    */
  lazy val client: ZIO[SharedOpClientManager, EngineError, ApiClient] =
    authFlow
      .clientCredentialsToken()
      .provideLayer(HttpClientProvider.live)
      .flatMap(token => ZIO.attempt(BearerTokenApiClient(operatonRestUrl, token)))
      .tapError: err =>
        ZIO.logError(s"Problem creating Op Engine Client: $err")
      .mapError: ex =>
        EngineError.UnexpectedError(s"Problem creating Op Engine Client: $ex")
end OpOAuth2Client

/** Op client with Bearer token authentication (token provided per request) */
trait OpBearerTokenClient extends OpClient:

  protected def operatonRestUrl: String

  /** Returns a client for the given Bearer token - cheap, it runs on a shared connection pool
    * (see BearerTokenApiClient).
    */
  def clientWithToken(token: String): ZIO[Any, EngineError, ApiClient] =
    ZIO.attempt(BearerTokenApiClient(operatonRestUrl, token))
      .mapError: ex =>
        EngineError.UnexpectedError(s"Problem creating Op API Client with token: $ex")

  // Default client without token (for compatibility)
  lazy val client: ZIO[SharedOpClientManager, EngineError, ApiClient] =
    ZIO.fail(EngineError.UnexpectedError("OpBearerTokenClient must provide a token."))

end OpBearerTokenClient

class OpDefaultBearerTokenClient(val operatonRestUrl: String) extends OpBearerTokenClient

object OpClient:

  /** Helper to create an IO[EngineError, ApiClient] from an OpClient that can be used in engine
    * services.
    *
    * For OpBearerTokenClient, this will check AuthContext on every request and create a fresh
    * client with the token if present. This ensures that pass-through authentication works
    * correctly even when tokens change between requests.
    */
  def resolveClient(operatonClient: OpClient)
      : ZIO[SharedOpClientManager, Nothing, IO[EngineError, ApiClient]] =
    operatonClient match
      case bearerClient: OpBearerTokenClient =>
        ZIO.logDebug("Using OpBearerTokenClient")
          .as:
            // For bearer token clients, check AuthContext on every request
            import orchescala.engine.AuthContext
            AuthContext.get.flatMap: authContext =>
              authContext.bearerToken match
                case Some(token) =>
                  ZIO.logDebug(
                    s"Using token from AuthContext: ${TokenFingerprint(token)}"
                  ) *>
                    // Use fresh client with token from AuthContext (pass-through authentication)
                    bearerClient.clientWithToken(token)
                case None        =>
                  ZIO.logDebug("No token in AuthContext, using default client") *>
                    // No token in context, fail with error (bearer token client requires token)
                    ZIO.fail(EngineError.UnexpectedError(
                      "OpBearerTokenClient requires a token in AuthContext"
                    ))

      case _ =>
        ZIO.logDebug("Using default client") *>
          // For other client types, lazily resolve the client using the captured environment.
          // This mirrors C7Client.resolveClient: the returned IO calls getOrCreateClient each time
          // it is executed, so if the scoped SharedOpClientManager finalizer closed the previous
          // ApiClient and reset the Ref, a fresh client will be created on the next call.
          ZIO.environmentWith[SharedOpClientManager]: env =>
            operatonClient.client.provideEnvironment(env)

end OpClient

