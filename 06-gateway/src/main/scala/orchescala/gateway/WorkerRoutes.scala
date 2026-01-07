package orchescala.gateway

import orchescala.domain.*
import orchescala.engine.domain.EngineError
import orchescala.engine.domain.EngineError.ProcessError
import orchescala.engine.rest.{HttpClientProvider, SttpClientBackend}
import orchescala.engine.{AuthContext, Slf4JLogger}
import orchescala.worker.*
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

  def routes(
      config: GatewayConfig
  ): Routes[Any, Response] =

    val triggerWorkerEndpoint: ZServerEndpoint[Any, ZioStreams & WebSockets] =
      WorkerEndpoints
        .triggerWorker.zServerSecurityLogic: token =>
          config.validateToken(token)
            .mapError(ErrorResponse.fromOrchescalaError)
        .serverLogic: validatedToken =>
          (topicName, variables) =>
            AuthContext.withBearerToken(validatedToken):
              given EngineRunContext = EngineRunContext(
                engineContext = GatewayEngineContext(),
                generalVariables = GeneralVariables()
              )

              ZIO.logInfo(s"Triggering worker: $topicName with variables: $variables") *>
                config.workerAppUrl(topicName)
                  .fold(
                    // Execute locally if no remote URL is configured
                    ZIO.fail(EngineError.ProcessError(s"Worker not found: $topicName"))
                  ): workerAppBaseUrl =>
                    // Forward request to the worker app
                    forwardWorkerRequest(topicName, variables, workerAppBaseUrl, validatedToken)
                      .provideLayer(HttpClientProvider.live)
                  .catchAll: err =>
                    ZIO.logError(s"Worker forwarding Error: $err") *>
                      ZIO.fail(ErrorResponse.fromOrchescalaError(
                        ProcessError(s"Running Worker failed: $err")
                      ))

    ZioHttpInterpreter(ZioHttpServerOptions.default).toHttp(
      List(triggerWorkerEndpoint)
    )
  end routes

  /** Forward a worker request to a remote WorkerApp using HTTP */
  private def forwardWorkerRequest(
      topicName: String,
      variables: Json,
      workerAppBaseUrl: String,
      token: String
  ): ZIO[SttpClientBackend, WorkerError, Option[Json]] =
    for
      _        <- ZIO.logDebug(s"Forwarding worker request to: $workerAppBaseUrl/worker/$topicName")
      uri      <- ZIO.fromEither(Uri.parse(s"$workerAppBaseUrl/worker/$topicName"))
                    .mapError(err => WorkerError.ServiceUnexpectedError(s"Invalid worker app URL: $err"))
      request   = basicRequest
                    .post(uri)
                    .header("Authorization", s"Bearer $token")
                    .body(variables.toString)
                    .contentType("application/json")
      response <- ZIO.serviceWithZIO[SttpClientBackend]: backend =>
                    request.send(backend)
                      .mapError: err =>
                        WorkerError.ServiceUnexpectedError(
                          s"Error forwarding request to worker app: $err"
                        )
      _        <- ZIO.logDebug(s"Worker app response status: ${response.code.code}")
      result   <- response.code.code match
                    case 204  => ZIO.none
                    case 200  =>
                      ZIO.fromEither(io.circe.parser.parse(response.body.getOrElse("null")))
                        .mapError(err =>
                          WorkerError.ServiceBadBodyError(s"Failed to parse response: $err")
                        )
                        .map(Some(_))
                    case code =>
                      val body = response.body match
                        case Right(msg) => msg
                        case Left(msg) => msg
                      ZIO.fail(WorkerError.ServiceRequestError(
                        code,
                        body
                      ))
    yield result
end WorkerRoutes
