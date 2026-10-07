package orchescala.gateway

import orchescala.domain.*
import orchescala.engine.rest.{HttpClientProvider, OAuthConfig, WorkerForwardUtil}
import orchescala.engine.AuthContext
import orchescala.engine.domain.EngineError
import orchescala.gateway.GatewayError.ServiceRequestError
import orchescala.gateway.PublicAccess.Kind
import sttp.capabilities.WebSockets
import sttp.capabilities.zio.ZioStreams
import sttp.tapir.server.model.EndpointExtensions.*
import sttp.tapir.ztapir.*
import zio.*

/** The calls without a Bearer token - see [[PublicAccess]]. Each is checked by the [[PublicGuard]]
  * and then made with the technical token of the gateway, through the same code as with a token.
  * Build it once - the rate limit and the token live in it.
  */
class PublicRoutes(
    processRoutes: ProcessInstanceRoutes,
    messageRoutes: MessageRoutes
)(using config: GatewayConfig):

  private val access = config.publicAccess
  private val guard  = PublicGuard(access)
  private lazy val login = access.login.map(newToken)
  private val maxBytes   = access.maxBodyBytes.toLong
  // public calls go to the configured tenant - starts and messages alike
  private val tenantId   = config.engineConfig.tenantId

  protected def newToken(login: OAuthConfig): PublicToken = PublicToken(login)

  lazy val routes: List[ZServerEndpoint[Any, ZioStreams & WebSockets]] =
    if access.isEmpty then List.empty else List(workerEndpoint, startProcessEndpoint, messageEndpoint)

  private lazy val workerEndpoint: ZServerEndpoint[Any, ZioStreams & WebSockets] =
    PublicEndpoints.worker.maxRequestBodyLength(maxBytes).zServerLogic: (topic, body, remote, headers) =>
      val call = for
        checked <- checked(Kind.worker, topic, remote, headers, body)
        token   <- token
        out     <- AuthContext.withBearerToken(token):
                     // the layer is the shared backend - no client per call
                     WorkerForwardUtil.forwardWorkerRequest(topic, checked, token)(using config.engineConfig)
                       .provideLayer(HttpClientProvider.live)
                       .map(Option.apply)
                       .mapError:
                         case err: EngineError => ServiceRequestError(err)
                         case err              => ServiceRequestError(500, err.getMessage)
      yield out
      generic(Kind.worker, topic)(call)

  private lazy val startProcessEndpoint: ZServerEndpoint[Any, ZioStreams & WebSockets] =
    PublicEndpoints.startProcess.maxRequestBodyLength(maxBytes).zServerLogic: (key, businessKey, in, remote, headers) =>
      val call = for
        checked <- checked(Kind.processStart, key, remote, headers, in)
        // the checked body - never the unchecked one
        vars    <- ZIO.fromOption(checked.asObject).orElseFail(ServiceRequestError(400, "The request is not valid."))
        token   <- token
        result  <- processRoutes.startAsync(token, key, businessKey, tenantId, vars)
      yield result
      generic(Kind.processStart, key)(call)

  private lazy val messageEndpoint: ZServerEndpoint[Any, ZioStreams & WebSockets] =
    PublicEndpoints.message.maxRequestBodyLength(maxBytes).zServerLogic: (name, businessKey, body, remote, headers) =>
      val call = for
        checked <- checked(Kind.message, name, remote, headers, body)
        _       <- ZIO.when(businessKey.isBlank)(ZIO.fail(ServiceRequestError(400, "A public message needs the businessKey.")))
        token   <- token
        result  <- messageRoutes.send(token, name, tenantId, None, Some(businessKey), None, checked.asObject.filter(_.nonEmpty))
      yield result
      generic(Kind.message, name)(call)

  private def checked(kind: Kind, name: String, remote: Option[String], headers: List[sttp.model.Header], body: String) =
    ZIO
      .fromEither(guard.check(kind, name, access.client(remote, headers), body))
      .tapError(e => ZIO.logWarning(s"Public $kind '$name' refused: ${e.errorCode} ${e.errorMsg}"))

  /** A refusal (4xx) goes to the caller as it is - what failed inside (5xx) only to the log. */
  private def generic[A](kind: Kind, name: String)(call: IO[ServiceRequestError, A]): IO[ServiceRequestError, A] =
    call.catchSome:
      case e if e.errorCode >= 500 && e != PublicAccess.unavailable =>
        ZIO.logError(s"Public $kind '$name' failed: ${e.errorCode} ${e.errorMsg}") *>
          ZIO.fail(PublicAccess.unavailable)

  private def token: IO[ServiceRequestError, String] =
    login match
      case Some(l) => l.token
      case None    =>
        ZIO.logError("Public access has no login (PublicAccess.login).") *> ZIO.fail(PublicAccess.unavailable)

end PublicRoutes
