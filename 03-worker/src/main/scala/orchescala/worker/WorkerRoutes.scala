package orchescala.worker

import orchescala.domain.*
import orchescala.engine.domain.EngineError
import orchescala.engine.domain.EngineError.ProcessError
import orchescala.engine.rest.HttpClientProvider
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

  def routes(
      supportedWorkers: Set[WorkerDsl[?, ?]]
      // no validation for workers
      // validateToken: String => IO[WorkerError, String]
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
              ZIO.logInfo(s"Triggering worker: $topicName with variables: $variables") *>
                workers.get(topicName)
                  .fold(ZIO.fail(WorkerError.ServiceBadPathError(s"Worker not found: $topicName"))):
                    worker =>
                      for
                        generalVariables      <- extractGeneralVariables(variables)
                        given EngineRunContext = createRunContext(generalVariables)
                        result                <- worker match
                                                   case worker: RunWorkDsl[?, ?]           =>
                                                     worker
                                                       .runWorkFromWorker(variables)
                                                   case worker: InitProcessDsl[?, ?, ?, ?] =>
                                                       worker
                                                         .runWorkFromServiceWithMocking(variables)
                                                         .map(Option.apply)
                        _                     <- ZIO.logDebug(s"Worker '$topicName' response: $result")
                      yield result
                  .provideLayer(HttpClientProvider.live)
                  .tapError: err =>
                    ZIO.logError(s"Triggering Worker Error in Gateway: $err")
                  .mapError:
                    case err: WorkerError =>
                      ServiceRequestError(err)
                    case err              =>
                      ServiceRequestError(500, err.getMessage)

    ZioHttpInterpreter(ZioHttpServerOptions.default).toHttp(
      List(triggerWorkerEndpoint)
    )
  end routes

  private def createRunContext(generalVariables: GeneralVariables) =
    EngineRunContext(
      engineContext = engineContext,
      generalVariables = generalVariables
    )

  /** Default token validator - validates that token is not empty and returns the token. Override
    * this with your own validation logic (e.g., JWT validation, database lookup, etc.)
    */
  private def validateToken(token: String): IO[WorkerError, String] =
    if token.nonEmpty then
      ZIO.succeed(token)
    else
      ZIO.fail(WorkerError.TokenValidationError(
        errorMsg = "Invalid or missing authentication token"
      ))
end WorkerRoutes
