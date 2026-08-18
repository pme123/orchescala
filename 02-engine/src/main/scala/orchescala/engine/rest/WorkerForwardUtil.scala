package orchescala.engine.rest

import orchescala.engine.EngineConfig
import orchescala.engine.domain.EngineError
import orchescala.engine.domain.EngineError.{ServiceRequestError, UnexpectedError}
import orchescala.engine.rest.SttpClientBackend
import sttp.client3.basicRequest
import sttp.model.Uri
import zio.{ZIO, durationInt}

import scala.concurrent.duration.DurationInt

object WorkerForwardUtil:
  val localWorkerAppUrl = "http://localhost:5555"

  def defaultWorkerAppUrl(topicName: String, workersBasePath: String): Option[String] =
    if workersBasePath == localWorkerAppUrl then
      Some(workersBasePath)
    else
      topicName.split('-')
        .take(2).lastOption
        .map: projectName =>
          s"$workersBasePath/orchescala/$projectName"

  def forwardWorkerRequest(
      topicName: String,
      variables: Json,
      token: String
  )(using config: EngineConfig): ZIO[SttpClientBackend, EngineError, Json] =
    if !config.validateInput then
      ZIO.logDebug("Input validation is disabled (starting a process)")
        .as(variables)
    else
      config.workerAppUrl(topicName)
        .fold(
          // No worker app configured
          ZIO.fail(UnexpectedError(s"Worker not found: $topicName"))
        ): workerAppBaseUrl =>
          forwardRequest(topicName, variables, workerAppBaseUrl, token)
            .mapError: err =>
              ServiceRequestError(err)

  /** Forward a worker request to a remote WorkerApp using HTTP */
  private def forwardRequest(
      topicName: String,
      variables: Json,
      workerAppBaseUrl: String,
      token: String
  ): ZIO[SttpClientBackend, EngineError, Json] =
    (for
      _        <- ZIO.logInfo(s"Forwarding worker request to: $workerAppBaseUrl/worker/$topicName")
      uri      <- ZIO.fromEither(Uri.parse(s"$workerAppBaseUrl/worker/$topicName"))
                    .mapError(err => UnexpectedError(s"Invalid worker app URL: $err"))
      request   = basicRequest
                    .post(uri)
                    .body(variables.toString)
                    .header("Authorization", s"Bearer $token")
      response <- ZIO.serviceWithZIO[SttpClientBackend]: backend =>
                    request
                      .readTimeout(DurationInt(15).seconds)
                      .send(backend)
                      .mapError: err =>
                        ServiceRequestError(503,
                          s"Error connecting to worker app: $err"
                        )
                      .timeoutFail(ServiceRequestError(504, s"Timeout forwarding request to worker app"))(15.seconds)
      _        <- ZIO.logInfo(s"Worker app response status: ${response.code.code}")
      result   <- response.body match
                    case Right(body) =>
                      ZIO.fromEither(parser.parse(body))
                        .mapError(err =>
                          UnexpectedError(s"Failed to parse error response: $err")
                        )
                    case Left(err)   =>
                      ZIO
                        .fromEither(parser.parse(err).flatMap(_.as[ServiceRequestError]))
                        .orElse(ZIO.succeed(ServiceRequestError(response.code.code, truncateErrorBody(err))))
                        .flatMap(ZIO.fail(_))
    yield result).tapError: err =>
      ZIO.logError(s"Error forwarding request to worker app: $err")

  private val MaxErrorBodyLength = 500

  private def truncateErrorBody(body: String): String =
    if body.length <= MaxErrorBodyLength then body
    else body.take(MaxErrorBodyLength) + s"... [truncated, ${body.length} chars total]"

end WorkerForwardUtil
