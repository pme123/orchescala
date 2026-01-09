package orchescala.gateway

import orchescala.domain.*
import orchescala.engine.rest.{HttpClientProvider, SttpClientBackend}
import orchescala.engine.{AuthContext, Slf4JLogger}
import orchescala.gateway.GatewayError.{ServiceRequestError, UnexpectedError}
import orchescala.worker.{DefaultRestApiClient, EngineContext, EngineRunContext, RunnableRequest, SendRequestType}
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
              given EngineRunContext = EngineRunContext(
                engineContext = GatewayEngineContext(),
                generalVariables = GeneralVariables()
              )

              // Forward request to the worker app
              forwardWorkerRequest(topicName, variables, validatedToken)
                .provideLayer(HttpClientProvider.live)
                .mapError:
                  case err: GatewayError =>
                    ServiceRequestError(err)
                  case err               =>
                    ServiceRequestError(500, err.getMessage)
                .tapError(err => ZIO.logError(s"Triggering Worker Error: $err"))
    List(triggerWorkerEndpoint)
  end routes

  def forwardWorkerRequest(
      topicName: String,
      variables: Json,
      token: String
  )(using config: GatewayConfig): ZIO[SttpClientBackend, GatewayError, Option[Json]] =
    config.workerAppUrl(topicName)
      .fold(
        // No worker app configured
        ZIO.fail(UnexpectedError(s"Worker not found: $topicName"))
      ): workerAppBaseUrl =>
        forwardRequest(topicName, variables, workerAppBaseUrl, token)

  /** Forward a worker request to a remote WorkerApp using HTTP */
  private def forwardRequest(
      topicName: String,
      variables: Json,
      workerAppBaseUrl: String,
      token: String
  ): ZIO[SttpClientBackend, GatewayError, Option[Json]] =
    for
      _        <- ZIO.logDebug(s"Forwarding worker request to: $workerAppBaseUrl/worker/$topicName")
      uri      <- ZIO.fromEither(Uri.parse(s"$workerAppBaseUrl/worker/$topicName"))
                    .mapError(err => UnexpectedError(s"Invalid worker app URL: $err"))
      request   = token.foldLeft(basicRequest
                    .post(uri)
                    .body(variables.toString)
                    .contentType("application/json")): (req, t) =>
                    req.header("Authorization", s"Bearer $t")
      response <- ZIO.serviceWithZIO[SttpClientBackend]: backend =>
                    request.send(backend)
                      .mapError: err =>
                        UnexpectedError(
                          s"Error forwarding request to worker app: $err"
                        )
      _        <- ZIO.logDebug(s"Worker app response status: ${response.code.code}")
      result   <- response.body match
                    case Right(body) =>
                      ZIO.fromEither(parser.parse(body))
                        .mapError(err =>
                          UnexpectedError(s"Failed to parse error response: $err")
                        )
                        .map(Option.apply)
                    case Left(err)   =>
                      for
                        json <- ZIO
                          .fromEither(parser.parse(err))
                          .mapError: err =>
                            UnexpectedError(s"Failed to parse response to JSON: $err")
                        error <- ZIO
                          .fromEither(json.as[ServiceRequestError])
                          .mapError: err =>
                            UnexpectedError(s"Failed to parse response to ServiceRequestError: $err")
                        _ <- ZIO.fail(error)
                      yield None
    yield result
end WorkerRoutes
