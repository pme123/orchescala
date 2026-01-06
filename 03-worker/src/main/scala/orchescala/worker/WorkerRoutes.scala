package orchescala.worker

import orchescala.domain.*
import orchescala.engine.domain.EngineError
import orchescala.engine.domain.EngineError.ProcessError
import orchescala.engine.rest.HttpClientProvider
import orchescala.engine.{AuthContext, Slf4JLogger}
import orchescala.worker.*
import sttp.capabilities.WebSockets
import sttp.capabilities.zio.ZioStreams
import sttp.tapir.server.ziohttp.{ZioHttpInterpreter, ZioHttpServerOptions}
import sttp.tapir.ztapir.*
import zio.http.{Response, Routes}
import zio.{IO, ZIO}

import scala.reflect.ClassTag

object WorkerRoutes:

  /** Simple EngineContext implementation for the worker app */
  private class WorkerEngineContext extends EngineContext:
    override def getLogger(clazz: Class[?]): OrchescalaLogger =
      Slf4JLogger.logger(clazz.getName)

    override def toEngineObject: Json => Any =
      json => json

    override def sendRequest[ServiceIn: InOutEncoder, ServiceOut: {InOutDecoder, ClassTag}](
                                                                                             request: RunnableRequest[ServiceIn]
                                                                                           ): SendRequestType[ServiceOut] =
      DefaultRestApiClient.sendRequest(request)
  end WorkerEngineContext
  
  def routes(
      supportedWorkers: Set[WorkerDsl[?, ?]],
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
            .mapError(ErrorResponse.fromOrchescalaError)
        .serverLogic: validatedToken =>
          (topicName, variables) =>
            AuthContext.withBearerToken(validatedToken):
              given EngineRunContext = EngineRunContext(
                engineContext = WorkerEngineContext(),
                generalVariables = GeneralVariables()
              )

              ZIO.logInfo(s"Triggering worker: $topicName with variables: $variables") *>
                  workers.get(topicName)
                    .fold(ZIO.fail(EngineError.ProcessError(s"Worker not found: $topicName"))):
                      worker =>
                        worker
                          .runWorkFromWorker(variables)
                          .tap: r =>
                            ZIO.logDebug(s"Worker '$topicName' response: $r")
                          .provideLayer(HttpClientProvider.live)
                    .mapError: err =>
                      ErrorResponse.fromOrchescalaError(ProcessError(s"Running Worker failed: $err"))

    ZioHttpInterpreter(ZioHttpServerOptions.default).toHttp(
      List(triggerWorkerEndpoint)
    )
  end routes

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
