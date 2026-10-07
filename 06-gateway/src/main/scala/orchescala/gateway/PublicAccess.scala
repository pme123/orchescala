package orchescala.gateway

import io.circe.parser.parse
import orchescala.domain.*
import orchescala.engine.rest.{OAuth2Flow, OAuthConfig}
import orchescala.gateway.GatewayError.ServiceRequestError
import sttp.client3.*
import sttp.model.{Header, Uri}
import zio.*

import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.{AtomicLong, AtomicReference}

/** What the gateway offers **without a Bearer token** (`/public/...`) - e.g. a booking form on the
  * homepage of a bank, used by customers that have no login.
  *
  * Only what is listed here is reachable; anything else under `/public` is a 404. Inside, the
  * gateway uses its own technical token ([[login]]) - the browser never gets a token. Against misuse:
  * a size limit for the body, a honeypot field (a hidden form field only bots fill in) and a rate
  * limit per client. The rate limit is a fallback - in front of the gateway, an API gateway (e.g.
  * Gravitee) should limit as well.
  *
  * A process started this way runs with the identity of the technical user - check the input like
  * any other untrusted input (its init worker does), and let a human see nothing before e.g. an
  * e-mail opt-in.
  */
case class PublicAccess(
    /** worker topics that may be called (`POST /public/worker/{topic}`) */
    workers: Set[String] = Set.empty,
    /** processes that may be started (`POST /public/process/{key}/async`) */
    processStarts: Set[String] = Set.empty,
    /** messages that may be sent (`POST /public/message/{name}`) */
    messages: Set[String] = Set.empty,
    /** the login of the gateway for public calls - client credentials or password grant */
    login: Option[OAuthConfig] = None,
    /** calls per client and minute - more get a 429 */
    requestsPerMinute: Int = 30,
    /** the largest body in bytes - a bigger one is a 413, before it is read completely */
    maxBodyBytes: Int = 16 * 1024,
    /** a field of the body that must be empty - a hidden form field only bots fill in; it is
      * removed before the call is forwarded. None: no honeypot.
      */
    honeypotField: Option[String] = Some("_hp"),
    /** the header with the client address behind a proxy (e.g. `X-Forwarded-For`, first entry) -
      * only set it if the proxy sets the header itself, else clients can fake it.
      */
    clientIpHeader: Option[String] = None
):
  lazy val isEmpty: Boolean = workers.isEmpty && processStarts.isEmpty && messages.isEmpty

  /** The client a call is counted for - the first entry of [[clientIpHeader]], else the remote
    * address.
    */
  def client(remote: Option[String], headers: Seq[Header]): String =
    clientIpHeader
      .flatMap(h => headers.find(_.name.equalsIgnoreCase(h)))
      .map(_.value.split(",").head.trim)
      .filter(_.nonEmpty)
      .orElse(remote)
      .getOrElse("unknown")

  override def toString: String =
    s"PublicAccess(workers: ${workers.mkString(", ")}; processStarts: ${processStarts.mkString(", ")}; " +
      s"messages: ${messages.mkString(", ")}; ${requestsPerMinute}/min per client)"
end PublicAccess

object PublicAccess:
  val none: PublicAccess = PublicAccess()

  enum Kind:
    case worker, processStart, message

  /** What an anonymous caller gets when something inside fails - the detail goes to the log only. */
  val unavailable: ServiceRequestError =
    ServiceRequestError(503, "Not available right now - please try again later.")
end PublicAccess

/** Checks a public call before it is forwarded - see [[PublicAccess]]. The size of the body is
  * limited by the endpoints themselves (see [[PublicRoutes]]).
  *
  * @param maxClients
  *   the most clients counted at once - a new client beyond is a 429 (it fails closed), so rotating
  *   addresses cannot grow the map without bound
  */
class PublicGuard(
    access: PublicAccess,
    now: () => Long = () => java.lang.System.currentTimeMillis(),
    maxClients: Int = 100_000
):
  import PublicAccess.Kind

  private val windowMillis = 60 * 1000L
  // per client: start of its minute and the calls in it
  private val calls        = ConcurrentHashMap[String, (Long, Int)]()
  private val lastSweep    = AtomicLong(now())

  /** The body to forward (without the honeypot field) - or why the call is refused. */
  def check(kind: Kind, name: String, client: String, body: Json): Either[ServiceRequestError, Json] =
    val allowed = kind match
      case Kind.worker       => access.workers
      case Kind.processStart => access.processStarts
      case Kind.message      => access.messages
    // the limit first - it counts calls of unknown names as well (someone scanning)
    if !withinLimit(client) then Left(ServiceRequestError(429, "Too many requests - please try again later."))
    else if !allowed.contains(name) then Left(ServiceRequestError(404, "Not Found"))
    else withoutHoneypot(body)
  end check

  private def withoutHoneypot(body: Json): Either[ServiceRequestError, Json] =
    (access.honeypotField, body.asObject) match
      case (Some(field), Some(obj)) =>
        val empty = obj(field).forall(v => v.isNull || v.asString.exists(_.isEmpty))
        if empty then Right(Json.fromJsonObject(obj.remove(field)))
        else Left(ServiceRequestError(400, "The request is not valid."))
      case _                        => Right(body)

  private def withinLimit(client: String): Boolean =
    val at = now()
    sweep(at)
    if calls.size >= maxClients && !calls.containsKey(client) then false
    else
      val (_, count) = calls.compute(
        client,
        (_, last) =>
          if last == null || last._1 < at - windowMillis then (at, 1)
          else (last._1, last._2 + 1)
      )
      count <= access.requestsPerMinute
  end withinLimit

  /** Removes the clients of past minutes - at most once a minute, by one caller. */
  private def sweep(at: Long): Unit =
    val last = lastSweep.get()
    if at - last >= windowMillis && lastSweep.compareAndSet(last, at) then
      calls.entrySet.removeIf(_.getValue._1 < at - windowMillis): Unit

  private[gateway] def clients: Int = calls.size
end PublicGuard

/** The technical token of the gateway for public calls - fetched with the [[OAuthConfig]] and
  * kept until shortly before it expires. One fetch at a time; after a failed one, calls fail at once
  * for [[retryAfterMillis]] - so anonymous traffic does not hammer the identity provider.
  */
class PublicToken(login: OAuthConfig, now: () => Long = () => java.lang.System.currentTimeMillis())
    extends OAuth2Flow:
  protected def identityUrl: Uri = login.identityUrl

  protected def retryAfterMillis: Long = 5 * 1000L

  private val cached      = AtomicReference[Option[(String, Long)]](None)
  private val failedUntil = AtomicLong(0L)
  private val fetching    = Unsafe.unsafe(implicit u => Semaphore.unsafe.make(1))

  def token: IO[ServiceRequestError, String] =
    ZIO.suspendSucceed:
      current match
        case Some(token) => ZIO.succeed(token)
        // the others wait for the one fetching - and take its token
        case None        => fetching.withPermit(ZIO.suspendSucceed(current.fold(fetch)(ZIO.succeed(_))))

  private def current: Option[String] =
    cached.get().collect { case (token, validUntil) if now() < validUntil => token }

  private def fetch: IO[ServiceRequestError, String] =
    if now() < failedUntil.get() then ZIO.fail(PublicAccess.unavailable)
    else
      requestToken
        .flatMap(raw => ZIO.fromEither(tokenOf(raw)))
        .tapError: detail =>
          ZIO.succeed(failedUntil.set(now() + retryAfterMillis)) *>
            ZIO.logError(s"Public access: the gateway cannot log in at $identityUrl: $detail")
        .mapBoth(
          _ => PublicAccess.unavailable,
          (token, expiresIn) =>
            // renewed shortly before it expires - at most 30 seconds, at most half its time
            val margin = (expiresIn / 2).min(30)
            cached.set(Some(token -> (now() + (expiresIn - margin) * 1000)))
            token
        )

  /** The raw answer of the identity provider - or what went wrong (for the log). */
  protected def requestToken: IO[String, String] =
    ZIO
      .attemptBlocking(withHardTimeout(tokenRequest.body(login.asMap).send(syncBackend).body))
      .mapError(_.getMessage)
      .flatMap:
        case Left(err)         => ZIO.fail(err)
        case Right(Left(err))  => ZIO.fail(err.take(200))
        case Right(Right(raw)) => ZIO.succeed(raw)

  private def tokenOf(raw: String): Either[String, (String, Long)] =
    parse(raw)
      .flatMap: json =>
        val c = json.hcursor
        for
          token   <- c.get[String]("access_token")
          expires <- c.get[Option[Long]]("expires_in")
        yield token -> expires.getOrElse(60L).max(0)
      .left.map(e => s"unexpected answer: ${e.getMessage}")
end PublicToken
