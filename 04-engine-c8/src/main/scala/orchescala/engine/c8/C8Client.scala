package orchescala.engine
package c8

import io.camunda.client.CamundaClient
import io.camunda.client.impl.oauth.OAuthCredentialsProviderBuilder
import io.camunda.client.CredentialsProvider
import io.camunda.client.CredentialsProvider.StatusCode
import orchescala.engine.domain.EngineError
import zio.{IO, ZIO}

import java.net.URI

trait C8Client:
  def client: ZIO[SharedC8ClientManager, EngineError, CamundaClient]

trait C8SaasClient extends C8Client:

  protected def zeebeGrpc: String
  protected def zeebeRest: String
  protected def audience: String
  protected def clientId: String
  protected def clientSecret: String
  protected def oAuthAPI: String

  lazy val client: ZIO[SharedC8ClientManager, EngineError, CamundaClient] =
    SharedC8ClientManager.getOrCreateClient:
      ZIO.logDebug("Creating Camunda Client for simulation") *>
        ZIO
          .attempt:
            CamundaClient.newClientBuilder()
              .grpcAddress(URI.create(zeebeGrpc))
              .restAddress(URI.create(zeebeRest))
              .credentialsProvider(credentialsProvider)
              .build
          .mapError: ex =>
            EngineError.UnexpectedError(s"Problem creating Engine Client: $ex")

  private lazy val credentialsProvider =
    new OAuthCredentialsProviderBuilder()
      .authorizationServerUrl(oAuthAPI)
      .audience(audience)
      .clientId(clientId)
      .clientSecret(clientSecret)
      .build
end C8SaasClient

/** C8 client with Bearer token authentication (token provided per request) */
trait C8BearerTokenClient extends C8Client:

  protected def zeebeGrpc: String
  protected def zeebeRest: String

  /** Creates a client with the provided Bearer token.
    * Note: This creates a new client for each token, so it should not be cached in SharedC8ClientManager.
    */
  def clientWithToken(token: String): ZIO[Any, EngineError, CamundaClient] =
    ZIO.attempt:
      CamundaClient.newClientBuilder()
        .grpcAddress(URI.create(zeebeGrpc))
        .restAddress(URI.create(zeebeRest))
        .credentialsProvider(new BearerTokenCredentialsProvider(token))
        .build()
    .mapError: ex =>
      EngineError.UnexpectedError(s"Problem creating C8 Client with token: $ex")

  // Default client without token (for compatibility)
  lazy val client: ZIO[SharedC8ClientManager, EngineError, CamundaClient] =
    SharedC8ClientManager.getOrCreateClient:
      ZIO.attempt:
        CamundaClient.newClientBuilder()
          .grpcAddress(URI.create(zeebeGrpc))
          .restAddress(URI.create(zeebeRest))
          .build()
      .mapError: ex =>
        EngineError.UnexpectedError(s"Problem creating C8 Client: $ex")

  /** Custom credentials provider that adds Bearer token to requests */
  private class BearerTokenCredentialsProvider(token: String) extends CredentialsProvider:
    override def applyCredentials(applier: CredentialsProvider.CredentialsApplier): Unit =
      applier.put("Authorization", s"Bearer $token")

    override def shouldRetryRequest(statusCode: StatusCode): Boolean =
      statusCode.isUnauthorized

end C8BearerTokenClient

object C8Client:

  /** Helper to create an IO[EngineError, CamundaClient] from a C8Client that can be used in engine services.
    *
    * For C8BearerTokenClient, this will check AuthContext on every request and create a fresh client
    * with the token if present. This ensures that pass-through authentication works correctly even
    * when tokens change between requests.
    */
  def resolveClient(c8Client: C8Client): ZIO[SharedC8ClientManager, Nothing, IO[EngineError, CamundaClient]] =
    c8Client match
      case bearerClient: C8BearerTokenClient =>
        // For bearer token clients, check AuthContext on every request
        ZIO.environmentWith[SharedC8ClientManager] { env =>
          import orchescala.engine.AuthContext
          AuthContext.get.flatMap { authContext =>
            authContext.bearerToken match
              case Some(token) =>
                // Create a fresh client with the token (not cached)
                bearerClient.clientWithToken(token)
              case None =>
                // Fall back to default client without token
                bearerClient.client.provideEnvironment(env)
          }
        }
      case _ =>
        // For other client types, use the standard cached client
        ZIO.environmentWith[SharedC8ClientManager] { env =>
          c8Client.client.provideEnvironment(env)
        }
