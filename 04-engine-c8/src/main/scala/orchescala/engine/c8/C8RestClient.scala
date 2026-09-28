package orchescala.engine.c8

import io.circe.{Decoder, Json, parser}
import orchescala.engine.domain.EngineError
import orchescala.engine.domain.EngineError.{ServiceError, ServiceRequestError}
import orchescala.engine.rest.{HttpClientProvider, SttpClientBackend}
import sttp.client3.*
import sttp.model.{MediaType, Method, Part, StatusCode, Uri}
import zio.*

import scala.concurrent.duration.FiniteDuration

/** Stateless client for the Camunda 8 REST API (v2) used by the C8 engine services.
  *
  * All calls run on the shared sttp backend ([[HttpClientProvider]]); the `Authorization` header
  * is resolved per request by [[C8RestAuth]]. So there is exactly one connection pool, whatever
  * number of callers / tokens - nothing to cache per identity, nothing to close.
  *
  * The job workers keep using the `CamundaClient` SDK (job streaming, backoff) - see
  * [[C8Client.client]].
  *
  * @param restAddress
  *   the cluster's REST address, e.g. `http://localhost:8080` (`/v2` is appended)
  */
final class C8RestClient(
    restAddress: String,
    auth: C8RestAuth,
    backend: => SttpClientBackend = HttpClientProvider.cachedBackend,
    requestTimeout: FiniteDuration = C8RestClient.defaultRequestTimeout,
    retryBase: Duration = 200.millis
):
  import C8RestClient.*

  private lazy val baseUri: Uri = Uri.unsafeParse(restAddress.stripSuffix("/") + "/v2")

  def get[R: Decoder](path: Seq[String]): IO[EngineError, R] =
    send(Method.GET, path)(identity).flatMap(decode[R](path))

  def post[R: Decoder](path: Seq[String], body: Json, query: Map[String, String] = Map.empty)
      : IO[EngineError, R] =
    send(Method.POST, path, query)(jsonBody(body)).flatMap(decode[R](path))

  /** For endpoints answering 204 / an irrelevant body. */
  def postNoContent(path: Seq[String], body: Json): IO[EngineError, Unit] =
    send(Method.POST, path)(jsonBody(body)).unit

  def putNoContent(path: Seq[String], body: Json): IO[EngineError, Unit] =
    send(Method.PUT, path)(jsonBody(body)).unit

  def postMultipart[R: Decoder](
      path: Seq[String],
      parts: Seq[Part[RequestBody[Any]]],
      timeout: FiniteDuration = requestTimeout
  ): IO[EngineError, R] =
    send(Method.POST, path, timeout = timeout)(_.multipartBody(parts)).flatMap(decode[R](path))

  /** Runs a search and follows the result cursor until all items are read, but at most `maxItems`
    * (then a warning is logged) - the API returns a page of 100 items by default, which silently
    * truncated results before.
    */
  def searchAll[R: Decoder](
      path: Seq[String],
      filter: Json,
      query: Map[String, String] = Map.empty,
      pageSize: Int = defaultPageSize,
      maxItems: Int = defaultMaxSearchItems
  ): IO[EngineError, Seq[R]] =
    def loop(after: Option[String], acc: Vector[R]): IO[EngineError, Seq[R]] =
      val page = Json.obj(
        "limit" -> Json.fromInt(pageSize.min(maxItems - acc.size)),
        "after" -> after.fold(Json.Null)(Json.fromString)
      ).dropNullValues
      post[SearchResult[R]](path, Json.obj("filter" -> filter, "page" -> page), query)
        .flatMap: result =>
          val items = acc ++ result.items
          val next  = result.page.flatMap(_.endCursor)
          if result.items.size < pageSize.min(maxItems - acc.size) || next.isEmpty then
            ZIO.succeed(items)
          else if items.size >= maxItems then
            ZIO.logWarning(
              s"C8 search ${path.mkString("/")} stopped after $maxItems items - result is incomplete."
            ).as(items)
          else loop(next, items)
    end loop
    loop(None, Vector.empty)
  end searchAll

  private def jsonBody(body: Json)(req: RequestT[Identity, String, Any]) =
    req.body(body.deepDropNullValues.noSpaces).contentType(MediaType.ApplicationJson)

  /** Sends the request and returns the body of a 2xx response.
    *
    *   - 429 / 503 (backpressure - the cluster rejected the request before processing it): retried
    *     with exponential backoff, so also safe for non-idempotent commands.
    *   - 401: retried once, if the [[C8RestAuth]] can get a fresh credential.
    *   - any other status: [[ServiceRequestError]] with that status, so the gateway can pass it on
    *     (404, 400, 403, ...).
    */
  private def send(
      method: Method,
      path: Seq[String],
      query: Map[String, String] = Map.empty,
      timeout: FiniteDuration = requestTimeout
  )(withBody: RequestT[Identity, String, Any] => RequestT[Identity, String, Any])
      : IO[EngineError, String] =
    val uri = baseUri.addPath(path).addParams(query)

    val once: IO[Failure, String] =
      for
        authHeader <- auth.authorization.mapError(Failure.Fatal(_))
        request     = withBody(
                        authHeader
                          .fold(basicRequest)(basicRequest.header("Authorization", _))
                          .method(method, uri)
                          .header("Accept", MediaType.ApplicationJson.toString)
                          .readTimeout(timeout)
                          .response(asStringAlways)
                      )
        response   <- request
                        .send(backend)
                        .mapError: ex =>
                          Failure.Fatal(ServiceError(s"C8 REST $method $uri failed: $ex"))
        body       <- response.code match
                        case code if code.isSuccess                    =>
                          ZIO.succeed(response.body)
                        case StatusCode.Unauthorized                   =>
                          ZIO.fail(Failure.Unauthorized(problem(method, uri, response)))
                        case StatusCode.TooManyRequests | StatusCode.ServiceUnavailable =>
                          ZIO.fail(Failure.Retryable(problem(method, uri, response)))
                        case _                                         =>
                          ZIO.fail(Failure.Fatal(problem(method, uri, response)))
      yield body

    once
      .catchSome:
        case Failure.Unauthorized(err) =>
          ZIO.ifZIO(auth.invalidate)(once, ZIO.fail(Failure.Fatal(err)))
      .retry(
        Schedule.recurWhile[Failure](_.isInstanceOf[Failure.Retryable]) &&
          Schedule.exponential(retryBase) &&
          Schedule.recurs(maxRetries)
      )
      .mapError(_.error)
  end send

end C8RestClient

object C8RestClient:

  val defaultRequestTimeout: FiniteDuration = scala.concurrent.duration.Duration(30, "seconds")
  val deployTimeout: FiniteDuration         = scala.concurrent.duration.Duration(2, "minutes")
  val defaultPageSize: Int                  = 1000
  val defaultMaxSearchItems: Int            = 10000
  private val maxRetries                    = 3
  private val maxErrorBodyLength            = 500

  final case class PageResponse(endCursor: Option[String])
  final case class SearchResult[R](items: Seq[R], page: Option[PageResponse])

  given Decoder[PageResponse]                     = io.circe.generic.semiauto.deriveDecoder
  given [R: Decoder]: Decoder[SearchResult[R]] =
    Decoder.forProduct2("items", "page")(SearchResult.apply[R])

  private enum Failure(val error: EngineError):
    case Retryable(err: EngineError)    extends Failure(err)
    case Unauthorized(err: EngineError) extends Failure(err)
    case Fatal(err: EngineError)        extends Failure(err)

  /** Error of a non-2xx response - the RFC 9457 problem detail (`title`, `detail`) if present. */
  private def problem(method: Method, uri: Uri, response: Response[String]): EngineError =
    val details = parser.parse(response.body).toOption
      .map(_.hcursor)
      .map(c => Seq("title", "detail").flatMap(c.get[String](_).toOption).mkString(": "))
      .filter(_.nonEmpty)
      .getOrElse(response.body.take(maxErrorBodyLength))
    ServiceRequestError(
      response.code.code,
      s"C8 REST $method /${uri.path.mkString("/")} -> ${response.code.code}: $details"
    )
  end problem

  private def decode[R: Decoder](path: Seq[String])(body: String): IO[EngineError, R] =
    ZIO
      .fromEither(parser.decode[R](if body.isBlank then "{}" else body))
      .mapError: err =>
        EngineError.DecodingError(
          s"Problem decoding C8 REST response of ${path.mkString("/")} (${body.length} characters): $err"
        )

end C8RestClient
