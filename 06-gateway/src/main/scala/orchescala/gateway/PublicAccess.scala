package orchescala.gateway

import io.circe.parser.parse
import orchescala.domain.*
import orchescala.engine.rest.{OAuth2Flow, OAuthConfig}
import orchescala.gateway.GatewayError.ServiceRequestError
import sttp.client3.*
import sttp.model.{Header, Uri}
import zio.*

import java.util.concurrent.atomic.{AtomicLong, AtomicReference}

/** What the gateway offers **without a Bearer token** (`/public/...`) - e.g. a booking form on the
  * homepage of a bank, used by customers that have no login.
  *
  * Only what is listed here is reachable; anything else under `/public` is a 404. Inside, the
  * gateway uses its own technical token ([[login]]) - the browser never gets a token. Against misuse:
  * a size limit for the body, a honeypot field (a hidden form field only bots fill in) and a rate
  * limit per client. The rate limit is a fallback - a fixed window per minute, so up to twice
  * [[requestsPerMinute]] at the turn of a minute; in front of the gateway, an API gateway (e.g.
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
    /** the header with the client address behind a proxy (e.g. `X-Forwarded-For`) - its **last**
      * entry, the one the proxy in front of the gateway appended. Only set it if that proxy sets the
      * header; behind several proxies, name a header the outermost one sets (e.g. `X-Real-IP`).
      * Without it, all clients behind a proxy count as one.
      */
    clientIpHeader: Option[String] = None
):
  lazy val isEmpty: Boolean = workers.isEmpty && processStarts.isEmpty && messages.isEmpty

  /** The client a call is counted for - the last entry of [[clientIpHeader]] (the entries before it
    * come from the client and can be faked), else the remote address.
    */
  def client(remote: Option[String], headers: Seq[Header]): String =
    clientIpHeader
      .flatMap(h => headers.find(_.name.equalsIgnoreCase(h)))
      .flatMap(_.value.split(",").map(_.trim).filter(_.nonEmpty).lastOption)
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

  /** The general variables ([[GeneralVariables]]) - a public call with one of them is refused. */
  val reservedFields: Set[String] = InputParams.values.map(_.toString).toSet

  /** What an anonymous caller gets when something inside fails - the detail goes to the log only. */
  val unavailable: ServiceRequestError =
    ServiceRequestError(503, "Not available right now - please try again later.")

  /** What an anonymous caller gets when a worker or the engine refuses the call (4xx) - the status
    * stays (a page can show its own text for it), the detail goes to the log only.
    */
  def refused(status: Int): ServiceRequestError =
    ServiceRequestError(status, "The request was refused.")
end PublicAccess

/** Checks a public call before it is forwarded - see [[PublicAccess]]: first [[admit]] (rate limit,
  * allow list - before the body is read), then [[body]].
  *
  * @param maxClients
  *   the most clients counted at once - beyond, the client used least recently is forgotten (its
  *   count starts anew), so rotating addresses can neither grow the map without bound nor lock out
  *   others
  */
class PublicGuard(
    access: PublicAccess,
    now: () => Long = () => java.lang.System.currentTimeMillis(),
    maxClients: Int = 100_000
):
  import PublicAccess.Kind

  private val windowMillis = 60 * 1000L

  // per client: start of its minute and the calls in it - the least recently used first
  private val calls = new java.util.LinkedHashMap[String, (Long, Int)](16, 0.75f, true):
    override def removeEldestEntry(eldest: java.util.Map.Entry[String, (Long, Int)]): Boolean =
      val full = size > maxClients
      if full then forgotten += 1
      full

  // all under the lock of calls
  private var lastSweep            = now()
  private var forgotten            = 0L
  private var report: Option[Long] = None

  /** May the client call this - before anything of the body is read. */
  def admit(kind: Kind, name: String, client: String): Either[ServiceRequestError, Unit] =
    val allowed = kind match
      case Kind.worker       => access.workers
      case Kind.processStart => access.processStarts
      case Kind.message      => access.messages
    // the limit first - it counts calls of unknown names as well (someone scanning)
    if !withinLimit(client) then Left(ServiceRequestError(429, "Too many requests - please try again later."))
    else if !allowed.contains(name) then Left(ServiceRequestError(404, "Not Found"))
    else Right(())
  end admit

  /** The body to forward - a JSON object (empty if none is sent), without the honeypot field. */
  def body(raw: String): Either[ServiceRequestError, JsonObject] =
    for
      json  <- if raw.isBlank then Right(Json.obj())
               else parse(raw).left.map(_ => ServiceRequestError(400, "The request is not valid JSON."))
      obj   <- json.asObject.toRight(ServiceRequestError(400, "The request must be a JSON object."))
      clean <- withoutHoneypot(obj)
      _     <- withoutReserved(clean)
    yield clean

  /** [[admit]] and [[body]] in one. */
  def check(kind: Kind, name: String, client: String, raw: String): Either[ServiceRequestError, Json] =
    admit(kind, name, client).flatMap(_ => body(raw)).map(Json.fromJsonObject)

  /** How many clients were forgotten in the last minute because of [[maxClients]] - once after each
    * minute with any (for a warning in the log).
    */
  def forgottenReport(): Option[Long] =
    calls.synchronized:
      val r = report
      report = None
      r

  private def withoutHoneypot(obj: JsonObject): Either[ServiceRequestError, JsonObject] =
    access.honeypotField match
      case Some(field) =>
        val empty = obj(field).forall(v => v.isNull || v.asString.exists(_.isEmpty))
        if empty then Right(obj.remove(field))
        else Left(ServiceRequestError(400, "The request is not valid."))
      case None        => Right(obj)

  /** The variables that steer a process or worker (mocking, output mapping, identity, ...) - never
    * from an anonymous caller.
    */
  private def withoutReserved(obj: JsonObject): Either[ServiceRequestError, Unit] =
    obj.keys.find(PublicAccess.reservedFields) match
      case Some(field) => Left(ServiceRequestError(400, s"The field '$field' is not allowed here."))
      case None        => Right(())

  private def withinLimit(client: String): Boolean =
    val at = now()
    calls.synchronized:
      sweep(at)
      val (start, count) = Option(calls.get(client)) match
        case Some((start, n)) if start >= at - windowMillis => (start, n + 1)
        case _                                              => (at, 1)
      calls.put(client, start -> count)
      count <= access.requestsPerMinute
  end withinLimit

  /** Removes the clients of past minutes - at most once a minute (under the lock). */
  private def sweep(at: Long): Unit =
    if at - lastSweep >= windowMillis then
      lastSweep = at
      calls.values.removeIf(_._1 < at - windowMillis)
      if forgotten > 0 then report = Some(forgotten)
      forgotten = 0

  private[gateway] def clients: Int = calls.synchronized(calls.size)
end PublicGuard

/** The technical token of the gateway for public calls - fetched with the [[OAuthConfig]] and
  * kept until shortly before it expires, or until a call is refused with it ([[invalidate]]). One
  * fetch at a time; after a failed one, calls fail at once for [[retryAfterMillis]] - so anonymous
  * traffic does not hammer the identity provider.
  */
class PublicToken(login: OAuthConfig, now: () => Long = () => java.lang.System.currentTimeMillis())
    extends OAuth2Flow:
  protected def identityUrl: Uri = login.identityUrl

  protected def retryAfterMillis: Long = 5 * 1000L
  // kept at least that long - also if the identity provider says 0 (a refused call drops it earlier)
  protected def minLifetimeSeconds: Long = 5

  private val cached      = AtomicReference[Option[(String, Long)]](None)
  private val failedUntil = AtomicLong(0L)
  private val fetching    = Unsafe.unsafe(implicit u => Semaphore.unsafe.make(1))

  def token: IO[ServiceRequestError, String] =
    ZIO.suspendSucceed:
      current match
        case Some(token) => ZIO.succeed(token)
        // the others wait for the one fetching - and take its token
        case None        => fetching.withPermit(ZIO.suspendSucceed(current.fold(fetch)(ZIO.succeed(_))))

  /** The engine or a worker refused this token (401 / 403) - the next call fetches a new one. */
  def invalidate(token: String): Unit =
    cached.getAndUpdate(c => if c.exists(_._1 == token) then None else c): Unit

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
            val margin   = (expiresIn / 2).min(30)
            val validFor = (expiresIn - margin).max(minLifetimeSeconds)
            cached.set(Some(token -> (now() + validFor * 1000)))
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
