package orchescala.worker.c8

import io.camunda.zeebe.client.ZeebeClient
import io.camunda.zeebe.client.impl.oauth.OAuthCredentialsProviderBuilder
import zio.{Task, ZIO}

import java.net.URI

trait C8WorkerClient:
  def client: Task[ZeebeClient]
  
trait C8SaasWorkerClient extends C8WorkerClient:
  
  lazy val client: Task[ZeebeClient] =
    ZIO.attempt:
      ZeebeClient.newClientBuilder()
        .grpcAddress(URI.create(zeebeGrpc))
        .restAddress(URI.create(zeebeRest))
        .credentialsProvider(credentialsProvider)
        .build

  private lazy val zeebeGrpc =
    "https://dbd4cad1-5621-4d66-b14e-71c92456939a.bru-2.zeebe.camunda.io:443"
  private lazy val zeebeRest =
    "https://bru-2.zeebe.camunda.io:443/dbd4cad1-5621-4d66-b14e-71c92456939a/v2"
  private lazy val audience = "zeebe.camunda.io"
  private lazy val clientId = sys.env("CAMUNDA8_CLOUD_CLIENTID")
  private lazy val clientSecret = sys.env("CAMUNDA8_CLOUD_CLIENTSECRET")
  private lazy val oAuthAPI = "https://login.cloud.camunda.io/oauth/token"

  private lazy val credentialsProvider =
    new OAuthCredentialsProviderBuilder()
      .authorizationServerUrl(oAuthAPI)
      .audience(audience)
      .clientId(clientId)
      .clientSecret(clientSecret)
      .build
