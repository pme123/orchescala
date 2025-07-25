package orchescala.worker.c8

import io.camunda.zeebe.client.ZeebeClient
import io.camunda.zeebe.client.impl.oauth.OAuthCredentialsProviderBuilder
import zio.{Task, ZIO}

import java.net.URI

trait C8WorkerClient:
  def client: Task[ZeebeClient]

trait C8SaasWorkerClient extends C8WorkerClient:

  protected def zeebeGrpc: String
  protected def zeebeRest: String
  protected def audience: String
  protected def clientId: String
  protected def clientSecret: String
  protected def oAuthAPI: String

  lazy val client: Task[ZeebeClient] =
    ZIO.attempt:
      ZeebeClient.newClientBuilder()
        .grpcAddress(URI.create(zeebeGrpc))
        .restAddress(URI.create(zeebeRest))
        .credentialsProvider(credentialsProvider)
        .build

  private lazy val credentialsProvider =
    new OAuthCredentialsProviderBuilder()
      .authorizationServerUrl(oAuthAPI)
      .audience(audience)
      .clientId(clientId)
      .clientSecret(clientSecret)
      .build
end C8SaasWorkerClient
