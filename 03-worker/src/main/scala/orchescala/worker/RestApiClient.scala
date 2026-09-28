package orchescala.worker

import io.circe.parser
import orchescala.domain.*
import orchescala.engine.rest.SttpClientBackend
import orchescala.worker.*
import orchescala.worker.WorkerError.*
import sttp.client3.*
import sttp.client3.circe.*
import sttp.model.Uri.QuerySegment
import sttp.model.{Header, Uri}
import zio.ZIO

import scala.reflect.ClassTag

trait RestApiClient:

  def sendRequest[
      ServiceIn: InOutEncoder,             // body of service
      ServiceOut: {InOutDecoder, ClassTag} // output of service
  ](
      runnableRequest: RunnableRequest[ServiceIn]
  ): SendRequestType[ServiceOut] =
    for
      _              <- ZIO.logDebug(s"Sending Request: ${runnableRequest.apiUri}")
      reqWithOptBody <- requestWithOptBody(runnableRequest)
      // a service call may take as long as its worker may run (WorkerDsl.timeout) - not only the
      // HTTP client's default of 1 minute
      reqWithTimeout  = summon[EngineRunContext].workerTimeout
                          .fold(reqWithOptBody)(reqWithOptBody.readTimeout)
      _              <- ZIO.logDebug(s"Request created: ${RestApiClient.safeCurl(reqWithTimeout)}")
      req            <- auth(reqWithTimeout)
      _              <- ZIO.logDebug(s"Request authenticated: ${RestApiClient.safeCurl(req)}")
      response       <- ZIO.scoped(sendRequest(req))
      _              <- ZIO.logDebug(s"Response received: ${response.code}")
      statusCode      = response.code
      _              <- ZIO.logDebug(s"Status Code: $statusCode")
      body           <- readBody(statusCode, response, req)
      _              <- ZIO.logDebug(s"Body read: ${orchescala.engine.LogSafe.names(body)}")
      headers         = response.headers.map(h => h.name -> h.value).toMap
      _              <- ZIO.logDebug(s"Headers: ${headers.keys.mkString(", ")}")
      out            <- decodeResponse[ServiceOut](body)
      _              <- ZIO.logDebug(s"Response decoded: ${orchescala.engine.LogSafe.names(out)}")
    yield ServiceResponse(out, headers)

  end sendRequest

  protected def readBody(
      statusCode: StatusCode,
      response: Response[Either[String, String]],
      request: Request[Either[String, String], Any]
  ): IO[ServiceRequestError, String] =
    ZIO.fromEither(response.body)
      .tapError: err =>
        ZIO.logDebug(s"Error response for request: ${RestApiClient.safeCurl(request)}")
      .mapError(body =>
        ServiceRequestError(
          statusCode.code,
          orchescala.engine.LogSafe.withDetails(
            s"Non-2xx response with code $statusCode: ${RestApiClient.safeCurl(request)}",
            RestApiClient.truncate(body)
          )
        )
      )
  end readBody

  // no auth per default
  protected def auth(
      request: Request[Either[String, String], Any]
  )(using
      EngineRunContext
  ): ZIO[SttpClientBackend, ServiceAuthError, Request[Either[String, String], Any]] =
    ZIO.succeed(request)

  protected def sendRequest(
      req: Request[Either[String, String], Any]
  ): ZIO[SttpClientBackend, ServiceUnexpectedError, Response[Either[String, String]]] =
    ZIO.serviceWithZIO[SttpClientBackend]: backend =>
      req.send(backend)
        .mapError: ex =>
          val unexpectedError =
            s"""Unexpected error while sending request: ${ex.getMessage} / ${if ex.getCause != null then ex.getCause.getMessage else "no cause"} / ${ex.getClass}.
               | -> ${RestApiClient.safeCurl(req)}
               |""".stripMargin
          ServiceUnexpectedError(unexpectedError)

  protected def decodeResponse[
      ServiceOut: {InOutDecoder, ClassTag} // output of service
  ](
      body: String
  ): IO[ServiceBadBodyError, ServiceOut] =
    if hasNoOutput[ServiceOut]()
    then
      ZIO
        .attempt(NoOutput().asInstanceOf[ServiceOut])
        .mapError(err =>
          ServiceBadBodyError(s"Problem creating body from response.\n$err${orchescala.engine.LogSafe.detailsSeparator}BODY: ${RestApiClient.truncate(body)}")
        )
    else
      if body.isBlank then
        val runtimeClass = implicitly[ClassTag[ServiceOut]].runtimeClass
        runtimeClass match
          case x if x == classOf[Option[?]] =>
            ZIO
              .attempt(None.asInstanceOf[ServiceOut])
              .mapError: err =>
                ServiceBadBodyError(s"Problem creating body from response.\n$err${orchescala.engine.LogSafe.detailsSeparator}BODY: ${RestApiClient.truncate(body)}")
          case other                        =>
            ZIO.fail(ServiceBadBodyError(
              s"There is no body in the response and the ServiceOut is neither NoOutput nor Option (Class is $other)."
            ))
        end match
      else
        ZIO.fromEither(parser
          .decodeAccumulating[ServiceOut](body)
          .toEither)
          .mapError(err =>
            ServiceBadBodyError(s"Problem creating body from response.\n$err${orchescala.engine.LogSafe.detailsSeparator}BODY: ${RestApiClient.truncate(body)}")
          )

  protected def requestWithOptBody[ServiceIn: InOutEncoder](
      runnableRequest: RunnableRequest[ServiceIn]
  ): IO[ServiceBadBodyError, RequestT[Identity, Either[String, String], Any]] =
    val request =
      requestMethod(
        runnableRequest.httpMethod,
        runnableRequest.apiUri,
        runnableRequest.qSegments,
        runnableRequest.headers
      )
    ZIO.attempt(runnableRequest.requestBodyOpt.map(b =>
      request.body(b.asJson.deepDropNullValues)
    ).getOrElse(request))
      .mapError(err => ServiceBadBodyError(errorMsg = s"Problem creating body for request.\n$err"))
  end requestWithOptBody

  private def requestMethod(
      httpMethod: Method,
      apiUri: Uri,
      qSegments: Seq[QuerySegment],
      headers: Map[String, String]
  ): Request[Either[String, String], Any] =
    basicRequest
      .copy(
        uri = apiUri.addQuerySegments(qSegments),
        headers = headers.toSeq.map { case k -> v => Header(k, v) },
        method = httpMethod
      )
  end requestMethod

  private[worker] def hasNoOutput[ServiceOut: ClassTag](): Boolean =
    val runtimeClass = implicitly[ClassTag[ServiceOut]].runtimeClass
    runtimeClass == classOf[NoOutput]

  extension (request: Request[Either[String, String], Any])

    def addToken(token: String): RequestT[Identity, Either[String, String], Any] =
      request.header("Authorization", s"Bearer $token")

  end extension
end RestApiClient

object DefaultRestApiClient extends RestApiClient

object RestApiClient:

  private val sensitiveName =
    "(?i).*(auth|token|secret|passw|pwd|api[-_]?key|cookie|session|credential|signature).*".r

  /** A header or query parameter whose value is a secret. */
  def isSensitive(name: String): Boolean = sensitiveName.matches(name)

  private val maxResponseBody = 2000

  def truncate(body: String): String =
    if body.length <= maxResponseBody then body
    else s"${body.take(maxResponseBody)}... (${body.length - maxResponseBody} more characters)"

  /** The request as curl for an error - it goes into the incident and the process variable
    * `errorMsg` (Cockpit / Operate, history). Only `Authorization` was masked, and the request body
    * was part of it: API keys in other headers or the query, passwords and personal data of the
    * body were stored in the engine. Now: every header / query parameter with a sensitive name is
    * masked, the body is left out.
    */
  def safeCurl(request: Request[?, ?]): String =
    val uri     = request.uri.copy(querySegments = request.uri.querySegments.map:
      case QuerySegment.KeyValue(k, _, ke, ve) if isSensitive(k) => QuerySegment.KeyValue(k, "masked", ke, ve)
      case other                                                 => other
    )
    val headers = request.headers.map: h =>
      s" -H '${h.name}: ${if isSensitive(h.name) then "masked" else h.value}'"
    val body    = request.body match
      case NoBody               => ""
      case StringBody(b, _, _)  => s" --data-raw '<body not shown - ${b.length} characters>'"
      case ByteArrayBody(b, _)  => s" --data-raw '<body not shown - ${b.length} bytes>'"
      case _                    => " --data-raw '<body not shown>'"
    s"curl -X ${request.method} '$uri'${headers.mkString}$body"
  end safeCurl

end RestApiClient
