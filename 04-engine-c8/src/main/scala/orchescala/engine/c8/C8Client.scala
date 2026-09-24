package orchescala.engine
package c8

import io.camunda.client.{CamundaClient, CamundaClientBuilder}
import io.camunda.client.impl.oauth.OAuthCredentialsProviderBuilder
import orchescala.engine.domain.EngineError
import zio.ZIO

import java.net.URI

// Per-route REST pool size (SDK default is already 100). Irrelevant once streaming/gRPC is used
// below, kept as a safety net for any call that still goes over REST.
private val maxHttpConnections = 100

// SDK default is a single thread for ALL job worker handler dispatch/completion across the whole
// client - with dozens/hundreds of registered job types, that one thread serializes job handling
// and command responses.
private val numJobWorkerExecutionThreads = 32

/** Connection to a Camunda 8 cluster.
  *
  *   - [[client]]: the `CamundaClient` SDK - for the job workers (job streaming, backoff), one per
  *     application with fixed credentials.
  *   - [[restClient]]: the engine services (gateway, simulation, dev helpers) - plain REST API v2
  *     calls on a shared connection pool, the `Authorization` header resolved per request by
  *     [[restAuth]].
  */
trait C8Client:
  protected def zeebeGrpc: String
  protected def zeebeRest: String
  def client: ZIO[SharedC8ClientManager, EngineError, CamundaClient]

  /** How the engine services authenticate their REST calls. */
  protected def restAuth: C8RestAuth = C8RestAuth.NoAuth

  lazy val restClient: C8RestClient = C8RestClient(zeebeRest, restAuth)

  // A `def` on purpose: the SDK builder is mutable (`credentialsProvider(..)` sets a field) and the
  // built client keeps a reference to it as its configuration - clients built from a shared
  // builder would pick up each other's credentials.
  protected def clientBuilder: CamundaClientBuilder = CamundaClient.newClientBuilder()
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

  override protected lazy val restAuth: C8RestAuth =
    C8RestAuth.ClientCredentials(oAuthAPI, clientId, clientSecret, audience)

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

/** C8 client with Bearer token authentication: the engine services pass the caller's token (from
  * `AuthContext`) through on every request - nothing is cached per token.
  */
trait C8BearerTokenClient extends C8Client:

  override protected def restAuth: C8RestAuth = C8RestAuth.PassThrough

  // SDK client without credentials (for compatibility) - the engine services use `restClient`
  lazy val client: ZIO[SharedC8ClientManager, EngineError, CamundaClient] =
    SharedC8ClientManager.getOrCreateClient:
      ZIO.attempt:
        clientBuilder.build()
      .mapError: ex =>
        EngineError.UnexpectedError(s"Problem creating C8 Client: $ex")

end C8BearerTokenClient

class C8DefaultBearerTokenClient(val zeebeGrpc: String, val zeebeRest: String) extends C8BearerTokenClient
