package orchescala.gateway

import io.circe.parser.parse
import orchescala.domain.*
import orchescala.engine.rest.{OAuth2Flow, OAuthConfig}
import orchescala.gateway.GatewayError.ServiceRequestError
import sttp.client3.*
import sttp.model.Uri
import zio.*

import java.util.concurrent.atomic.{AtomicLong, AtomicReference}

/** The technical token of the gateway for public calls - fetched with the [[OAuthConfig]] and
  * kept until shortly before it expires, or until the engine rejects it ([[invalidate]] - at most every
  * [[minRefetchMillis]], so callers cannot drive the identity provider with rejected calls). One
  * fetch at a time; after a failed one, calls fail at once for [[retryAfterMillis]] - so anonymous
  * traffic does not hammer the identity provider.
  */
class PublicToken(login: OAuthConfig, now: () => Long = PublicAccess.monotonicMillis)
    extends OAuth2Flow:
  protected def identityUrl: Uri = login.identityUrl

  protected def retryAfterMillis: Long = 5 * 1000L
  // public calls wait for it - shorter than the 30 seconds for the engines
  override protected def tokenCallHardTimeout: scala.concurrent.duration.FiniteDuration =
    scala.concurrent.duration.FiniteDuration(10, "seconds")
  // kept at least that long (but not longer than the identity provider says) - a strange
  // expires_in of 0 does not make every call a login
  protected def minLifetimeSeconds: Long = 5
  // a token is dropped as rejected only if it is at least that old - so callers cannot force logins;
  // the price: a token rejected in its first 10 seconds (key rotation, revoked) fails the public
  // calls until then (503)
  protected def minRefetchMillis: Long   = 10 * 1000L

  // the token, until when it is valid, when it was fetched
  private val cached      = AtomicReference[Option[(String, Long, Long)]](None)
  // Long.MinValue: the monotonic clock can be negative - 0 would block the first logins
  private val failedUntil = AtomicLong(Long.MinValue)
  private val fetching    = Unsafe.unsafe(implicit u => Semaphore.unsafe.make(1))

  def token: IO[ServiceRequestError, String] =
    ZIO.suspendSucceed:
      current match
        case Some(token) => ZIO.succeed(token)
        // the others wait for the one fetching - and take its token
        case None        => fetching.withPermit(ZIO.suspendSucceed(current.fold(fetch)(ZIO.succeed(_))))

  /** The engine rejected this token (401) - the next call fetches a new one. False if it was kept
    * (another token, or younger than [[minRefetchMillis]]).
    */
  def invalidate(token: String): Boolean =
    val at = now()
    cached
      .getAndUpdate:
        case Some((t, _, fetchedAt)) if t == token && at - fetchedAt >= minRefetchMillis => None
        case c                                                                          => c
      .exists((t, _, fetchedAt) => t == token && at - fetchedAt >= minRefetchMillis)

  private def current: Option[String] =
    cached.get().collect { case (token, validUntil, _) if now() < validUntil => token }

  private def fetch: IO[ServiceRequestError, String] =
    if now() < failedUntil.get() then ZIO.fail(PublicAccess.unavailable)
    else
      requestToken
        .flatMap(raw => ZIO.fromEither(tokenOf(raw)))
        .tapError: detail =>
          ZIO.succeed(failedUntil.set(now() + retryAfterMillis)) *>
            ZIO.logError(s"Public access: the gateway cannot log in at $identityUrl: $detail")
        .mapError(_ => PublicAccess.unavailable)
        .flatMap: (token, expiresIn) =>
          ZIO.succeed:
            // renewed shortly before it expires - at most 30 seconds, at most half its time
            val margin   = (expiresIn / 2).min(30)
            // at least minLifetimeSeconds - but not longer than it lives (0: a strange answer)
            val floor    = if expiresIn > 0 then minLifetimeSeconds.min(expiresIn) else minLifetimeSeconds
            val validFor = (expiresIn - margin).max(floor)
            val at       = now()
            cached.set(Some((token, at + validFor * 1000, at)))
            token

  /** The raw answer of the identity provider - or what went wrong (for the log). */
  protected def requestToken: IO[String, String] =
    ZIO
      .attemptBlocking(withHardTimeout(tokenRequest.body(login.asMap).send(syncBackend).body))
      .mapError(e => Option(e.getMessage).getOrElse(e.toString))
      .flatMap:
        case Left(err)         => ZIO.fail(err)
        case Right(Left(err))  => ZIO.fail(err.take(200))
        case Right(Right(raw)) => ZIO.succeed(raw)

  private def tokenOf(raw: String): Either[String, (String, Long)] =
    parse(raw)
      .flatMap: json =>
        val c       = json.hcursor
        // a number, a decimal or a string - else 60 seconds (a strange expires_in is no failure)
        val expires = c.downField("expires_in").focus.flatMap: v =>
          v.asNumber.flatMap(_.toBigDecimal).orElse(v.asString.flatMap(_.trim.toDoubleOption.map(BigDecimal(_))))
            .map(_.toLong)
        // at most a day - a huge value would overflow to "expired" and make every call a login
        c.get[String]("access_token").map(_ -> expires.getOrElse(60L).max(0).min(24 * 3600L))
      .left.map(e => s"unexpected answer: ${e.getMessage}")
end PublicToken
