package orchescala.worker.c7

import orchescala.domain.OrchescalaLogger
import orchescala.engine.Slf4JLogger
import orchescala.worker.oauth.OAuthPasswordFlow
import org.apache.hc.client5.http.config.RequestConfig
import org.apache.hc.core5.http.*
import org.apache.hc.core5.http.protocol.HttpContext
import org.apache.hc.core5.util.Timeout
import org.camunda.bpm.client.ExternalTaskClient
import org.camunda.bpm.client.backoff.ExponentialBackoffStrategy
import zio.ZIO

import java.util.Base64
import scala.concurrent.duration.*
import scala.jdk.CollectionConverters.*

trait C7WorkerClient:
  def client: ZIO[Any, Throwable, ExternalTaskClient]

object C7NoAuthWorkerClient extends C7WorkerClient:

  def client =
    ZIO.attempt:
      ExternalTaskClient.create()
        .baseUrl("http://localhost:8887/engine-rest")
        .disableBackoffStrategy()
        .customizeHttpClient: httpClientBuilder =>
          httpClientBuilder.setDefaultRequestConfig(RequestConfig.custom()
            // .setResponseTimeout(Timeout.ofSeconds(15))
            .build())
        .build()
end C7NoAuthWorkerClient

object C7BasicAuthWorkerClient extends C7WorkerClient:

  lazy val client =
    ZIO.attempt:
      val encodedCredentials = encodeCredentials("admin", "admin")
      val cl                 = ExternalTaskClient.create()
        .baseUrl("http://localhost:8080/engine-rest")
        .disableBackoffStrategy()
        .customizeHttpClient: httpClientBuilder =>
          httpClientBuilder.setDefaultRequestConfig(RequestConfig.custom()
            .setResponseTimeout(Timeout.ofSeconds(15))
            .build())
            .setDefaultHeaders(List(new org.apache.hc.core5.http.message.BasicHeader(
              "Authorization",
              s"Basic $encodedCredentials"
            )).asJava)
        .build()
      cl

  private def encodeCredentials(username: String, password: String): String =
    val credentials = s"$username:$password"
    Base64.getEncoder.encodeToString(credentials.getBytes)
end C7BasicAuthWorkerClient

trait OAuth2WorkerClient extends C7WorkerClient, OAuthPasswordFlow:
  given OrchescalaLogger   = Slf4JLogger.logger(getClass.getName)
  def camundaRestUrl       = "http://localhost:8080/engine-rest"
  def maxTimeForAcquireJob = 500.millis
  def lockDuration: Long   = 30.seconds.toMillis
  def maxTasks: Int        = 10

  def addAccessToken = new HttpRequestInterceptor:
    override def process(request: HttpRequest, entity: EntityDetails, context: HttpContext): Unit =
      val token = adminToken().toOption.getOrElse("NO TOKEN")
      request.addHeader("Authorization", token)

  lazy val client =
    ZIO
      .attempt:
        ExternalTaskClient.create()
          .baseUrl(camundaRestUrl)
          .maxTasks(maxTasks)
          .asyncResponseTimeout(10.seconds.toMillis)
          //  .disableBackoffStrategy()
          .backoffStrategy(
            new ExponentialBackoffStrategy(
              100L, // Initial backoff time in milliseconds
              2.0,  // Backoff factor
              maxTimeForAcquireJob.toMillis
            )
          )
          .lockDuration(lockDuration)
          .customizeHttpClient: httpClientBuilder =>
            httpClientBuilder
              .addRequestInterceptorLast(addAccessToken)
              .setConnectionManager(SharedHttpClientManager.connectionManager)
              .build()
          .build()

end OAuth2WorkerClient
