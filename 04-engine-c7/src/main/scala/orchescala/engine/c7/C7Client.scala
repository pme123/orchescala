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
        apiClient
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

class C7OAuth2Client(camundaRestUrl: String, oAuthConfig: OAuthConfig.ClientCredentials) extends C7Client:
  lazy val authFlow = ClientCredentialsFlow(oAuthConfig)
  
  lazy val client: ZIO[SharedC7ClientManager, EngineError, ApiClient] =
    SharedC7ClientManager.getOrCreateClient:
      (for
        _ <- ZIO.logDebug(s"Creating Engine Client: ${oAuthConfig.ssoBaseUrl}")
        client <- ZIO.attempt(ApiClient())
        _ <- ZIO.attempt:
          client.setBasePath(camundaRestUrl)
        token <- authFlow.clientCredentialsToken().provideLayer(HttpClientProvider.live)
        _ <- ZIO.attempt:
          client.addDefaultHeader("Authorization", s"Bearer $token")
      yield client)
        .mapError: ex =>
          EngineError.UnexpectedError(s"Problem creating Engine Client: $ex")
        
  
      
/** C7 client with Bearer token authentication (token provided per request) */
trait C7BearerTokenClient extends C7Client:

  protected def camundaRestUrl: String

  /** Creates a client with the provided Bearer token.
    * Note: This creates a new client for each token, so it should not be cached in SharedC7ClientManager.
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

object C7Client:

  /** Helper to create an IO[EngineError, ApiClient] from a C7Client that can be used in engine services.
    *
    * For C7BearerTokenClient, this will check AuthContext on every request and create a fresh client
    * with the token if present. This ensures that pass-through authentication works correctly even
    * when tokens change between requests.
    */
  def resolveClient(c7Client: C7Client): ZIO[SharedC7ClientManager, Nothing, IO[EngineError, ApiClient]] =
    c7Client match
      case bearerClient: C7BearerTokenClient =>
        // For bearer token clients, check AuthContext on every request
        ZIO.environmentWith[SharedC7ClientManager] : env =>
          import orchescala.engine.AuthContext
          AuthContext.get.flatMap : authContext =>
            authContext.bearerToken match
              case Some(token) =>
                ZIO.logDebug(s"Using token from AuthContext: ${token.take(20)}...${token.takeRight(10)}") *>
                // Use fresh client with token from AuthContext (pass-through authentication)
                bearerClient.clientWithToken(token)
              case None =>
                ZIO.logDebug("No token in AuthContext, using default client") *>
                // No token in context, use default client (may be cached)
                bearerClient.client.provideEnvironment(env)

      case _ =>
        // For other client types, use the standard cached client
        ZIO.environmentWith[SharedC7ClientManager] { env =>
          c7Client.client.provideEnvironment(env)
        }

end C7Client
