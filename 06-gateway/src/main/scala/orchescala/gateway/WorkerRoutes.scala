package orchescala.gateway

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

  /** Simple EngineContext implementation for the gateway */
  private class GatewayEngineContext extends EngineContext:
    override def getLogger(clazz: Class[?]): OrchescalaLogger =
      Slf4JLogger.logger(clazz.getName)

    override def toEngineObject: Json => Any =
      json => json

    override def sendRequest[ServiceIn: InOutEncoder, ServiceOut: {InOutDecoder, ClassTag}](
        request: RunnableRequest[ServiceIn]
    ): SendRequestType[ServiceOut] =
      DefaultRestApiClient.sendRequest(request)
  end GatewayEngineContext

  def routes(
      supportedWorkers: Set[WorkerDsl[?, ?]],
      validateToken: String => IO[GatewayError, String]
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
                engineContext = GatewayEngineContext(),
                generalVariables = GeneralVariables()
              )

              ZIO.logInfo(s"Triggering worker: $topicName with variables: $variables") *>
                AuthContext.withBearerToken(validatedToken):
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
end WorkerRoutes
