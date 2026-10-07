package orchescala.gateway

import io.circe.parser.parse
import orchescala.domain.*
import orchescala.gateway.GatewayError.ServiceRequestError

import java.util.concurrent.atomic.AtomicReference

/** Checks a public call before it is forwarded - see [[PublicAccess]]: first [[admit]] (rate limit,
  * allow list - before the body is read), then [[body]].
  *
  * @param maxClients
  *   the most clients counted at once - beyond, the client used least recently is forgotten (its
  *   count starts anew), so rotating addresses can neither grow the map without bound nor lock out
  *   others; the price: such a flood also resets the counts of real clients. 100'000 entries are
  *   about 15 MB.
  */
class PublicGuard(
    access: PublicAccess,
    now: () => Long = PublicAccess.monotonicMillis,
    maxClients: Int = 100_000
):
  import PublicAccess.Kind

  private val windowMillis = 60 * 1000L

  // per client: (start of its window, calls in it, last call) - the least recently called first.
  // Every access - also a get, it reorders - under the lock of calls: its work is a lookup and
  // removing a few expired clients, cheap next to a call to a worker or the engine; with a sharded
  // map the LRU order and the cap would no longer be exact.
  private val calls = new java.util.LinkedHashMap[String, (Long, Int, Long)](16, 0.75f, true):
    override def removeEldestEntry(eldest: java.util.Map.Entry[String, (Long, Int, Long)]): Boolean =
      val full = size > maxClients
      if full then forgotten += 1
      full

  // under the lock of calls (as the map itself)
  private var lastReport           = now()
  private var forgotten            = 0L
  // read without the lock - by every call
  private val report               = AtomicReference[Option[Long]](None)

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

  /** The business key - None is fine unless it is required; else a plain one of at least
    * `minLength`.
    */
  def businessKey(key: Option[String], required: Boolean, minLength: Int = 1): Either[ServiceRequestError, Option[String]] =
    key.filter(!_.isBlank) match
      case None if required => Left(ServiceRequestError(400, "The businessKey is required."))
      case Some(k) if !PublicAccess.businessKeyPattern.matches(k) || k.length < minLength =>
        Left(ServiceRequestError(400, "The businessKey is not valid."))
      case k                => Right(k)

  /** [[admit]] and [[body]] in one - for tests. */
  private[gateway] def check(kind: Kind, name: String, client: String, raw: String): Either[ServiceRequestError, Json] =
    admit(kind, name, client).flatMap(_ => body(raw)).map(Json.fromJsonObject)

  /** How many clients were forgotten in the last minute because of [[maxClients]] - once after each
    * minute with any (for a warning in the log).
    */
  def forgottenReport(): Option[Long] =
    // a read first - every call asks, a write only when there is a report
    if report.get().isEmpty then None else report.getAndSet(None)

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
        case Some((start, n, _)) if start >= at - windowMillis => (start, n + 1)
        case _                                                 => (at, 1)
      // beyond the limit the count stays there - the last call is kept for the sweep
      calls.put(client, (start, count.min(access.requestsPerMinute + 1), at))
      count <= access.requestsPerMinute
  end withinLimit

  /** Removes a few clients of past minutes from the head (the least recently used) - a little with
    * every call, never a scan of the whole map under the lock; the report once a minute.
    */
  private def sweep(at: Long): Unit =
    val it      = calls.values.iterator
    var removed = 0
    // the head is the least recently called - removed while its last call is older than a window
    while removed < PublicGuard.sweepPerCall && it.hasNext && it.next()._3 < at - windowMillis do
      it.remove()
      removed += 1
    if at - lastReport >= windowMillis then
      lastReport = at
      if forgotten > 0 then report.set(Some(forgotten))
      forgotten = 0

  private[gateway] def clients: Int = calls.synchronized(calls.size)
end PublicGuard

object PublicGuard:
  // expired clients removed per call - more than one, so the map shrinks faster than it grows
  private val sweepPerCall = 8
