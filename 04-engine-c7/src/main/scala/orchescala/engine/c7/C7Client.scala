package orchescala.engine.c7

import org.camunda.community.rest.client.invoker.ApiClient
import orchescala.engine.domain.EngineError
import orchescala.engine.rest.{ClientCredentialsFlow, HttpClientProvider, OAuthConfig}
import zio.*

/** Base trait for C7 clients that provide ApiClient instances */
trait C7Client:
  def client: ZIO[SharedC7ClientManager, EngineError, ApiClient]

/** C7 client for local/direct connections */
trait C7LocalClient extends C7Client:

  protected def camundaRestUrl: String

  lazy val client: ZIO[SharedC7ClientManager, EngineError, ApiClient] =
    SharedC7ClientManager.getOrCreateClient:
      ZIO.attempt:
        val apiClient = new ApiClient()
        apiClient.setBasePath(camundaRestUrl)
      .mapError: ex =>
        EngineError.UnexpectedError(s"Problem creating C7 API Client: $ex")

end C7LocalClient

/** C7 client with basic authentication */
trait C7BasicAuthClient extends C7Client:

  protected def camundaRestUrl: String
  protected def username: String
  protected def password: String

  lazy val client: ZIO[SharedC7ClientManager, EngineError, ApiClient] =
    SharedC7ClientManager.getOrCreateClient:
      ZIO.attempt:
        val apiClient = new ApiClient()
        apiClient.setBasePath(camundaRestUrl)
        apiClient.setUsername(username)
        apiClient.setPassword(password)
        apiClient
      .mapError: ex =>
        EngineError.UnexpectedError(s"Problem creating C7 API Client: $ex")

end C7BasicAuthClient

class C7OAuth2Client(camundaRestUrl: String, oAuthConfig: OAuthConfig.ClientCredentials)
    extends C7Client:
  lazy val authFlow = ClientCredentialsFlow(oAuthConfig)

  lazy val client: ZIO[SharedC7ClientManager, EngineError, ApiClient] =
    SharedC7ClientManager.getOrCreateClient:
      (for
        _      <- ZIO.logDebug(s"Creating Engine Client: ${oAuthConfig.ssoBaseUrl}")
        client <- ZIO.attempt(ApiClient())
        _      <- ZIO.attempt:
                    client.setBasePath(camundaRestUrl)
        token  <- authFlow.clientCredentialsToken().provideLayer(HttpClientProvider.live)
        _      <- ZIO.attempt:
                    client.addDefaultHeader("Authorization", s"Bearer $token")
      yield client)
        .tapError: err =>
          ZIO.logError(s"Problem creating Engine Client: $err")
        .mapError: ex =>
          EngineError.UnexpectedError(s"Problem creating Engine Client: $ex")
end C7OAuth2Client

/** C7 client with Bearer token authentication (token provided per request) */
trait C7BearerTokenClient extends C7Client:

  protected def camundaRestUrl: String

  /** Creates a client with the provided Bearer token. Note: This creates a new client for each
    * token, so it should not be cached in SharedC7ClientManager.
    */
  def clientWithToken(token: String): ZIO[Any, EngineError, ApiClient] =
    ZIO.attempt:
      val apiClient = new ApiClient()
      apiClient.setBasePath(camundaRestUrl)
      apiClient.addDefaultHeader("Authorization", s"Bearer $token")
      apiClient
    .mapError: ex =>
      EngineError.UnexpectedError(s"Problem creating C7 API Client with token: $ex")

  // Default client without token (for compatibility)
  lazy val client: ZIO[SharedC7ClientManager, EngineError, ApiClient] =
    ZIO.fail(EngineError.UnexpectedError("C7BearerTokenClient must provide a token."))

end C7BearerTokenClient

class C7DefaultBearerTokenClient(val camundaRestUrl: String) extends C7BearerTokenClient

object C7Client:

  /** Helper to create an IO[EngineError, ApiClient] from a C7Client that can be used in engine
    * services.
    *
    * For C7BearerTokenClient, this will check AuthContext on every request and create a fresh
    * client with the token if present. This ensures that pass-through authentication works
    * correctly even when tokens change between requests.
    */
  def resolveClient(c7Client: C7Client)
      : ZIO[SharedC7ClientManager, Nothing, IO[EngineError, ApiClient]] =
    c7Client match
      case bearerClient: C7BearerTokenClient =>
        ZIO.logDebug("Using C7BearerTokenClient")
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
                      "C7BearerTokenClient requires a token in AuthContext"
                    ))

      case _ =>
        ZIO.logDebug("Using default client") *>
          // For other client types, eagerly resolve the client and return it as an IO
          ZIO.serviceWithZIO[SharedC7ClientManager]: _ =>
            c7Client.client
              .map: apiClient =>
                // Return the cached client wrapped in ZIO.succeed
                ZIO.logDebug("Return cached client")
                  .as(apiClient)
              .catchAll: err =>
                // If client creation fails, return an IO that will fail when executed
                ZIO.logError(s"Problem creating C7 API Client: $err")
                  .as(ZIO.fail(err))

end C7Client
