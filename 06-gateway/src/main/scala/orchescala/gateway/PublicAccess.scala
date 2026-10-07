package orchescala.gateway

import orchescala.domain.*
import orchescala.engine.rest.OAuthConfig
import orchescala.gateway.GatewayError.ServiceRequestError
import sttp.model.Header
import zio.*

/** What the gateway offers **without a Bearer token** (`/public/...`) - e.g. a booking form on the
  * homepage of a bank, used by customers that have no login.
  *
  * Only what is listed here is reachable; anything else under `/public` is a 404. Inside, the
  * gateway uses its own technical token ([[login]]) - the browser never gets a token. Against misuse:
  * a size limit for the body, a honeypot field (a hidden form field only bots fill in) and a rate
  * limit per client. The rate limit is a fallback - a fixed window per minute, so up to twice
  * [[requestsPerMinute]] at the turn of a minute, and per gateway instance (N replicas: N times);
  * in front of the gateway, an API gateway (e.g. Gravitee) should limit as well - with several
  * replicas it is required.
  *
  * A process started this way runs with the identity of the technical user - check the input like
  * any other untrusted input (its init worker does), and let a human see nothing before e.g. an
  * e-mail opt-in. A public message is correlated by its business key alone - make that key
  * unguessable (e.g. a random token in the opt-in link). The answer of a public worker goes to the
  * caller as it is - let it return only what anybody may see; a public start answers the
  * `ProcessInfo` (with the instance id - useless without a token).
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
    /** the header with the client address behind a proxy (e.g. `X-Forwarded-For`) - each proxy
      * appends the address it sees, so the entry [[trustedProxies]] from the end is the one the
      * outermost trusted proxy appended. Only set it if the proxies set the header and the gateway
      * is reachable through them only - else callers fake it and get a new limit with every call.
      * Without it, all clients behind a proxy count as one - one caller can then lock out all
      * (noted at startup).
      */
    clientIpHeader: Option[String] = None,
    /** the proxies in front of the gateway that append to [[clientIpHeader]] (e.g. 2 for a CDN and
      * a load balancer)
      */
    trustedProxies: Int = 1,
    /** the longest a public call may take (token, worker, engine) - then a 503 */
    callTimeout: Duration = 30.seconds,
    /** public calls at once on this gateway - more are a 503 at once, so slow workers or a slow
      * engine cannot pile up anonymous calls
      */
    maxConcurrentCalls: Int = 100
):
  require(trustedProxies >= 1, s"PublicAccess.trustedProxies must be at least 1 (is $trustedProxies).")

  lazy val isEmpty: Boolean = workers.isEmpty && processStarts.isEmpty && messages.isEmpty

  /** The client a call is counted for - the entry [[trustedProxies]] from the end of
    * [[clientIpHeader]] (the entries before it come from the client and can be faked), else the
    * remote address.
    */
  def client(remote: Option[String], headers: Seq[Header]): String =
    clientIpHeader
      // all lines of the header together - a proxy may add a line of its own instead of appending
      .map(h => headers.filter(_.name.equalsIgnoreCase(h)).flatMap(_.value.split(",")).map(_.trim).filter(_.nonEmpty))
      .flatMap(_.dropRight(trustedProxies - 1).lastOption)
      // only an address (IPv4 / IPv6) - anything else is no key for the rate limit
      .filter(PublicAccess.ipAddress.matches)
      .orElse(remote)
      .getOrElse("unknown")

  override def toString: String =
    s"PublicAccess(workers: ${workers.mkString(", ")}; processStarts: ${processStarts.mkString(", ")}; " +
      s"messages: ${messages.mkString(", ")}; ${requestsPerMinute}/min per client; " +
      s"at most $maxConcurrentCalls at once within ${callTimeout.render}; login: ${if login.isDefined then "yes" else "none"})"
end PublicAccess

object PublicAccess:
  val none: PublicAccess = PublicAccess()

  enum Kind:
    case worker, processStart, message

  /** The general variables ([[GeneralVariables]]) - a public call with one of them is refused. They
    * are read as top-level variables only (as process variables), so the top-level keys are checked.
    */
  val reservedFields: Set[String] = InputParams.values.map(_.toString).toSet

  /** Milliseconds for windows and lifetimes - monotonic, so a clock set back (NTP) stretches nothing. */
  val monotonicMillis: () => Long = () => java.lang.System.nanoTime() / 1_000_000

  /** A name from a caller as it may go into the log - no line breaks or other tricks, at most 80. */
  def loggable(name: String): String =
    name.take(80).map(c => if c.isLetterOrDigit || "._-".contains(c) then c else '?')

  /** What an IPv4 or IPv6 address can look like - short, no names. */
  val ipAddress = "[0-9A-Fa-f:.]{2,45}".r

  /** A text that may contain what a caller sent (e.g. the error of a worker) as one log line. */
  def oneLine(text: String, max: Int = 300): String =
    Option(text).mkString.take(max).map(c => if c.isControl then ' ' else c)

  /** A business key as a public caller may send it - letters, digits and `._:@+-`, at most 128. */
  val businessKeyPattern = "[A-Za-z0-9._:@+-]{1,128}".r

  /** A public message is correlated by its business key alone - so the keys of public starts and
    * messages must not be short (a UUID has 36): a caller cannot pick a short, predictable key at the
    * start. Best is a key the server generates (e.g. a worker before the start).
    */
  val minPublicKeyLength = 16

  /** What an anonymous caller gets when something inside fails - the detail goes to the log only. */
  val unavailable: ServiceRequestError =
    ServiceRequestError(503, "Not available right now - please try again later.")

  /** What an anonymous caller gets when a worker or the engine refuses the call (4xx) - the status
    * stays (a page can show its own text for it), the detail goes to the log only.
    */
  def refused(status: Int): ServiceRequestError =
    ServiceRequestError(status, "The request was refused.")
end PublicAccess
