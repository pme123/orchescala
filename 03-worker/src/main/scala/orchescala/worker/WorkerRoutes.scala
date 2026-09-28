package orchescala.worker

import orchescala.domain.*
import orchescala.engine.domain.EngineError
import orchescala.engine.domain.EngineError.ProcessError
import orchescala.engine.auth.TokenVerifier
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
