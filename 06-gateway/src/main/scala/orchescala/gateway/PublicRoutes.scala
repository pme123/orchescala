package orchescala.gateway

import orchescala.domain.*
import orchescala.engine.rest.{HttpClientProvider, OAuthConfig, WorkerForwardUtil}
import orchescala.engine.AuthContext
import orchescala.gateway.GatewayError.ServiceRequestError
import orchescala.gateway.PublicAccess.Kind
import sttp.capabilities.WebSockets
import sttp.capabilities.zio.ZioStreams
import sttp.tapir.server.model.EndpointExtensions.*
import sttp.tapir.ztapir.*
import zio.*

/** The calls without a Bearer token - see [[PublicAccess]]. Each is admitted by the [[PublicGuard]]
  * before its body is read, then made with the technical token of the gateway, through the same code
  * as with a token. Build it once - the rate limit and the token live in it.
  */
class PublicRoutes(
    processRoutes: ProcessInstanceRoutes,
    messageRoutes: MessageRoutes
)(using config: GatewayConfig):

  private val access     = config.publicAccess
  private lazy val guard = newGuard(access)
  private lazy val login = access.login.map(newToken)
  private val maxBytes   = access.maxBodyBytes.toLong
  // public calls go to the configured tenant - starts and messages alike
  private val tenantId   = config.engineConfig.tenantId
  private val inFlight   = java.util.concurrent.atomic.AtomicInteger(0)

  protected def newGuard(access: PublicAccess): PublicGuard = PublicGuard(access)
  protected def newToken(login: OAuthConfig): PublicToken   = PublicToken(login)

  lazy val routes: List[ZServerEndpoint[Any, ZioStreams & WebSockets]] =
    if access.isEmpty then List.empty else List(workerEndpoint, startProcessEndpoint, messageEndpoint)

  private lazy val workerEndpoint: ZServerEndpoint[Any, ZioStreams & WebSockets] =
    PublicEndpoints.worker
      .maxRequestBodyLength(maxBytes)
      .zServerSecurityLogic(admit(Kind.worker))
      .serverLogic: topic =>
        raw =>
          for
            body <- body(Kind.worker, topic, raw)
            out  <- forwarded(Kind.worker, topic): token =>
                       AuthContext.withBearerToken(token):
                         WorkerForwardUtil.forwardWorkerRequest(topic, Json.fromJsonObject(body), token)(using config.engineConfig)
                           // the shared backend - no client per call
                           .provideEnvironment(ZEnvironment(HttpClientProvider.cachedBackend))
                           .map(Option.apply)
                           .mapError(ServiceRequestError.apply)
          yield out

  private lazy val startProcessEndpoint: ZServerEndpoint[Any, ZioStreams & WebSockets] =
    PublicEndpoints.startProcess
      .maxRequestBodyLength(maxBytes)
      .zServerSecurityLogic(admit(Kind.processStart))
      .serverLogic: key =>
        (businessKey, raw) =>
          for
            body   <- body(Kind.processStart, key, raw)
            bk     <- checkedKey(Kind.processStart, key, businessKey, required = false, minLength = PublicAccess.minPublicKeyLength)
            result <- forwarded(Kind.processStart, key): token =>
                        processRoutes.startAsync(token, key, bk, tenantId, body)
          yield result

  private lazy val messageEndpoint: ZServerEndpoint[Any, ZioStreams & WebSockets] =
    PublicEndpoints.message
      .maxRequestBodyLength(maxBytes)
      .zServerSecurityLogic(admit(Kind.message))
      .serverLogic: name =>
        (businessKey, raw) =>
          for
            body   <- body(Kind.message, name, raw)
            bk     <- checkedKey(Kind.message, name, businessKey, required = true, minLength = PublicAccess.minPublicKeyLength)
            result <- forwarded(Kind.message, name): token =>
                        messageRoutes.send(token, name, tenantId, None, bk, None, Some(body).filter(_.nonEmpty))
          yield result

  /** Rate limit and allow list - the name is passed on to the logic. */
  private def admit(kind: Kind)(admission: PublicEndpoints.Admission): IO[ServiceRequestError, String] =
    val (name, remote, headers) = admission
    val warnForgotten           = ZIO.foreachDiscard(guard.forgottenReport()): n =>
      ZIO.logWarning(s"Public access: $n clients forgotten in the last minute (too many at once) - an attack?")
    warnForgotten *>
      ZIO
        .fromEither(guard.admit(kind, name, access.client(remote, headers)))
        .as(name)
        .tapError(refusedLog(kind, name))
  end admit

  /** The body as the guard checked it. */
  private def body(kind: Kind, name: String, raw: String): IO[ServiceRequestError, JsonObject] =
    ZIO.fromEither(guard.body(raw)).tapError(refusedLog(kind, name))

  private def checkedKey(kind: Kind, name: String, key: Option[String], required: Boolean, minLength: Int = 1) =
    ZIO.fromEither(guard.businessKey(key, required, minLength)).tapError(refusedLog(kind, name))

  /** The call with the technical token - at most [[PublicAccess.maxConcurrentCalls]] at once and
    * within [[PublicAccess.callTimeout]], else a 503. The call runs in a fiber of its own with its own
    * timeout: it holds its slot until it has really stopped - also if the caller is gone - so slow
    * calls cannot pile up behind the cap. Worker and engine calls are asynchronous (interrupted at
    * the timeout); the blocking token call is cut after 10 seconds.
    */
  private def forwarded[A](kind: Kind, name: String)(call: String => IO[ServiceRequestError, A]): IO[ServiceRequestError, A] =
    val tooLong =
      ZIO.logError(s"Public $kind '$name': no answer within ${access.callTimeout.render}").as(PublicAccess.unavailable)
    val work    = token
      .flatMap(t => downstream(kind, name, t)(call(t)))
      // interrupted at the timeout - the slot is free once it has stopped
      .timeout(access.callTimeout)
      .someOrElseZIO(tooLong.flatMap(ZIO.fail(_)))
    Promise.make[ServiceRequestError, A].flatMap: done =>
      // taking the slot and forking the call that frees it - not to be interrupted in between
      ZIO.uninterruptibleMask: restore =>
        if inFlight.incrementAndGet() > access.maxConcurrentCalls then
          ZIO.succeed(inFlight.decrementAndGet()) *>
            ZIO.logWarning(s"Public $kind '$name': more than ${access.maxConcurrentCalls} public calls at once") *>
            ZIO.fail(PublicAccess.unavailable)
        else
          // restore: the call itself stays interruptible (by its timeout) - a fork inherits the mask;
          // the slot is free before the caller gets the answer
          restore(work).ensuring(ZIO.succeed(inFlight.decrementAndGet())).intoPromise(done).forkDaemon *>
            // normally the call answers (also its own timeout); this only if it does not stop at once
            restore(done.await.timeout(access.callTimeout + 1.second)).someOrElseZIO(ZIO.fail(PublicAccess.unavailable))
  end forwarded

  /** A refusal - the name comes from the caller (only a listed one gets further), so it is logged
    * cleaned; 404 and 429 come at request speed from scanners - debug only.
    */
  private def refusedLog(kind: Kind, name: String)(e: ServiceRequestError) =
    val line = s"Public $kind '${PublicAccess.loggable(name)}' refused: ${e.errorCode} ${e.errorMsg}"
    if e.errorCode == 404 || e.errorCode == 429 then ZIO.logDebug(line) else ZIO.logWarning(line)

  /** What a worker or the engine answers goes to the caller without its detail (only to the log): a
    * refusal (4xx) with its status (for a message always 400), a failure (5xx) or a defect as 503. Is the technical token
    * rejected (401 - a 403 can be a business rule), the next call fetches a new one - at most every
    * 10 seconds, so a caller can force at most a few logins a minute; calls in flight keep theirs.
    */
  private def downstream[A](kind: Kind, name: String, token: String)(call: IO[ServiceRequestError, A]): IO[ServiceRequestError, A] =
    call
      .catchAll: e =>
        val log = s"Public $kind '$name': ${e.errorCode} ${e.errorMsg}"
        val err = e.errorCode match
          case 401                      =>
            // logged as an error once per new token - not for every call while it is rejected
            val invalidated = login.exists(_.invalidate(token))
            (if invalidated then ZIO.logError(s"$log - the technical token was rejected, a new one is fetched")
             else ZIO.logDebug(log)).as(PublicAccess.unavailable)
          // a message: always 400 - a 404 / 409 would tell whether a business key exists
          case c if c >= 400 && c < 500 => ZIO.logWarning(log).as(PublicAccess.refused(if kind == Kind.message then 400 else c))
          case _                        => ZIO.logError(log).as(PublicAccess.unavailable)
        err.flatMap(ZIO.fail(_))
      // a defect (an exception) - never tapir's default answer with its detail
      .catchAllDefect: defect =>
        ZIO.logErrorCause(s"Public $kind '$name' failed", Cause.die(defect)) *> ZIO.fail(PublicAccess.unavailable)

  private def token: IO[ServiceRequestError, String] =
    login match
      case Some(l) => l.token
      case None    =>
        ZIO.logError("Public access has no login (PublicAccess.login).") *> ZIO.fail(PublicAccess.unavailable)

end PublicRoutes
