package orchescala.engine
package c8

import io.camunda.client.CamundaClient
import io.camunda.client.impl.oauth.OAuthCredentialsProviderBuilder
import zio.{IO, ZIO}

import java.net.URI

trait C8Client:
  def client: IO[EngineError, CamundaClient]

trait C8SaasClient extends C8Client:

  protected def zeebeGrpc: String
  protected def zeebeRest: String
  protected def audience: String
  protected def clientId: String
  protected def clientSecret: String
  protected def oAuthAPI: String

  lazy val client: IO[EngineError, CamundaClient] =
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
            EngineError.UnexpectedError(s"Problem creating API Client: $ex")

  private lazy val credentialsProvider =
    new OAuthCredentialsProviderBuilder()
      .authorizationServerUrl(oAuthAPI)
      .audience(audience)
      .clientId(clientId)
      .clientSecret(clientSecret)
      .build
end C8SaasClient
