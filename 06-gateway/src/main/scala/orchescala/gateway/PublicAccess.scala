package orchescala.gateway

import io.circe.parser.parse
import orchescala.domain.*
import orchescala.engine.rest.{OAuth2Flow, OAuthConfig}
import orchescala.gateway.GatewayError.ServiceRequestError
import sttp.client3.*
import sttp.model.Uri
import zio.*

import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicReference

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
    /** the largest body (bytes of its JSON) - a bigger one is a 413 */
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

  override def toString: String =
    s"PublicAccess(workers: ${workers.mkString(", ")}; processStarts: ${processStarts.mkString(", ")}; " +
      s"messages: ${messages.mkString(", ")}; ${requestsPerMinute}/min per client)"
end PublicAccess

object PublicAccess:
  val none: PublicAccess = PublicAccess()

  enum Kind:
    case worker, processStart, message
end PublicAccess

/** Checks a public call before it is forwarded - see [[PublicAccess]]. */
class PublicGuard(access: PublicAccess, now: () => Long = () => java.lang.System.currentTimeMillis()):
  import PublicAccess.Kind

  private val windowMillis = 60 * 1000L
  // per client: start of its minute and the calls in it
  private val calls        = ConcurrentHashMap[String, (Long, Int)]()

  /** The body to forward (without the honeypot field) - or why the call is refused. */
  def check(kind: Kind, name: String, client: String, body: Json): Either[ServiceRequestError, Json] =
    val allowed = kind match
      case Kind.worker       => access.workers
      case Kind.processStart => access.processStarts
      case Kind.message      => access.messages
    // the limit first - it counts calls of unknown names as well (someone scanning)
    if !withinLimit(client) then Left(ServiceRequestError(429, "Too many requests - please try again later."))
    else if !allowed.contains(name) then Left(ServiceRequestError(404, "Not Found"))
    else if body.noSpaces.getBytes("UTF-8").length > access.maxBodyBytes then
      Left(ServiceRequestError(413, s"The request is too large (at most ${access.maxBodyBytes} bytes)."))
    else
      access.honeypotField match
        case None        => Right(body)
        case Some(field) =>
          body.asObject match
            case Some(obj) if obj(field).exists(v => !(v.isNull || v.asString.contains(""))) =>
              Left(ServiceRequestError(400, "The request is not valid."))
            case Some(obj)                                                                    => Right(Json.fromJsonObject(obj.remove(field)))
            case None                                                                         => Right(body)
  end check

  private def withinLimit(client: String): Boolean =
    val at = now()
    if calls.size > 10000 then calls.entrySet.removeIf(_.getValue._1 < at - windowMillis): Unit
    val (_, count) = calls.compute(
      client,
      (_, last) =>
        if last == null || last._1 < at - windowMillis then (at, 1)
        else (last._1, last._2 + 1)
    )
    count <= access.requestsPerMinute
  end withinLimit
end PublicGuard

/** The technical token of the gateway for public calls - fetched with the [[OAuthConfig]] and
  * kept until shortly before it expires.
  */
class PublicToken(login: OAuthConfig) extends OAuth2Flow:
  protected def identityUrl: Uri = login.identityUrl

  private val cached = AtomicReference[Option[(String, Long)]](None)

  def token: IO[ServiceRequestError, String] =
    ZIO.succeed(cached.get()).flatMap:
      case Some((token, validUntil)) if java.lang.System.currentTimeMillis() < validUntil => ZIO.succeed(token)
      case _                                                                              => fetch

  private def fetch: IO[ServiceRequestError, String] =
    ZIO
      .attemptBlocking(withHardTimeout(tokenRequest.body(login.asMap).send(syncBackend).body))
      .mapError(e => ServiceRequestError(503, s"The gateway cannot log in: ${e.getMessage}"))
      .flatMap:
        case Left(err)         => ZIO.fail(ServiceRequestError(503, s"The gateway cannot log in: $err"))
        case Right(Left(err))  => ZIO.fail(ServiceRequestError(503, s"The gateway cannot log in: ${err.take(200)}"))
        case Right(Right(raw)) =>
          ZIO
            .fromEither:
              parse(raw).flatMap: json =>
                val c = json.hcursor
                for
                  token   <- c.get[String]("access_token")
                  expires <- c.get[Option[Long]]("expires_in")
                yield token -> expires.getOrElse(60L)
            .mapError(e => ServiceRequestError(503, s"The gateway cannot log in: ${e.getMessage}"))
            .map: (token, expiresIn) =>
              // 30 seconds before it expires a new one
              cached.set(Some(token -> (java.lang.System.currentTimeMillis() + (expiresIn - 30).max(0) * 1000)))
              token
  end fetch
end PublicToken
