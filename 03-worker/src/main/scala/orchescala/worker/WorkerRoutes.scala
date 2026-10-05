package orchescala.worker

import orchescala.domain.*
import orchescala.engine.domain.EngineError
import orchescala.engine.domain.EngineError.ProcessError
import orchescala.engine.auth.{TokenValidation, TokenVerifier}
import orchescala.engine.rest.{HttpClientProvider, TokenFingerprint}
import orchescala.engine.{AuthContext, EngineConfig, Slf4JLogger}
import orchescala.worker.*
import orchescala.worker.WorkerError.{MockedOutputJson, ServiceRequestError}
import sttp.capabilities.WebSockets
import sttp.capabilities.zio.ZioStreams
import sttp.tapir.server.ziohttp.{ZioHttpInterpreter, ZioHttpServerOptions}
import sttp.tapir.ztapir.*
import zio.http.{Response, Routes}
import zio.prelude.data.Optional
import zio.prelude.data.Optional.AllValuesAreNullable
import zio.{IO, ZIO}

import scala.reflect.ClassTag

case class WorkerRoutes(engineContext: EngineContext):

  // one validator per app - it caches the signing keys
  private lazy val tokenVerifier: Option[TokenVerifier] =
    TokenVerifier(engineContext.workerConfig.tokenValidation)

  def routes(
      supportedWorkers: Set[WorkerDsl[?, ?]]
  ): Routes[Any, Response] =
    val workers: Map[String, WorkerDsl[?, ?]] = supportedWorkers
      .map: w =>
        w.topic -> w
      .toMap

    val triggerWorkerEndpoint: ZServerEndpoint[Any, ZioStreams & WebSockets] =
      WorkerEndpoints
        .triggerWorker.zServerSecurityLogic: token =>
          validateToken(token)
            .mapError(ServiceRequestError.apply)
        .serverLogic: validatedToken =>
          (topicName, variables) =>
            AuthContext.withBearerToken(validatedToken):
              // the names only - the values (personal data, secrets) were in the INFO log
              ZIO.logInfo(s"Triggering worker: $topicName with variables: ${variables.asObject.fold("-")(_.keys.mkString(", "))}") *>
                workers.get(topicName)
                  .fold(ZIO.fail(WorkerError.ServiceBadPathError(s"Worker not found: $topicName"))):
                    worker =>
                      for
                        _                     <- checkRoles(worker, validatedToken)
                        generalVariables      <- extractGeneralVariables(variables)
                        given EngineRunContext = createRunContext(generalVariables, worker)
                        result                <- worker match
                                                   case worker: RunWorkDsl[?, ?]           =>
                                                     worker
                                                       .runWorkFromService(variables)
                                                   case worker: InitProcessDsl[?, ?, ?, ?] =>
                                                       worker
                                                         .initWorkFromService(variables)
                                                         .map(Option.apply)
                        _                     <- ZIO.logInfo(s"Worker '$topicName' done")
                        _                     <- ZIO.logDebug(s"Worker '$topicName' response: ${orchescala.engine.LogSafe.names(result)}")
                      yield result
                  .provideLayer(HttpClientProvider.live)
                  .tapError: err =>
                    ZIO.logError(s"Triggering Worker Error in Gateway: ${orchescala.engine.LogSafe.forLog(err.toString, "in the response")}")
                  .mapError:
                    case err: WorkerError =>
                      ServiceRequestError(err)
                    case err              =>
                      ServiceRequestError(500, err.getMessage)

    ZioHttpInterpreter(ZioHttpServerOptions.default).toHttp(
      List(triggerWorkerEndpoint)
    )
  end routes

  private def createRunContext(generalVariables: GeneralVariables, worker: WorkerDsl[?, ?]) =
    EngineRunContext(
      engineContext = engineContext,
      generalVariables = generalVariables,
      workerTimeout = Some(worker.timeout).collect { case timeout: scala.concurrent.duration.FiniteDuration => timeout }
    )

  /** The user needs one of the `requiredRoles` of the worker - else 403. Fails closed: without
    * verified tokens, or if the roles cannot be read, the call is refused.
    */
  private[worker] def checkRoles(worker: WorkerDsl[?, ?], token: String): IO[WorkerError, Unit] =
    val required = worker.requiredRoles
    val config   = engineContext.workerConfig
    def refuse(reason: String) =
      ZIO.logWarning(s"Worker '${worker.topic}' refused for ${TokenFingerprint(token)}: $reason") *>
        ZIO.fail(WorkerError.ServiceRequestError(403, s"Not allowed to call worker '${worker.topic}'"))
    if required.isEmpty then ZIO.unit
    else if config.tokenValidation == TokenValidation.PresenceOnly then
      refuse("the worker requires roles, but tokens are not verified (TokenValidation.PresenceOnly)")
    else
      ZIO
        .attempt(config.rolesOf(token))
        .catchAll(err =>
          ZIO.logWarning(s"Roles of ${TokenFingerprint(token)} cannot be read: ${err.getMessage}")
            .as(Set.empty[String])
        )
        .flatMap: roles =>
          if roles.exists(required.contains) then ZIO.unit
          else refuse(s"none of the roles ${required.toSeq.sorted.mkString(", ")}")
    end if
  end checkRoles

  /** Validates the Bearer token according to `WorkerConfig.tokenValidation` and returns it. */
  private def validateToken(token: String): IO[WorkerError, String] =
    if token.isBlank then
      ZIO.fail(WorkerError.TokenValidationError(
        errorMsg = "Invalid or missing authentication token"
      ))
    else
      tokenVerifier
        .fold(ZIO.unit)(_.validate(token).unit)
        .tapError(reason => ZIO.logWarning(s"Rejected token ${TokenFingerprint(token)}: $reason"))
        .mapError(reason => WorkerError.TokenValidationError(errorMsg = reason))
        .as(token)
end WorkerRoutes
