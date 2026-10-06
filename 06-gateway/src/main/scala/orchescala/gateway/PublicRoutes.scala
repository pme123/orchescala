package orchescala.gateway

import orchescala.domain.*
import orchescala.engine.rest.{HttpClientProvider, WorkerForwardUtil}
import orchescala.engine.AuthContext
import orchescala.engine.domain.EngineError
import orchescala.gateway.GatewayError.ServiceRequestError
import orchescala.gateway.PublicAccess.Kind
import sttp.capabilities.WebSockets
import sttp.capabilities.zio.ZioStreams
import sttp.tapir.ztapir.*
import zio.*

/** The calls without a Bearer token - see [[PublicAccess]]. Each is checked by the [[PublicGuard]]
  * and then made with the technical token of the gateway, through the same code as with a token.
  */
class PublicRoutes(
    processRoutes: ProcessInstanceRoutes,
    messageRoutes: MessageRoutes
)(using config: GatewayConfig):

  private val access = config.publicAccess
  private val guard  = PublicGuard(access)
  private val login  = access.login.map(PublicToken(_))

  lazy val routes: List[ZServerEndpoint[Any, ZioStreams & WebSockets]] =
    if access.isEmpty then List.empty else List(workerEndpoint, startProcessEndpoint, messageEndpoint)

  private lazy val workerEndpoint: ZServerEndpoint[Any, ZioStreams & WebSockets] =
    PublicEndpoints.worker.zServerLogic: (topic, body, remote, headers) =>
      for
        checked <- checked(Kind.worker, topic, remote, headers, body)
        token   <- token
        out     <- AuthContext.withBearerToken(token):
                     WorkerForwardUtil.forwardWorkerRequest(topic, checked, token)(using config.engineConfig)
                       .provideLayer(HttpClientProvider.live)
                       .map(Option.apply)
                       .mapError:
                         case err: EngineError => ServiceRequestError(err)
                         case err              => ServiceRequestError(500, err.getMessage)
      yield out

  private lazy val startProcessEndpoint: ZServerEndpoint[Any, ZioStreams & WebSockets] =
    PublicEndpoints.startProcess.zServerLogic: (key, businessKey, in, remote, headers) =>
      for
        checked <- checked(Kind.processStart, key, remote, headers, Json.fromJsonObject(in))
        token   <- token
        result  <- processRoutes.startAsync(token, key, businessKey, None, checked.asObject.getOrElse(in))
      yield result

  private lazy val messageEndpoint: ZServerEndpoint[Any, ZioStreams & WebSockets] =
    PublicEndpoints.message.zServerLogic: (name, businessKey, variables, remote, headers) =>
      val body = variables.map(Json.fromJsonObject).getOrElse(Json.obj())
      for
        checked <- checked(Kind.message, name, remote, headers, body)
        _       <- ZIO.when(businessKey.forall(_.isBlank))(ZIO.fail(ServiceRequestError(400, "A public message needs the businessKey.")))
        token   <- token
        result  <- messageRoutes.send(token, name, None, None, businessKey, None, checked.asObject.filter(_.nonEmpty))
      yield result

  private def checked(kind: Kind, name: String, remote: Option[String], headers: List[sttp.model.Header], body: Json) =
    ZIO
      .fromEither(guard.check(kind, name, client(remote, headers), body))
      .tapError(e => ZIO.logWarning(s"Public $kind '$name' refused: ${e.errorCode} ${e.errorMsg}"))

  private def client(remote: Option[String], headers: List[sttp.model.Header]): String =
    access.clientIpHeader
      .flatMap(h => headers.find(_.name.equalsIgnoreCase(h)))
      .map(_.value.split(",").head.trim)
      .filter(_.nonEmpty)
      .orElse(remote)
      .getOrElse("unknown")

  private def token: IO[ServiceRequestError, String] =
    login match
      case Some(l) => l.token
      case None    => ZIO.fail(ServiceRequestError(503, "Public access has no login (PublicAccess.login)."))

end PublicRoutes
