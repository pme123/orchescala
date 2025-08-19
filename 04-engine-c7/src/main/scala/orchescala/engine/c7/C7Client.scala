package orchescala.engine.c7

import org.camunda.community.rest.client.invoker.ApiClient
import orchescala.engine.EngineError
import zio.*

/** Base trait for C7 clients that provide ApiClient instances */
trait C7Client:
  def client: ZIO[SharedC7ClientManager, EngineError, ApiClient]

/** C7 client for local/direct connections */
trait C7LocalClient extends C7Client:
  
  protected def camundaRestUrl: String = "http://localhost:8080/engine-rest"
  
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

object C7Client:
  
  /** Helper to create an IO[EngineError, ApiClient] from a C7Client that can be used in engine services */
  def resolveClient(c7Client: C7Client): ZIO[SharedC7ClientManager, Nothing, IO[EngineError, ApiClient]] =
    ZIO.environmentWith[SharedC7ClientManager] { env =>
      c7Client.client.provideEnvironment(env)
    }

end C7Client
