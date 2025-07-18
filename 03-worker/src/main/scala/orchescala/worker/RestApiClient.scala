package orchescala.worker

import orchescala.domain.*
import orchescala.worker.*
import orchescala.worker.WorkerError.*
import io.circe.parser
import sttp.client3.*
import sttp.client3.circe.*
import sttp.model.Uri.QuerySegment
import sttp.model.{Header, Uri}
import zio.{Scope, Task, ZIO}

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
      _              <- ZIO.logDebug(s"Request created: ${reqWithOptBody.toCurl}")
      req            <- auth(reqWithOptBody)
      _              <- ZIO.logDebug(s"Request authenticated: ${req.toCurl}")
      response       <- ZIO.scoped(sendRequest(req))
      _              <- ZIO.logDebug(s"Response received: $response")
      statusCode      = response.code
      _              <- ZIO.logDebug(s"Status Code: $statusCode")
      body           <- readBody(statusCode, response, req)
      _              <- ZIO.logDebug(s"Body read: $body")
      headers         = response.headers.map(h => h.name -> h.value).toMap
      _              <- ZIO.logDebug(s"Headers: $headers")
      out            <- decodeResponse[ServiceOut](body)
      _              <- ZIO.logDebug(s"Response decoded: $out")
    yield ServiceResponse(out, headers)

  end sendRequest

  protected def readBody(
      statusCode: StatusCode,
      response: Response[Either[String, String]],
      request: Request[Either[String, String], Any]
  ): IO[ServiceRequestError, String] =
    ZIO.fromEither(response.body)
      .mapError(body =>
        ServiceRequestError(
          statusCode.code,
          s"Non-2xx response with code $statusCode:\n$body\n\n${request.toCurl}"
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
               | -> ${req.toCurl(Set("Authorization"))}
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
          ServiceBadBodyError(s"Problem creating body from response.\n$err\nBODY: $body")
        )
    else
      if body.isBlank then
        val runtimeClass = implicitly[ClassTag[ServiceOut]].runtimeClass
        runtimeClass match
          case x if x == classOf[Option[?]] =>
            ZIO
              .attempt(None.asInstanceOf[ServiceOut])
              .mapError: err =>
                ServiceBadBodyError(s"Problem creating body from response.\n$err\nBODY: $body")
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
            ServiceBadBodyError(s"Problem creating body from response.\n$err\nBODY: $body")
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
      val tokenHeader = if token.startsWith("Bearer") then token else s"Bearer $token"
      request.header("Authorization", tokenHeader)

  end extension
end RestApiClient

object DefaultRestApiClient extends RestApiClient
