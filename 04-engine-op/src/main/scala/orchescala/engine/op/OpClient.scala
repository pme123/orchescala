package orchescala.engine.op

import org.camunda.community.rest.client.invoker.ApiClient
import orchescala.engine.domain.EngineError
import orchescala.engine.rest.{ClientCredentialsFlow, HttpClientProvider, OAuthConfig}
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
        val apiClient = new ApiClient()
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
        val apiClient = new ApiClient()
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

  lazy val client: ZIO[SharedOpClientManager, EngineError, ApiClient] =
    SharedOpClientManager.getOrCreateClient:
      (for
        _      <- ZIO.logDebug(s"Creating Op Engine Client: ${oAuthConfig.ssoBaseUrl}")
        client <- ZIO.attempt(ApiClient())
        _      <- ZIO.attempt:
                    client.setBasePath(operatonRestUrl)
        token  <- authFlow.clientCredentialsToken().provideLayer(HttpClientProvider.live)
        _      <- ZIO.attempt:
                    client.addDefaultHeader("Authorization", s"Bearer $token")
      yield client)
        .tapError: err =>
          ZIO.logError(s"Problem creating Op Engine Client: $err")
        .mapError: ex =>
          EngineError.UnexpectedError(s"Problem creating Op Engine Client: $ex")
end OpOAuth2Client

/** Op client with Bearer token authentication (token provided per request) */
trait OpBearerTokenClient extends OpClient:

  protected def operatonRestUrl: String

  /** Creates a client with the provided Bearer token. Note: This creates a new client for each
    * token, so it should not be cached in SharedOpClientManager.
    */
  def clientWithToken(token: String): ZIO[Any, EngineError, ApiClient] =
    ZIO.attempt:
      val apiClient = new ApiClient()
      apiClient.setBasePath(operatonRestUrl)
      apiClient.addDefaultHeader("Authorization", s"Bearer $token")
      apiClient
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
                    s"Using token from AuthContext: ${token.take(20)}...${token.takeRight(10)}"
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

