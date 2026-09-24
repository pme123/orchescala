package orchescala.engine.c8

import orchescala.engine.AuthContext
import orchescala.engine.domain.EngineError
import orchescala.engine.rest.{HttpClientProvider, SttpClientBackend, TokenCache}
import io.circe.parser
import sttp.client3.*
import zio.*

import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/** How the engine services authenticate their REST calls to the Camunda 8 cluster.
  *
  * The `Authorization` header is resolved per request - no identity is ever fixed in a client
  * instance, so one shared connection pool serves every caller.
  */
trait C8RestAuth:
  /** The `Authorization` header value for the current request, if any. */
  def authorization: IO[EngineError, Option[String]]

  /** Called after a 401. Returns `true` if the credential was dropped and a retry with a fresh one
    * makes sense.
    */
  def invalidate: UIO[Boolean] = ZIO.succeed(false)
end C8RestAuth

object C8RestAuth:

  /** No authentication, e.g. a local c8run. */
  object NoAuth extends C8RestAuth:
    lazy val authorization: IO[EngineError, Option[String]] = ZIO.none

  /** Passes the caller's Bearer token (from [[AuthContext]]) through. Without a token the request
    * goes out unauthenticated - the cluster decides (usually 401).
    */
  object PassThrough extends C8RestAuth:
    lazy val authorization: IO[EngineError, Option[String]] =
      AuthContext.getBearerToken.map(_.map(token => s"Bearer $token"))

  /** OAuth2 client credentials (e.g. Camunda SaaS: `https://login.cloud.camunda.io/oauth/token`,
    * audience `zeebe.camunda.io`). The token is cached until shortly before it expires and
    * refreshed by one fiber at a time.
    */
  final class ClientCredentials(
      tokenUrl: String,
      clientId: String,
      clientSecret: String,
      audience: String,
      backend: => SttpClientBackend = HttpClientProvider.cachedBackend
  ) extends C8RestAuth:

    // token + the epoch millis until which it may be used
    private val cached      = AtomicReference[Option[(String, Long)]](None)
    private val refreshLock = Unsafe.unsafe(implicit unsafe => Semaphore.unsafe.make(1))

    lazy val authorization: IO[EngineError, Option[String]] =
      currentToken.map(token => Some(s"Bearer $token"))

    override lazy val invalidate: UIO[Boolean] =
      ZIO.succeed(cached.set(None)).as(true)

    private def validToken(now: Long): Option[String] =
      cached.get.collect { case (token, validUntil) if now < validUntil => token }

    private lazy val currentToken: IO[EngineError, String] =
      Clock.currentTime(TimeUnit.MILLISECONDS).flatMap: now =>
        validToken(now) match
          case Some(token) => ZIO.succeed(token)
          case None        =>
            // only one fiber fetches - the others wait and then take the fresh token
            refreshLock.withPermit:
              Clock.currentTime(TimeUnit.MILLISECONDS).flatMap: now =>
                validToken(now).fold(fetchToken(now))(ZIO.succeed(_))

    private def fetchToken(now: Long): IO[EngineError, String] =
      (for
        uri       <- ZIO.fromEither(sttp.model.Uri.parse(tokenUrl))
        response  <- basicRequest
                       .post(uri)
                       .body(
                         Map(
                           "grant_type"    -> "client_credentials",
                           "client_id"     -> clientId,
                           "client_secret" -> clientSecret,
                           "audience"      -> audience
                         )
                       )
                       .readTimeout(scala.concurrent.duration.Duration(10, TimeUnit.SECONDS))
                       .response(asStringAlways)
                       .send(backend)
        body      <- if response.code.isSuccess then ZIO.succeed(response.body)
                     else ZIO.fail(s"status ${response.code.code}: ${response.body.take(200)}")
        json      <- ZIO.fromEither(parser.parse(body))
        token     <- ZIO.fromEither(json.hcursor.get[String]("access_token"))
        expiresIn  = json.hcursor.get[Long]("expires_in").toOption
        _          = cached.set(Some(token -> (now + TokenCache.ttlFor(expiresIn).toMillis)))
        _         <- ZIO.logDebug(s"Fetched C8 client credentials token for '$clientId'")
      yield token)
        .mapError: err =>
          EngineError.ServiceError(
            s"Could not get a C8 client credentials token for '$clientId' from $tokenUrl: $err"
          )
  end ClientCredentials

end C8RestAuth
