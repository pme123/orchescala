package orchescala.engine
package c8

import io.camunda.client.{CamundaClient, CamundaClientBuilder}
import io.camunda.client.impl.oauth.OAuthCredentialsProviderBuilder
import io.camunda.client.CredentialsProvider
import io.camunda.client.CredentialsProvider.StatusCode
import orchescala.engine.domain.EngineError
import zio.{IO, ZIO}

import java.net.URI

// Per-route REST pool size (SDK default is already 100). Irrelevant once streaming/gRPC is used
// below, kept as a safety net for any call that still goes over REST.
private val maxHttpConnections = 100

// SDK default is a single thread for ALL job worker handler dispatch/completion across the whole
// client - with dozens/hundreds of registered job types, that one thread serializes job handling
// and command responses.
private val numJobWorkerExecutionThreads = 32

trait C8Client:
  protected def zeebeGrpc: String
  protected def zeebeRest: String
  def client: ZIO[SharedC8ClientManager, EngineError, CamundaClient]

  protected lazy val clientBuilder = CamundaClient.newClientBuilder()
    // otherwise ZEEBE_*/CAMUNDA_* env vars silently override the settings below
    // (applyEnvironmentVariableOverrides defaults to true in the SDK)
    .applyEnvironmentVariableOverrides(false)
    .grpcAddress(URI.create(zeebeGrpc))
    .restAddress(URI.create(zeebeRest))
    // Every REST call (job activation AND complete/fail/throw commands, since
    // preferRestOverGrpc defaults to true) shares one Apache HttpClient5 pool capped at a
    // hard-coded total of 25 connections - there is no public API to raise that total
    // (maxHttpConnections only raises the per-route limit, which was never the binding
    // constraint). With dozens/hundreds of concurrently registered job types constantly
    // long-polling, that pool is permanently saturated, so command calls queue behind
    // polls for up to the request timeout (DeadlineTimeoutException, or multi-second/
    // tens-of-seconds delays completing a job). Route both activation and commands over
    // gRPC (HTTP/2, multiplexed, no such pool) instead.
    .defaultJobWorkerStreamEnabled(true)
    .preferRestOverGrpc(false)
    .maxHttpConnections(maxHttpConnections)
    .numJobWorkerExecutionThreads(numJobWorkerExecutionThreads)

trait C8SaasClient extends C8Client:

  protected def audience: String
  protected def clientId: String
  protected def clientSecret: String
  protected def oAuthAPI: String

  lazy val client: ZIO[SharedC8ClientManager, EngineError, CamundaClient] =
    SharedC8ClientManager.getOrCreateClient:
      ZIO.logDebug("Creating Camunda Client for simulation") *>
        ZIO
          .attempt:
            clientBuilder
              .credentialsProvider(credentialsProvider)
              .build()
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

  /** Creates a client with the provided Bearer token.
    * Note: This creates a new client for each token, so it should not be cached in SharedC8ClientManager.
    */
  def clientWithToken(token: String): ZIO[Any, EngineError, CamundaClient] =
    ZIO.attempt:
      clientBuilder
        .credentialsProvider(new BearerTokenCredentialsProvider(token))
        .build()
    .mapError: ex =>
      EngineError.UnexpectedError(s"Problem creating C8 Client with token: $ex")

  // Default client without token (for compatibility)
  lazy val client: ZIO[SharedC8ClientManager, EngineError, CamundaClient] =
    SharedC8ClientManager.getOrCreateClient:
      ZIO.attempt:
        clientBuilder.build()
      .mapError: ex =>
        EngineError.UnexpectedError(s"Problem creating C8 Client: $ex")

  /** Custom credentials provider that adds Bearer token to requests */
  private class BearerTokenCredentialsProvider(token: String) extends CredentialsProvider:
    override def applyCredentials(applier: CredentialsProvider.CredentialsApplier): Unit =
      applier.put("Authorization", s"Bearer $token")

    override def shouldRetryRequest(statusCode: StatusCode): Boolean =
      statusCode.isUnauthorized

end C8BearerTokenClient

class C8DefaultBearerTokenClient(val zeebeGrpc: String, val zeebeRest: String) extends C8BearerTokenClient

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
