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
            bk     <- checkedKey(Kind.processStart, key, businessKey, required = false)
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
            bk     <- checkedKey(Kind.message, name, businessKey, required = true)
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

  private def checkedKey(kind: Kind, name: String, key: Option[String], required: Boolean) =
    ZIO.fromEither(guard.businessKey(key, required)).tapError(refusedLog(kind, name))

  /** The call with the technical token - at most [[PublicAccess.maxConcurrentCalls]] at once and
    * within [[PublicAccess.callTimeout]], else a 503. A call that takes too long is interrupted -
    * its slot is free only once it has really stopped, so slow calls cannot pile up behind the cap.
    */
  private def forwarded[A](kind: Kind, name: String)(call: String => IO[ServiceRequestError, A]): IO[ServiceRequestError, A] =
    ZIO.suspendSucceed:
      if inFlight.incrementAndGet() > access.maxConcurrentCalls then
        ZIO.succeed(inFlight.decrementAndGet()) *>
          ZIO.logWarning(s"Public $kind '$name': more than ${access.maxConcurrentCalls} public calls at once") *>
          ZIO.fail(PublicAccess.unavailable)
      else
        for
          done   <- Promise.make[ServiceRequestError, A]
          // a fiber of its own - it holds the slot until it has stopped, also after the timeout
          fiber  <- token
                      .flatMap(t => downstream(kind, name, t)(call(t)))
                      .intoPromise(done)
                      .ensuring(ZIO.succeed(inFlight.decrementAndGet()))
                      .forkDaemon
          result <- done.await
                      .timeout(access.callTimeout)
                      .someOrElseZIO:
                        fiber.interrupt.forkDaemon *>
                          ZIO.logError(s"Public $kind '$name': no answer within ${access.callTimeout.render}") *>
                          ZIO.fail(PublicAccess.unavailable)
        yield result

  private def refusedLog(kind: Kind, name: String)(e: ServiceRequestError) =
    ZIO.logWarning(s"Public $kind '$name' refused: ${e.errorCode} ${e.errorMsg}")

  /** What a worker or the engine answers goes to the caller without its detail (only to the log): a
    * refusal (4xx) with its status, a failure (5xx) or a defect as 503. Is the technical token
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
          case c if c >= 400 && c < 500 => ZIO.logWarning(log).as(PublicAccess.refused(c))
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
