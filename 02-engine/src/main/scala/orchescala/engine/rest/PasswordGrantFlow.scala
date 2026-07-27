package orchescala.engine.rest

import orchescala.domain.OrchescalaLogger
import orchescala.engine.domain.EngineError.ServiceError
import sttp.client3.*
import sttp.client3.circe.asJson
import zio.ZIO

import java.util.concurrent.atomic.AtomicReference
import java.util.concurrent.{ConcurrentHashMap, Executors, ScheduledExecutorService, TimeUnit}
import scala.concurrent.duration.*

trait PasswordGrantFlowable extends OAuth2Flow:
  def config: OAuthConfig.PasswordGrant
  def retrieveTokenSync()(using logger: OrchescalaLogger): Either[ServiceError, String]
  def retrieveToken(): ZIO[SttpClientBackend, ServiceError, String]

class PasswordGrantFlow(val config: OAuthConfig.PasswordGrant) extends PasswordGrantFlowable:

  /** Last successfully retrieved token. Kept even after the cache entry expired, so requests can
    * still be authorized while the identity provider is down (the server may still accept the
    * token - otherwise it answers 401 and the client backs off and retries).
    */
  private val lastToken = new AtomicReference[Option[String]](None)

  /** Non-blocking token access - NO network I/O. Safe to call from HTTP request interceptors that
    * hold a leased pool connection.
    */
  def cachedToken: Option[String] =
    TokenCache.get(username).orElse(lastToken.get())

  /** Starts a daemon thread that periodically refreshes the token, so [[cachedToken]] is always
    * warm and no request thread ever has to fetch a token itself. Idempotent per JVM:
    * only one refresher runs per identity provider + username, no matter how many flow
    * instances are created over time.
    */
  def startBackgroundRefresh(interval: FiniteDuration = 60.seconds)(using
      logger: OrchescalaLogger
  ): Unit =
    PasswordGrantFlow.refreshers.computeIfAbsent(
      refresherKey,
      _ =>
        logger.info(s"Starting background token refresh for '$username' every $interval")
        val scheduler = Executors.newSingleThreadScheduledExecutor { r =>
          val t = new Thread(r, s"oauth2-token-refresh-$username")
          t.setDaemon(true)
          t
        }
        scheduler.scheduleWithFixedDelay(
          () =>
            // never throw: an escaping exception would silently cancel the scheduled task
            try
              refreshToken() match
                case Right(_)  => () // success already logged
                case Left(err) =>
                  logger.warn(s"Background token refresh for '$username' failed: ${err.errorMsg}")
            catch
              case ex: Throwable =>
                logger.warn(s"Background token refresh for '$username' failed unexpectedly: $ex")
          ,
          0,
          interval.toMillis,
          TimeUnit.MILLISECONDS
        )
        scheduler
    )
    ()
  end startBackgroundRefresh

  /** Stops the background refresher of this identity provider + username (if running). */
  def stopBackgroundRefresh(): Unit =
    Option(PasswordGrantFlow.refreshers.remove(refresherKey))
      .foreach(_.shutdownNow())

  private lazy val refresherKey = s"$identityUrl|$username"

  /** Fetches a fresh token (ignoring the cache) and stores it in the cache and as last token. The
    * call is bounded by [[tokenCallHardTimeout]] - it can never block indefinitely.
    */
  def refreshToken()(using logger: OrchescalaLogger): Either[ServiceError, String] =
    withHardTimeout(authResponse)
      .flatMap(_.body.left.map(_.toString))
      .left
      .map(err => ServiceError(s"Could not get a token for '$username'!\n$err"))
      .map: tokenResponse =>
        val token = tokenResponse.access_token
        logger.info(
          s"Added Token to Cache: $username - ${token.take(5)}...${token.takeRight(5)} " +
            s"(expires_in: ${tokenResponse.expires_in.getOrElse("-")}s)"
        )
        TokenCache.put(username, token, tokenResponse.expires_in)
        lastToken.set(Some(token))
        token

  def retrieveTokenSync()(using logger: OrchescalaLogger): Either[ServiceError, String] =
    TokenCache.get(username)
      .map: token =>
        logger.debug(s"Admin Token from Cache: $username")
        Right(token)
      .getOrElse:
        refreshToken()

  def retrieveToken(): ZIO[SttpClientBackend, ServiceError, String] =
    ZIO.fromOption(TokenCache.get(username))
      .zipLeft(ZIO.logDebug(s"Admin Token from Cache: $username"))
      .orElse:
        ZIO.serviceWithZIO[SttpClientBackend]: backend =>
          ZIO.logDebug(s"PasswordGrantFlow: Requesting Token for: ${config.toString}") *>
            tokenRequest.body(requestBody)
              .response(asJson[TokenResponse])
              .send(backend)
              .map(_.body)
              .flatMap(ZIO.fromEither)
              .mapError(err =>
                ServiceError(
                  s"Could not get a token for '$username'!\n$err"
                )
              )
              .flatMap: tokenResponse =>
                val token = tokenResponse.access_token
                ZIO.logInfo(
                  s"Added Admin Token to Cache: $username - ${token.take(5)}...${token.takeRight(5)}"
                ).as {
                  TokenCache.put(username, token, tokenResponse.expires_in)
                  lastToken.set(Some(token))
                  token
                }

  protected def identityUrl    = config.identityUrl
  private lazy val username    = config.username
  private lazy val requestBody = config.asMap

  private def authResponse =
    tokenRequest.body(requestBody).response(asJson[TokenResponse]).send(syncBackend)

end PasswordGrantFlow

object PasswordGrantFlow:
  // one background refresher per identity provider + username per JVM -
  // repeated client creations (restarts, simulations) must not accumulate threads
  private val refreshers = new ConcurrentHashMap[String, ScheduledExecutorService]()
end PasswordGrantFlow
