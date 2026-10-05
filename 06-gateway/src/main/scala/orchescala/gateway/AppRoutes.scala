package orchescala.gateway

import orchescala.engine.rest.{HttpClientProvider, SttpClientBackend}
import orchescala.worker.UiRoutes
import sttp.client3.{asByteArrayAlways, basicRequest}
import sttp.model.Uri
import zio.*
import zio.http.*

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
  */
class AppRoutes()(using config: GatewayConfig):

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

  /** Keeps the query - e.g. `code` and `state` of an OIDC login that returns to `/app/{projectName}`. */
  private[gateway] def canonicalRedirect(projectName: String, request: Request): Response =
    if isValidProjectName(projectName) then
      val query = request.url.encode.dropWhile(_ != '?')
      Response
        .status(Status.MovedPermanently)
        .addHeader(Header.Custom("Location", s"/app/$projectName/$query"))
    else Response.status(Status.NotFound)

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
      _        <- Option.when(isValidProjectName(projectName))(())
      decoded  <- UiRoutes.decodeSegments(segments)
      baseUrl  <- config.uiAppUrl(projectName)
    yield decoded -> baseUrl) match
      case None                     =>
        ZIO.succeed(Response.status(Status.NotFound))
      case Some((decoded, baseUrl)) =>
        (for
          uri      <- ZIO.fromEither(uiUri(baseUrl, decoded))
                        .mapError(err => s"Invalid UI URL: $err")
          response <- ZIO.serviceWithZIO[SttpClientBackend]: backend =>
                        basicRequest
                          .get(uri)
                          .headers(conditionalHeaders(request).toMap)
                          .response(asByteArrayAlways)
                          .send(backend)
                          .mapError(_.getMessage)
          _        <- ZIO.when(response.code.code >= 500)(
                        ZIO.logWarning(s"UI request $uri of '$projectName' answered ${response.code.code}")
                      )
        yield toResponse(response.code.code, response.body, response.header))
          // the shared backend of the gateway - not a new client per request
          .provideLayer(HttpClientProvider.live)
          .catchAll: err =>
            ZIO.logError(s"Error forwarding UI request for '$projectName': $err")
              .as(Response.status(Status.BadGateway))

  private[gateway] def uiUri(baseUrl: String, segments: Seq[String]): Either[String, Uri] =
    Uri.parse(baseUrl).map(_.addPath("ui" +: segments))

  /** Lets the browser revalidate its cache (304) and the worker app tell page from file requests. */
  private def conditionalHeaders(request: Request): Seq[(String, String)] =
    Seq("If-None-Match", "If-Modified-Since", "Accept")
      .flatMap(name => request.rawHeader(name).map(name -> _))

  private[gateway] def toResponse(
      status: Int,
      body: Array[Byte],
      header: String => Option[String]
  ): Response =
    val passedHeaders =
      Seq("Content-Type", "Cache-Control", "ETag", "Last-Modified")
        .flatMap(name => header(name).map(Header.Custom(name, _)))
    status match
      case 200        =>
        Response(
          status = Status.Ok,
          body = Body.fromArray(body),
          headers = Headers(passedHeaders ++ securityHeaders)
        )
      case 304        =>
        Response(status = Status.NotModified, headers = Headers(passedHeaders ++ securityHeaders))
      case client if client >= 400 && client < 500 =>
        Response.status(Status.fromInt(client))
      case _          => // the worker app failed (or answered unexpectedly) - logged in forward
        Response.status(Status.BadGateway)
    end match
  end toResponse

  private def securityHeaders: Seq[Header] =
    Seq(
      Header.Custom("X-Content-Type-Options", "nosniff"),
      Header.Custom("Referrer-Policy", "strict-origin-when-cross-origin")
    ) ++ config.uiContentSecurityPolicy.map(Header.Custom("Content-Security-Policy", _))

  /** A plain host name - the default `uiAppUrl` takes the project name as host. */
  private[gateway] def isValidProjectName(projectName: String): Boolean =
    projectName.matches("[A-Za-z0-9]+(-[A-Za-z0-9]+)*")

end AppRoutes
