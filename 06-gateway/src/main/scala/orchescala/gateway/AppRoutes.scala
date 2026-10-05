package orchescala.gateway

import orchescala.engine.rest.{HttpClientProvider, SttpClientBackend}
import orchescala.worker.UiRoutes
import sttp.capabilities.zio.ZioStreams
import sttp.client3.{asStreamAlways, basicRequest}
import sttp.model.Uri
import zio.*
import zio.http.*
import zio.stream.ZStream

/** Routes for the UI bundles of the projects.
  *
  * The browser loads the UI of a project from the gateway; the gateway forwards the request
  * unchanged to the worker app of the project, which serves the bundle under `/ui/` (see
  * `orchescala.worker.UiRoutes`):
  *
  * {{{
  * GET /app/{projectName}/assets/index-3f9a.js  →  {uiAppUrl(projectName)}/ui/assets/index-3f9a.js
  * }}}
  *
  * So UI and API of a project come from one origin and the worker apps need no ingress.
  *
  *   - GET /app/{projectName} - redirects to `/app/{projectName}/` so relative links resolve
  *   - GET /app/{projectName}/{path} - forwarded to the worker app
  *
  * The bundle holds no data and needs no token - the app signs in itself (OIDC) and sends the
  * Bearer token with every API call. Content type and cache headers of the worker app are passed
  * through; the gateway adds the security headers.
  *
  * Like [[orchescala.worker.UiRoutes]] it assumes a normal web bundle: files are forwarded whole
  * (buffered, at most [[GatewayConfig.uiMaxFileSize]]), only `GET`, no `Range` requests - so the
  * worker app answers 200, 304 or 4xx; anything else is a failure of the worker app (502).
  */
class AppRoutes(
    // live is ZLayer.succeed(cachedBackend): the one shared backend, no client per request
    backend: ZLayer[Any, Throwable, SttpClientBackend] = HttpClientProvider.live
)(using config: GatewayConfig):

  def routes: Routes[Any, Response] =
    Routes(
      Method.GET / "app" / string("projectName")            -> handler {
        (projectName: String, request: Request) =>
          if request.url.path.hasTrailingSlash then forward(projectName, Seq.empty, request)
          else ZIO.succeed(canonicalRedirect(projectName, request))
      },
      Method.GET / "app" / string("projectName") / trailing -> handler {
        (projectName: String, path: Path, request: Request) =>
          forward(projectName, path.segments, request)
      }
    )

  /** Keeps the query - e.g. `code` and `state` of an OIDC login that returns to
    * `/app/{projectName}`.
    */
  private[gateway] def canonicalRedirect(projectName: String, request: Request): Response =
    if isValidProjectName(projectName) then
      val query = request.url.encode.dropWhile(_ != '?')
      Response
        .status(Status.Found) // not cached for ever, like the /site redirect
        .addHeader(Header.Custom("Location", s"/app/$projectName/$query"))
    else withSecurityHeaders(Status.NotFound)

  /** Forwards a request for the UI bundle to the worker app of the project.
    *
    * Like the docs forwarding: the project name becomes the host of the default URL, so only a
    * plain host name is accepted. The path segments are decoded and checked first (`%2e%2e` is
    * `..`), then they go into the URL encoded again - once.
    */
  private def forward(
      projectName: String,
      segments: Seq[String],
      request: Request
  ): UIO[Response] =
    (for
      _       <- Option.when(isValidProjectName(projectName))(())
      decoded <- UiRoutes.decodeSegments(segments)
      baseUrl <- config.uiAppUrl(projectName)
    yield decoded -> baseUrl) match
      case None                     =>
        ZIO.succeed(withSecurityHeaders(Status.NotFound))
      case Some((decoded, baseUrl)) =>
        (for
          uri      <- ZIO.fromEither(uiUri(baseUrl, decoded))
                        .mapError(err => s"Invalid UI URL: $err")
          response <- ZIO.serviceWithZIO[SttpClientBackend]: backend =>
                        basicRequest
                          .get(uri)
                          .headers(conditionalHeaders(request).toMap)
                          .followRedirects(false) // only the worker app - never another host
                          // read inside the response handling: sttp releases the connection,
                          // also when the cap stops reading early
                          .response(asStreamAlways(ZioStreams)(stream =>
                            readCapped(stream, config.uiMaxFileSize)
                              .mapError(RuntimeException(_)): Task[Array[Byte]]
                          ))
                          .send(backend)
                          .mapError(_.getMessage)
          _        <- ZIO.when(response.code.code >= 500)(
                        ZIO.logWarning(s"UI request $uri of '$projectName' answered ${response.code.code}")
                      )
        yield toResponse(response.code.code, response.body, response.header))
          .provideLayer(backend)
          .catchAll: err =>
            ZIO.logError(s"Error forwarding UI request for '$projectName': $err")
              .as(withSecurityHeaders(Status.BadGateway))

  /** Reads the answer of the worker app - but no more than `max` bytes (a misconfigured `uiAppUrl`
    * must not fill the memory of the gateway).
    */
  private[gateway] def readCapped(
      stream: ZStream[Any, Throwable, Byte],
      max: Int
  ): IO[String, Array[Byte]] =
    stream.take(max.toLong + 1).runCollect
      .mapError(_.getMessage)
      .filterOrFail(_.size <= max)(s"larger than $max bytes")
      .map(_.toArray)

  private[gateway] def uiUri(baseUrl: String, segments: Seq[String]): Either[String, Uri] =
    Uri.parse(baseUrl).map(_.addPath("ui" +: segments))

  /** Lets the browser revalidate its cache (304) and the worker app tell page from file requests.
    */
  private def conditionalHeaders(request: Request): Seq[(String, String)] =
    Seq("If-None-Match", "If-Modified-Since", "Accept")
      .flatMap(name => request.rawHeader(name).map(name -> _))

  private[gateway] def toResponse(
      status: Int,
      body: Array[Byte],
      header: String => Option[String]
  ): Response =
    val passedHeaders =
      Seq("Content-Type", "Cache-Control", "ETag", "Last-Modified", "Vary")
        .flatMap(name => header(name).map(Header.Custom(name, _)))
    status match
      case 200                                     =>
        Response(
          status = Status.Ok,
          body = Body.fromArray(body),
          headers = Headers(passedHeaders ++ securityHeaders)
        )
      case 304                                     =>
        Response(status = Status.NotModified, headers = Headers(passedHeaders ++ securityHeaders))
      case client if client >= 400 && client < 500 =>
        Response(
          status = Status.fromInt(client),
          headers = Headers(passedHeaders ++ securityHeaders)
        )
      case _                                       => // the worker app failed (or answered unexpectedly) - logged in forward
        withSecurityHeaders(Status.BadGateway)
    end match
  end toResponse

  private def withSecurityHeaders(status: Status): Response =
    Response(status = status, headers = Headers(securityHeaders))

  private def securityHeaders: Seq[Header] =
    Seq(
      Header.Custom("X-Content-Type-Options", "nosniff"),
      Header.Custom("Referrer-Policy", "strict-origin-when-cross-origin")
    ) ++ config.uiContentSecurityPolicy.map(Header.Custom("Content-Security-Policy", _))

  /** A plain host name - the default `uiAppUrl` takes the project name as host. */
  private[gateway] def isValidProjectName(projectName: String): Boolean =
    projectName.matches("[A-Za-z0-9]+(-[A-Za-z0-9]+)*")

end AppRoutes
