package orchescala.engine.rest

import orchescala.engine.{EngineConfig, LogSafe}
import orchescala.engine.domain.EngineError
import orchescala.engine.domain.EngineError.{ServiceRequestError, UnexpectedError}
import orchescala.engine.rest.SttpClientBackend
import sttp.client3.basicRequest
import sttp.model.Uri
import zio.{IO, ZIO, durationInt}

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

  /** Topic names and process ids come from the request path - the worker app URL is derived from
    * them. Only letters, digits, `.`, `_` and `-` (no `/`, `:`, `?`, `#`, `@`, `..`).
    */
  def isValidTopicName(topicName: String): Boolean =
    topicName.matches("[A-Za-z0-9_][A-Za-z0-9._-]*") && !topicName.contains("..")

  def forwardWorkerRequest(
      topicName: String,
      variables: Json,
      token: String
  )(using config: EngineConfig): ZIO[SttpClientBackend, EngineError, Json] =
    if !config.validateInput then
      ZIO.logDebug("Input validation is disabled (starting a process)")
        .as(variables)
    else if !isValidTopicName(topicName) then
      ZIO.fail(ServiceRequestError(400, s"Invalid topic / process name: '$topicName'"))
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
      // the topic as ONE encoded path segment - never part of the host or of other segments
      uri      <- ZIO.fromEither(Uri.parse(workerAppBaseUrl).map(_.addPath("worker", topicName)))
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
    yield response)
      // no answer: no connection, a timeout or an invalid URL
      .tapError(logError)
      .flatMap: response =>
        response.body match
          case Right(body) =>
            ZIO.fromEither(parser.parse(body))
              .mapError(err => UnexpectedError(s"Failed to parse error response: $err"))
              .tapError(logError)
          case Left(body)  =>
            failWith(response.code.code, body)

  /** A non-2xx answer. A refusal of the worker app (e.g. 409 «taken») is an answer, not a failure -
    * info only. The HTTP status decides; the body only shows that the worker app answered (not a
    * proxy, not a missing route): its ServiceRequestError with the same status - the worker app
    * takes the status of a refusal from that errorCode (`WorkerEndpoints.httpStatus`), so they match.
    */
  private def failWith(status: Int, body: String): IO[ServiceRequestError, Nothing] =
    val answer  = parser.parse(body).flatMap(_.as[ServiceRequestError]).toOption
    val err     = answer.getOrElse(ServiceRequestError(status, truncateErrorBody(body)))
    val refusal = ServiceRequestError.isRefusal(status) && answer.exists(_.errorCode == status)
    (if refusal then ZIO.logInfo(s"Worker app refused the request: ${forLog(err)}")
     else logError(err)) *> ZIO.fail(err)

  private def logError(err: EngineError) =
    ZIO.logError(s"Error forwarding request to worker app: ${forLog(err)}")

  private def forLog(err: EngineError): String =
    LogSafe.forLog(err.toString, "in the response")

  private val MaxErrorBodyLength = 500

  private def truncateErrorBody(body: String): String =
    if body.length <= MaxErrorBodyLength then body
    else body.take(MaxErrorBodyLength) + s"... [truncated, ${body.length} chars total]"

end WorkerForwardUtil
