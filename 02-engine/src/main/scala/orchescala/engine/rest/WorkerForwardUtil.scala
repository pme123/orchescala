package orchescala.engine.rest

import orchescala.engine.EngineConfig
import orchescala.engine.domain.EngineError
import orchescala.engine.domain.EngineError.{ServiceRequestError, UnexpectedError}
import orchescala.engine.rest.SttpClientBackend
import sttp.client3.basicRequest
import sttp.model.Uri
import zio.ZIO

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
                          s"Error forwarding request to worker app: $err\n$variables"
                        )
      _        <- ZIO.logDebug(s"Worker app response status: ${response.code.code}")
      result   <- response.body match
                    case Right(body) =>
                      ZIO.fromEither(parser.parse(body))
                        .mapError(err =>
                          UnexpectedError(s"Failed to parse error response: $err")
                        )
                    case Left(err)   =>
                      for
                        json  <- ZIO
                                   .fromEither(parser.parse(err))
                                   .mapError: err =>
                                     UnexpectedError(s"Failed to parse response to JSON: $err")
                        error <- ZIO
                                   .fromEither(json.as[ServiceRequestError])
                                   .mapError: err =>
                                     UnexpectedError(
                                       s"Failed to parse response to ServiceRequestError: $err"
                                     )
                        _     <- ZIO.fail(error)
                      yield variables // does not happen
    yield result
end WorkerForwardUtil
