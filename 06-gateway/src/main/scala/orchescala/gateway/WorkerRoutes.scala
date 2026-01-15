package orchescala.gateway

import orchescala.domain.*
import orchescala.engine.domain.EngineError
import orchescala.engine.rest.{HttpClientProvider, SttpClientBackend, WorkerForwardUtil}
import orchescala.engine.{AuthContext, Slf4JLogger}
import orchescala.gateway.GatewayError.{ServiceRequestError, UnexpectedError}
import orchescala.worker.{DefaultRestApiClient, EngineContext, EngineRunContext, RunnableRequest, SendRequestType, WorkerError}
import sttp.capabilities.WebSockets
import sttp.capabilities.zio.ZioStreams
import sttp.client3.*
import sttp.model.Uri
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

  def routes(using config: GatewayConfig): List[ZServerEndpoint[Any, ZioStreams & WebSockets]] =

    val triggerWorkerEndpoint: ZServerEndpoint[Any, ZioStreams & WebSockets] =
      WorkerEndpoints
        .triggerWorker.zServerSecurityLogic: token =>
          config.validateToken(token)
            .mapError(ServiceRequestError.apply)
        .serverLogic: validatedToken =>
          (topicName, variables) =>
            AuthContext.withBearerToken(validatedToken):
              // Forward request to the worker app
              WorkerForwardUtil.forwardWorkerRequest(topicName, variables, validatedToken)(using config.engineConfig)
                .provideLayer(HttpClientProvider.live)
                .mapError:
                  case err: EngineError =>
                    ServiceRequestError(err)
                  case err               =>
                    ServiceRequestError(500, err.getMessage)
                .tapError(err => ZIO.logError(s"Triggering Worker Error in WorkerApp: $err"))
    List(triggerWorkerEndpoint)
  end routes
  

end WorkerRoutes
