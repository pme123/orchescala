package orchescala.worker.c7

import orchescala.domain.OrchescalaLogger
import orchescala.engine.Slf4JLogger
import orchescala.engine.rest.{OAuthConfig, PasswordGrantFlow, SttpClientBackend}
import orchescala.worker.WorkerError
import org.apache.hc.client5.http.config.RequestConfig
import org.apache.hc.core5.http.*
import org.apache.hc.core5.http.protocol.HttpContext
import org.camunda.bpm.client.ExternalTaskClient
import org.camunda.bpm.client.backoff.ExponentialBackoffStrategy
import zio.ZIO

import java.util.Base64
import scala.concurrent.duration.*
import scala.jdk.CollectionConverters.*

trait C7WorkerClient:
  def client: ZIO[SharedC7ExternalClientManager, Throwable, ExternalTaskClient]

  protected def camundaRestUrl: String
  protected def maxTimeForAcquireJob: Duration = 500.millis
  protected def asyncResponseTimeout: Duration = 15.seconds
  protected def lockDuration: Duration         = 30.seconds
  protected def maxTasks: Int                  = 10

  protected def externalClient = ExternalTaskClient.create()
    .baseUrl(camundaRestUrl)
    .maxTasks(maxTasks)
    .asyncResponseTimeout(asyncResponseTimeout.toMillis)
    .lockDuration(lockDuration.toMillis)
    //  .disableBackoffStrategy()
    .backoffStrategy(
      new ExponentialBackoffStrategy(
        100L, // Initial backoff time in milliseconds
        2.0,  // Backoff factor
        maxTimeForAcquireJob.toMillis
      )
    )
end C7WorkerClient

object C7NoAuthWorkerClient extends C7WorkerClient:

  protected def camundaRestUrl: String = "http://localhost:8887/engine-rest"

  def client: ZIO[SharedC7ExternalClientManager, Throwable, ExternalTaskClient] =
    SharedC7ExternalClientManager.getOrCreateClient:
      ZIO.logInfo(
        "Creating C7 ExternalTaskClient (No Auth) for http://localhost:8887/engine-rest"
      ) *>
        ZIO
          .attempt:
            externalClient
              .customizeHttpClient: httpClientBuilder =>
                httpClientBuilder.setDefaultRequestConfig(RequestConfig.custom()
                  // .setResponseTimeout(Timeout.ofSeconds(15))
                  .build())
              .build()
          .tap(_ => ZIO.logInfo("C7 ExternalTaskClient (No Auth) created successfully"))
          .tapError(err => ZIO.logError(s"Failed to create C7 ExternalTaskClient (No Auth): $err"))
end C7NoAuthWorkerClient

object C7BasicAuthWorkerClient extends C7WorkerClient:

  protected def camundaRestUrl: String = "http://localhost:8080/engine-rest"

  lazy val client =
    ZIO.logInfo(
      s"Creating C7 ExternalTaskClient (Basic Auth) for $camundaRestUrl"
    ) *>
      ZIO.attempt:
        val encodedCredentials = encodeCredentials("admin", "admin")
        externalClient
          .customizeHttpClient: httpClientBuilder =>
            httpClientBuilder.setDefaultRequestConfig(RequestConfig.custom()
              .build())
              .setDefaultHeaders(List(new org.apache.hc.core5.http.message.BasicHeader(
                "Authorization",
                s"Basic $encodedCredentials"
              )).asJava)
          .build()
      .tap(_ => ZIO.logInfo("C7 ExternalTaskClient (Basic Auth) created successfully"))
        .tapError(err => ZIO.logError(s"Failed to create C7 ExternalTaskClient (Basic Auth): $err"))

  private def encodeCredentials(username: String, password: String): String =
    val credentials = s"$username:$password"
    Base64.getEncoder.encodeToString(credentials.getBytes)
end C7BasicAuthWorkerClient

trait OAuth2PasswordWorkerClient extends C7WorkerClient:
  given logger: OrchescalaLogger = Slf4JLogger.logger(getClass.getName)

  protected def oAuthConfig: OAuthConfig.PasswordGrant

  def retrieveToken(): ZIO[SttpClientBackend, WorkerError.ServiceAuthError, String] =
    passwordFlow.retrieveToken()
      .mapError(err => WorkerError.ServiceAuthError(s"Problem retrieving token: $err"))

  private def addAccessToken() = new HttpRequestInterceptor:
    override def process(request: HttpRequest, entity: EntityDetails, context: HttpContext): Unit =
      passwordFlow
        .retrieveTokenSync()
        .map: token =>
          logger.debug(s"Added Bearer Token to Request: ${token.take(20)}...${token.takeRight(10)}")
          request.addHeader("Authorization", s"Bearer $token")
        .left.map: error =>
          logger.error(error)
          // Still add a placeholder to make the failure explicit in logs
          request.addHeader("Authorization", "Bearer FAILED_TO_ACQUIRE_TOKEN")

  lazy val client: ZIO[SharedC7ExternalClientManager, Throwable, ExternalTaskClient] =
    SharedC7ExternalClientManager.getOrCreateClient:
      ZIO.logInfo(
        s"""Creating C7 ExternalTaskClient with OAuth2 for $camundaRestUrl
           |  - maxTasks: $maxTasks
           |  - lockDuration: ${lockDuration}ms (${lockDuration / 1000}s)
           |  - asyncResponseTimeout: ${asyncResponseTimeout.toSeconds}s  
           |  - maxTimeForAcquireJob: ${maxTimeForAcquireJob.toMillis}ms
           |""".stripMargin
      ) *>
        ZIO
          .attempt:
            externalClient
              .customizeHttpClient: httpClientBuilder =>
                httpClientBuilder
                  .addRequestInterceptorLast(addAccessToken())
                  .setConnectionManager(SharedHttpClientManager.connectionManager)
                  .build()
              .build()
          .tap(_ => ZIO.logInfo("C7 ExternalTaskClient created successfully"))
          .tapError(err => ZIO.logError(s"Failed to create C7 ExternalTaskClient: $err"))

  private lazy val passwordFlow = new PasswordGrantFlow(oAuthConfig)
end OAuth2PasswordWorkerClient
