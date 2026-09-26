package orchescala.worker.op

import orchescala.domain.OrchescalaLogger
import orchescala.engine.Slf4JLogger
import orchescala.engine.rest.{OAuthConfig, PasswordGrantFlow, SttpClientBackend}
import orchescala.worker.WorkerError
import org.apache.hc.client5.http.config.RequestConfig
import org.apache.hc.core5.http.*
import org.apache.hc.core5.http.protocol.HttpContext
import org.operaton.bpm.client.ExternalTaskClient
import com.github.blemale.scaffeine.Scaffeine
import orchescala.engine.rest.HttpClientProvider
import org.operaton.bpm.client.backoff.ExponentialBackoffStrategy
import sttp.client3.*
import sttp.model.{Header, Uri}
import zio.{IO, ZIO}

import java.util.Base64
import scala.concurrent.duration.*
import scala.jdk.CollectionConverters.*

trait OpWorkerClient:
  def client: ZIO[SharedOpExternalClientManager, Throwable, ExternalTaskClient]

  protected def operatonRestUrl: String
  protected def maxTimeForAcquireJob: Duration = 500.millis
  protected def asyncResponseTimeout: Duration = 15.seconds
  protected def lockDuration: Duration         = 30.seconds
  protected def maxTasks: Int                  = 10

  /** Jobs the workers of this client run at once - the tasks one fetch returns at most. */
  def maxParallelJobs: Int = maxTasks

  /** Authorization header for the engine's REST API (root process instance lookup). */
  protected def engineAuthorization: Option[String] = None

  // a root never changes - bounded, so a long-running worker app does not grow without end
  private lazy val rootProcessInstances =
    Scaffeine().maximumSize(10_000).expireAfterWrite(1.hour).build[String, String]()

  /** The root process instance of a process instance, from the history API - only needed for jobs
    * in call activities, whose IdentityCorrelation is bound to the root (see
    * `IdentityVerification.verifyBinding`). Cached.
    */
  def rootProcessInstanceId(processInstanceId: String): IO[String, Option[String]] =
    rootProcessInstances.getIfPresent(processInstanceId) match
      case Some(root) => ZIO.some(root)
      case None       =>
        (for
          uri      <- ZIO.fromEither(Uri.parse(operatonRestUrl.stripSuffix("/")))
                        .map(_.addPath("history", "process-instance", processInstanceId))
          response <- basicRequest
                        .get(uri)
                        .headers(engineAuthorization.map(Header("Authorization", _)).toSeq*)
                        .readTimeout(10.seconds)
                        .response(asStringAlways)
                        .send(HttpClientProvider.cachedBackend)
                        .mapError(_.toString)
          body     <- if response.code.isSuccess then ZIO.succeed(response.body)
                      else ZIO.fail(s"status ${response.code.code}")
          root     <- ZIO.fromEither(
                        _root_.io.circe.parser.parse(body)
                          .flatMap(_.hcursor.get[Option[String]]("rootProcessInstanceId"))
                      ).mapError(_.toString)
          _         = root.foreach(rootProcessInstances.put(processInstanceId, _))
        yield root)
          .mapError(err => s"Root process instance of '$processInstanceId' not found: $err")
  end rootProcessInstanceId

  protected def externalClient = ExternalTaskClient.create()
    .baseUrl(operatonRestUrl)
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
end OpWorkerClient

object OpNoAuthWorkerClient$ extends OpWorkerClient:

  protected def operatonRestUrl: String = "http://localhost:8887/engine-rest"

  def client: ZIO[SharedOpExternalClientManager, Throwable, ExternalTaskClient] =
    SharedOpExternalClientManager.getOrCreateClient:
      ZIO.logInfo(
        "Creating Op ExternalTaskClient (No Auth) for http://localhost:8887/engine-rest"
      ) *>
        ZIO
          .attempt:
            externalClient
              .customizeHttpClient: httpClientBuilder =>
                httpClientBuilder.setDefaultRequestConfig(RequestConfig.custom()
                  // .setResponseTimeout(Timeout.ofSeconds(15))
                  .build())
              .build()
          .tapBoth(
            err => ZIO.logError(s"Failed to create Op ExternalTaskClient (No Auth): $err"),
            _ => ZIO.logInfo("Op ExternalTaskClient (No Auth) created successfully")
          )
end OpNoAuthWorkerClient$

object OpBasicAuthWorkerClient$ extends OpWorkerClient:

  protected def operatonRestUrl: String = "http://localhost:8080/engine-rest"

  lazy val client =
    ZIO.logInfo(
      s"Creating Op ExternalTaskClient (Basic Auth) for $operatonRestUrl"
    ) *>
      ZIO
        .attempt:
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
        .tapBoth(
          err => ZIO.logError(s"Failed to create Op ExternalTaskClient (Basic Auth): $err"),
          _ => ZIO.logInfo("Op ExternalTaskClient (Basic Auth) created successfully")
        )

  private def encodeCredentials(username: String, password: String): String =
    val credentials = s"$username:$password"
    Base64.getEncoder.encodeToString(credentials.getBytes)
end OpBasicAuthWorkerClient$

trait OAuth2PasswordWorkerClient extends OpWorkerClient:
  given logger: OrchescalaLogger = Slf4JLogger.logger(getClass.getName)

  protected def oAuthConfig: OAuthConfig.PasswordGrant

  override protected def engineAuthorization: Option[String] =
    passwordFlow.cachedToken.map(token => s"Bearer $token")

  def retrieveToken(): ZIO[SttpClientBackend, WorkerError.ServiceAuthError, String] =
    passwordFlow.retrieveToken()
      .mapError(err => WorkerError.ServiceAuthError(s"Problem retrieving token: $err"))

  private def addAccessToken() = new HttpRequestInterceptor:
    override def process(request: HttpRequest, entity: EntityDetails, context: HttpContext): Unit =
      // NO network I/O here: since httpclient5 5.4 request interceptors run AFTER a pooled
      // connection is leased - a blocking token call here holds the lease and exhausts the pool
      // (ConnectionRequestTimeoutException on fetchAndLock, worker never recovers)
      passwordFlow.cachedToken match
        case Some(token) =>
          request.addHeader("Authorization", s"Bearer $token")
        case None        =>
          throw new org.apache.hc.core5.http.HttpException(
            s"No OAuth2 token available for TopicSubscriptionManager (is the identity provider down?)"
          )

  lazy val client: ZIO[SharedOpExternalClientManager, Throwable, ExternalTaskClient] =
    SharedOpExternalClientManager.getOrCreateClient:
      ZIO.logInfo(
        s"""Creating Op ExternalTaskClient with OAuth2 for $operatonRestUrl
           |  - maxTasks: $maxTasks
           |  - lockDuration: ${lockDuration}ms (${lockDuration / 1000}s)
           |  - asyncResponseTimeout: ${asyncResponseTimeout.toSeconds}s  
           |  - maxTimeForAcquireJob: ${maxTimeForAcquireJob.toMillis}ms
           |""".stripMargin
      ) *>
        ZIO
          .attempt:
            // keeps the token cache warm, so request interceptors never do network I/O
            passwordFlow.startBackgroundRefresh()
            externalClient
              .customizeHttpClient: httpClientBuilder =>
                httpClientBuilder
                  .addRequestInterceptorLast(addAccessToken())
                  .setConnectionManager(SharedHttpClientManager.connectionManager)
                  // the manager is shared - closing this client must not close the manager
                  .setConnectionManagerShared(true)
                  .setDefaultRequestConfig(RequestConfig.custom()
                    // fail fast on pool contention instead of blocking the default 3 minutes,
                    // so the backoff strategy can retry quickly
                    .setConnectionRequestTimeout(org.apache.hc.core5.util.Timeout.ofSeconds(10))
                    .build())
              .build()
          .tapBoth(
            err => ZIO.logError(s"Failed to create Op ExternalTaskClient: $err"),
            _ => ZIO.logInfo("Op ExternalTaskClient created successfully")
          )

  private lazy val passwordFlow = new PasswordGrantFlow(oAuthConfig)
end OAuth2PasswordWorkerClient
