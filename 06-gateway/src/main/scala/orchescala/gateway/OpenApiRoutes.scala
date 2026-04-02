package orchescala.gateway

import io.circe.parser as circeParser
import java.net.JarURLConnection
import java.nio.file.{Files, Paths}
import java.util.concurrent.ConcurrentHashMap
import orchescala.engine.rest.{HttpClientProvider, SttpClientBackend}
import sttp.client3.basicRequest
import sttp.model.Uri
import scala.jdk.CollectionConverters.*
import zio.*
import zio.http.*

/** Routes for serving OpenAPI documentation.
  */
class OpenApiRoutes()(using config: GatewayConfig):

  private case class OAuth2CodeExchangeEntry(
      createdAtMillis: Long,
      promise: Promise[Nothing, Either[String, String]]
  )

  private val oauth2CodeExchanges = ConcurrentHashMap[String, OAuth2CodeExchangeEntry]()
  private val oauth2CodeExchangeTtlMillis = 10.minutes.toMillis
  private val docsTokenCookieName         = "orchescala_docs_token"
  private val oauth2StateCookieName       = "orchescala_oauth_state"
  private val oauth2TargetCookieName      = "orchescala_oauth_target"
  private val defaultOAuth2Target         = "/docs"
  private val siteVersionSegmentPattern   = raw"\d{4}-\d{2}".r

  /** Creates routes for serving OpenAPI documentation and company documentation.
    *
    * Provides:
    *   - GET /site - Redirects to `/site/` so relative links resolve correctly
    *   - GET /site/ - Company documentation index (served from classpath `site/index.html`)
    *   - GET /site/{path} - Company documentation static files (served from classpath `site/{path}`)
    *   - GET /docs - HTML documentation page (gateway)
    *   - GET /docs/OpenApi.yml - OpenAPI specification in YAML format (gateway)
    *   - GET /docs/openApis/{projectName} - Forwards to projectName worker app /docs
    *   - GET /docs/openApis/{projectName}/OpenApi.yml - Forwards to projectName worker app
    *     /docs/OpenApi.yml
    *   - GET /docs/oauth2/callback - OAuth 2.0 Authorization Code callback (when OAuth2 is configured)
    *
    * Authentication is applied to all `/docs` and `/site` routes according to [[GatewayConfig.docsAuth]].
    *
    * @return
    *   ZIO HTTP routes for documentation
    */
  def routes: Routes[Any, Response] =
    val protectedRoutes = Routes(
      // Canonicalize only the exact /site path so relative links like ./valiant/... resolve
      // below /site/ without causing a redirect loop on the already-canonical /site/ URL.
      Method.GET / "site" -> handler {
        (request: Request) =>
          if needsCanonicalSiteRedirect(request.url.path.toString) then
            ZIO.succeed(siteCanonicalRedirectResponse)
          else
            serveClasspathFile("site/index.html")
      },

      // Serve company documentation index and static files (e.g. /site/, /site/valiant/index.html)
      Method.GET / "site" / trailing -> handler { (path: Path, request: Request) =>
        val relativePath = path.segments.mkString("/")
        siteFolderRedirectLocation(relativePath, request.url.path.toString)
          .flatMap: location =>
            versionedSiteRedirect(location.stripPrefix("/site/")).orElse(Some(location))
          .orElse(versionedSiteRedirect(relativePath)) match
          case Some(location) => ZIO.succeed(siteVersionRedirectResponse(location))
          case None           => serveClasspathFile(siteResourcePath(relativePath))
      },

      // Serve OpenAPI YAML specification at /docs/OpenApi.yml
      Method.GET / "docs" / "OpenApi.yml" -> handler {
        val yaml = OpenApiGenerator.generateYaml
        Response.text(yaml).addHeader(Header.ContentType(MediaType.text.yaml))
      },

      // Forward docs HTML page for a project worker app
      // Rewrites relative "diagrams/" links so they resolve correctly under /docs/openApis/{projectName}/
      Method.GET / "site" / string("companyName") / string("projectName") / "OpenApi.html" -> handler {
        (_: String, projectName: String, _: Request) =>
          forwardDocsRequest(
            projectName,
            "docs",
            MediaType.text.html,
            body => body//.replace("\"diagrams/\"", s"\"${projectName}/diagrams/\"")
          )
      },

      // Forward OpenApi.yml for a project worker app
      Method.GET / "site" / string("companyName") / string("projectName") / "OpenApi.yml" -> handler {
        (_: String, projectName: String, _: Request) =>
          forwardDocsRequest(projectName, "docs/OpenApi.yml", MediaType.text.yaml)
      },

      // Forward BPMN/DMN diagrams for a project worker app
      Method.GET / "site" / string("companyName") / string("projectName") / "diagrams" / string(
        "diagramName"
      ) -> handler {
        (_: String, projectName: String, diagramName: String, _: Request) =>
          forwardDocsRequest(projectName, s"docs/diagrams/$diagramName", MediaType.application.xml)
      },

      // Serve HTML documentation page
      Method.GET / "docs" -> handler {
        ZIO.attempt {
          val htmlContent = scala.io.Source
            .fromResource("OpenApi.html")
            .mkString
          Response.text(htmlContent).addHeader(Header.ContentType(MediaType.text.html))
        }.catchAll { error =>
          ZIO.succeed(
            Response.text(s"Error loading documentation: ${error.getMessage}")
              .status(Status.InternalServerError)
          )
        }
      }
    )

    // Favicon is always public (browsers request it automatically)
    val faviconRoute = Routes(
      Method.GET / "favicon.ico" -> handler {
        ZIO.attempt {
          val faviconBytes = scala.io.Source
            .fromResource("favicon.ico")(using scala.io.Codec.ISO8859)
            .map(_.toByte)
            .toArray
          Response(
            body    = Body.fromArray(faviconBytes),
            headers = Headers(Header.ContentType(MediaType.image.`x-icon`))
          )
        }.catchAll(_ => ZIO.succeed(Response.status(Status.NotFound)))
      }
    )

    config.docsAuth match
      case DocsAuth.Disabled =>
        protectedRoutes ++ faviconRoute

      case auth: DocsAuth.BasicAuth =>
        // HandlerAspect.basicAuth performs constant-time credential comparison and
        // replies with WWW-Authenticate: Basic so browsers show a login dialog.
        (protectedRoutes @@ HandlerAspect.basicAuth(auth.username, auth.password)) ++ faviconRoute

      case auth: DocsAuth.OAuth2AuthCode =>
        // The middleware only checks the token cookie and redirects to Keycloak if absent.
        // The Keycloak callback is handled by a dedicated public route at /docs/oauth2/callback,
        // which avoids OAuth2 query params (code, state, …) ever landing on the main /docs page.
        (protectedRoutes @@ oauth2AuthMiddleware(auth)) ++ oauth2CallbackRoute(auth) ++ faviconRoute

  private def forwardDocsRequest(
      projectName: String,
      path: String,
      contentType: MediaType,
      transform: String => String = identity
  ): ZIO[Any, Nothing, Response] =
    config.docsAppUrl(projectName) match
      case None          =>
        ZIO.logWarning(
          s"No docs URL configured for project: $projectName"
        ).as(Response.status(Status.NotFound))
      case Some(baseUrl) =>
        (for
          _        <- ZIO.logInfo(s"Forwarding docs request to: $baseUrl/$path")
          uri      <- ZIO.fromEither(Uri.parse(s"$baseUrl/$path"))
                        .mapError(err => s"Invalid docs URL: $err")
          request   = basicRequest.get(uri)
          response <- ZIO.serviceWithZIO[SttpClientBackend]: backend =>
                        request.send(backend).mapError(_.getMessage)
          result   <- response.body match
                        case Right(body) =>
                          ZIO.succeed(Response.text(transform(body)).addHeader(Header.ContentType(contentType)))
                        case Left(err)   =>
                          ZIO.logError(
                            s"Error response from docs service '$projectName': $err"
                          ).as(Response.status(Status.BadGateway))
        yield result)
          .provideLayer(HttpClientProvider.live)
          .catchAll: err =>
            ZIO.logError(
              s"Error forwarding docs request for '$projectName': $err"
            ).as(Response.status(Status.InternalServerError))

  // ---------------------------------------------------------------------------
  // OAuth 2.0 Authorization Code Grant helpers
  // ---------------------------------------------------------------------------

  /** Middleware that protects routes with OAuth 2.0 Authorization Code Grant.
    *
    * Two cases on every request:
    *
    *   1. Token cookie present → pass through to the handler.
    *   2. No cookie → redirect browser to Keycloak authorization URL.
    *
    * The Keycloak callback is handled by the dedicated public route
    * `GET /docs/oauth2/callback` (see [[oauth2CallbackRoute]]), which exchanges the
    * authorization code for a token and then issues a clean redirect back to the
    * originally requested protected page (`/docs` or `/site`).
    * This ensures that OAuth2 query params (code, state, …) never appear on the
    * `/docs` page itself, preventing parameter accumulation caused by multiple
    * simultaneous sub-requests each triggering their own Keycloak redirect.
    */
  private def oauth2AuthMiddleware(auth: DocsAuth.OAuth2AuthCode): Middleware[Any] =
    new Middleware[Any]:
      def apply[Env1 <: Any, Err](routes: Routes[Env1, Err]): Routes[Env1, Err] =
        routes.transform[Env1]: handler =>
          Handler.scoped[Env1]:
            zio.http.handler: (request: Request) =>
              request.cookie(docsTokenCookieName) match

                // ── 1. Authenticated ────────────────────────────────────────
                case Some(cookie) if cookie.content.nonEmpty =>
                  handler(request)

                // ── 2. No token → redirect to Keycloak ──────────────────────
                case _ =>
                  val state       = java.util.UUID.randomUUID().toString
                  val target      = deriveOAuth2Target(request)
                  val redirectUri = deriveCallbackUri(request)
                  val authUrl     = buildOAuthUrl(auth, state, redirectUri)
                  ZIO.logInfo(s"Redirecting to Keycloak: $authUrl \n- RedirectUri: $redirectUri\n- Target: $target\n- State: $state").as:
                    Response(status = Status.Found, headers = Headers("location" -> authUrl))
                      .addCookie(
                        Cookie.Response(
                          name       = oauth2StateCookieName,
                          content    = state,
                          path       = Some(Path.root),
                          isHttpOnly = true,
                          sameSite   = Some(Cookie.SameSite.Lax)
                        )
                      )
                      .addCookie(
                        Cookie.Response(
                          name       = oauth2TargetCookieName,
                          content    = target,
                          path       = Some(Path.root),
                          isHttpOnly = true,
                          sameSite   = Some(Cookie.SameSite.Lax)
                        )
                      )

  /** Public (unprotected) route that handles the Keycloak authorization-code callback.
    *
    * Keycloak redirects here (`/docs/oauth2/callback?code=…&state=…`) after the user
    * authenticates. The route verifies the CSRF state, exchanges the code for an access
    * token, stores it in an HTTP-only cookie and issues a clean redirect back to the
    * originally requested protected page.
    * Because this is a dedicated route (not `/docs`), OAuth2 query params can never
    * accumulate on the docs page regardless of how many parallel sub-requests are in flight.
    */
  private def oauth2CallbackRoute(auth: DocsAuth.OAuth2AuthCode): Routes[Any, Nothing] =
    Routes(
      Method.GET / "docs" / "oauth2" / "callback" -> handler { (request: Request) =>
        val codeOpt     = request.queryParam("code")
        val stateOpt    = request.queryParam("state")
        val storedState = request.cookie(oauth2StateCookieName).map(_.content)
        val target      = request.cookie(oauth2TargetCookieName).map(_.content).flatMap(sanitizeOAuth2Target).getOrElse(defaultOAuth2Target)

        // Build the redirect_uri from the *actual* URL the user called (path taken
        // directly from request.url, not reconstructed from a hard-coded string).
        // This guarantees it is byte-for-byte identical to the URI Keycloak received
        // during the authorization request, which is required for the token exchange.
        val scheme      = request.rawHeader("X-Forwarded-Proto").getOrElse("http")
        val host        = request.header(Header.Host).map(_.renderedValue).getOrElse("localhost")
        val callbackUri = s"$scheme://$host${request.url.path}"

        (codeOpt, stateOpt) match

          // ── Valid callback: state matches ────────────────────────────────
          case (Some(code), Some(state)) if storedState.contains(state) =>
            exchangeCodeForTokenOnce(auth, code, callbackUri)
              .foldZIO(
                err =>
                  ZIO.logError(s"OAuth2 token exchange failed: $err")
                    .as(
                      Response.text(s"OAuth2 token exchange failed:\n$err")
                        .status(Status.BadGateway)
                        .addCookie(clearRootCookie(oauth2StateCookieName))
                        .addCookie(clearRootCookie(oauth2TargetCookieName))
                    ),
                token =>
                  ZIO.succeed:
                    oauth2ContinuePageResponse(target)
                      .addCookie(docsTokenCookie(token))
                      .addCookie(clearRootCookie(oauth2StateCookieName))
                      .addCookie(clearRootCookie(oauth2TargetCookieName))
              )

          // ── State mismatch (CSRF / stale request) ───────────────────────
          case (Some(_), Some(_)) =>
            ZIO.logWarning("OAuth2: state mismatch – possible CSRF attempt or stale callback")
              .as(
                Response.status(Status.Unauthorized)
                  .addCookie(clearRootCookie(oauth2StateCookieName))
                  .addCookie(clearRootCookie(oauth2TargetCookieName))
              )

          // ── Missing code or state → restart the flow ────────────────────
          case _ =>
            ZIO.logWarning(s"OAuth2 callback: missing code or state, redirecting to $target")
              .as(
                oauth2ContinuePageResponse(target)
                  .addCookie(clearRootCookie(oauth2StateCookieName))
                  .addCookie(clearRootCookie(oauth2TargetCookieName))
              )
      }
    )

  /** Returns a tiny HTML page that navigates to the target on the client side.
    *
    * Why not a plain HTTP 302? During the OAuth callback flow the browser is still in a
    * cross-site redirect chain from Keycloak (`Sec-Fetch-Site: cross-site`). Some browsers
    * do not send the freshly-set cookie on the *immediately-following* redirected request,
    * which produces an auth loop (`/callback` -> protected page -> Keycloak -> ...). Returning
    * a same-origin HTML page and letting JavaScript navigate to the final target breaks that
    * chain, so the next request is a normal first-party navigation and the docs cookie is
    * included.
    */
  private def oauth2ContinuePageResponse(target: String): Response =
    Response(
      status = Status.Ok,
      body = Body.fromString(
        s"""<!doctype html>
           |<html lang=\"en\">
           |  <head>
           |    <meta charset=\"utf-8\" />
           |    <meta http-equiv=\"Cache-Control\" content=\"no-store\" />
           |    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
           |    <title>Signing in...</title>
           |  </head>
           |  <body>
           |    <p>Sign-in complete. Continuing...</p>
           |    <script>
           |      window.location.replace(${renderJsStringLiteral(target)});
           |    </script>
           |    <noscript>
           |      <meta http-equiv=\"refresh\" content=\"0;url=$target\" />
           |      <p><a href=\"$target\">Continue</a></p>
           |    </noscript>
           |  </body>
           |</html>
           |""".stripMargin
      ),
      headers = Headers(
        Header.ContentType(MediaType.text.html),
        Header.CacheControl.NoStore
      )
    )

  private def renderJsStringLiteral(value: String): String =
    "\"" + value.flatMap {
      case '\\' => "\\\\"
      case '\"' => "\\\""
      case '\n' => "\\n"
      case '\r' => "\\r"
      case '\t' => "\\t"
      case c    => c.toString
    } + "\""

  private[gateway] def docsTokenCookie(token: String): Cookie.Response =
    Cookie.Response(
      name       = docsTokenCookieName,
      content    = token,
      path       = Some(Path.root),
      isHttpOnly = true,
      // `/site` is protected by the same OAuth2 middleware as `/docs`, so the cookie must be
      // available on both route trees after the callback lands on the original target page.
      // `Lax` still allows the first top-level navigation back from Keycloak while avoiding the
      // stricter behavior that can trigger an auth loop immediately after login.
      sameSite   = Some(Cookie.SameSite.Lax),
      maxAge     = Some(1.hour)
    )

  private def clearRootCookie(name: String): Cookie.Response =
    Cookie.Response(
      name       = name,
      content    = "",
      path       = Some(Path.root),
      isHttpOnly = true,
      sameSite   = Some(Cookie.SameSite.Lax),
      maxAge     = Some(Duration.Zero)
    )

  private def deriveOAuth2Target(request: Request): String =
    sanitizeOAuth2Target(request.url.path.toString).getOrElse(defaultOAuth2Target)

  private[gateway] def sanitizeOAuth2Target(target: String): Option[String] =
    Option(target)
      .map(_.trim)
      .filter(_.nonEmpty)
      .filter(_.startsWith("/"))
      .filterNot(_.startsWith("//"))
      .filter: path =>
        path == "/docs" ||
        path.startsWith("/docs/") ||
        path == "/site" ||
        path.startsWith("/site/")

  private[gateway] def siteResourcePath(relativePath: String): String =
    Option(relativePath)
      .map(_.trim)
      .filter(_.nonEmpty)
      .map(path => s"site/$path")
      .getOrElse("site/index.html")

  private[gateway] def siteFolderRedirectLocation(relativePath: String, requestPath: String): Option[String] =
    siteFolderRedirectLocation(relativePath, requestPath, classpathResourceExists, classpathDirectoryExists)

  private[gateway] def siteFolderRedirectLocation(
      relativePath: String,
      requestPath: String,
      resourceExists: String => Boolean,
      directoryExists: String => Boolean
  ): Option[String] =
    Option(relativePath)
      .map(_.trim)
      .filter(_.nonEmpty)
      .map(_.stripSuffix("/"))
      .flatMap: path =>
        val isDirectoryRequest =
          requestPath.endsWith("/") || (!lastPathSegmentLooksLikeFile(path) && directoryExists(s"site/$path"))
        Option.when(isDirectoryRequest):
          val indexPath = s"$path/index.html"
          Option.when(resourceExists(s"site/$indexPath"))(s"/site/$indexPath")
        .flatten

  private[gateway] def versionedSiteRedirect(relativePath: String): Option[String] =
    versionedSiteRedirect(relativePath, availableSiteVersions)

  private[gateway] def versionedSiteRedirect(
      relativePath: String,
      availableVersions: String => Seq[String]
  ): Option[String] =
    Option(relativePath)
      .map(_.trim)
      .filter(_.nonEmpty)
      .flatMap: path =>
        path.split('/').filter(_.nonEmpty).toList match
          case company :: "index.html" :: Nil =>
            availableVersions(company)
              .filter(isSiteVersionSegment)
              .sorted
              .lastOption
              .map(version => s"/site/$company/$version/index.html")
          case _                               =>
            None

  private[gateway] def availableSiteVersions(company: String): Seq[String] =
    classpathDirectoryEntries(s"site/$company")

  private[gateway] def classpathDirectoryEntries(resourceDirectory: String): Seq[String] =
    Option(getClass.getClassLoader.getResource(resourceDirectory.stripSuffix("/"))) match
      case None              => Seq.empty
      case Some(resourceUrl) =>
        resourceUrl.openConnection() match
          case jarConnection: JarURLConnection =>
            val prefix = jarConnection.getEntryName.stripSuffix("/") + "/"
            jarConnection.getJarFile.entries.asScala
              .map(_.getName)
              .filter(_.startsWith(prefix))
              .flatMap: entryName =>
                entryName
                  .stripPrefix(prefix)
                  .split('/')
                  .headOption
                  .filter(_.nonEmpty)
              .toSeq
              .distinct

          case _ if resourceUrl.getProtocol == "file" =>
            val directoryPath = Paths.get(resourceUrl.toURI)
            if Files.isDirectory(directoryPath) then
              val stream = Files.list(directoryPath)
              try stream.iterator().asScala.map(_.getFileName.toString).toSeq
              finally stream.close()
            else Seq.empty

          case _ =>
            Seq.empty

  private[gateway] def isSiteVersionSegment(segment: String): Boolean =
    siteVersionSegmentPattern.matches(segment)

  private[gateway] def classpathResourceExists(resourcePath: String): Boolean =
    Option(getClass.getClassLoader.getResource(resourcePath.stripSuffix("/"))).nonEmpty

  private[gateway] def classpathDirectoryExists(resourceDirectory: String): Boolean =
    classpathResourceExists(resourceDirectory) || classpathDirectoryEntries(resourceDirectory).nonEmpty

  private def lastPathSegmentLooksLikeFile(path: String): Boolean =
    path.split('/').lastOption.exists(_.contains('.'))

  private[gateway] def needsCanonicalSiteRedirect(requestPath: String): Boolean =
    requestPath == "/site"

  private def siteCanonicalRedirectResponse: Response =
    Response(status = Status.Found, headers = Headers("location" -> "/site/"))

  private def siteVersionRedirectResponse(location: String): Response =
    Response(status = Status.Found, headers = Headers("location" -> location))

  /** Exchanges an OAuth 2.0 authorization code for an access token.
    *
    * The `redirectUri` must be identical to the one used when building the authorization URL
    * (Keycloak and other providers validate this as a security measure).
    */
  private def exchangeCodeForToken(
      auth: DocsAuth.OAuth2AuthCode,
      code: String,
      redirectUri: String
  ): ZIO[Any, String, String] =
    (for
      _        <- ZIO.logInfo(s"OAuth2 token exchange → POST ${auth.tokenUrl}")
      _        <- ZIO.logInfo(s"OAuth2 token exchange redirect_uri=$redirectUri client_id=${auth.clientId}")
      uri      <- ZIO.fromEither(Uri.parse(auth.tokenUrl)).mapError(_.toString)
      request   = basicRequest
                    .post(uri)
                    .body(
                      Map(
                        "grant_type"    -> "authorization_code",
                        "code"          -> code,
                        "redirect_uri"  -> redirectUri,
                        "client_id"     -> auth.clientId,
                        "client_secret" -> auth.clientSecret
                      )
                    )
      response <- ZIO.serviceWithZIO[SttpClientBackend]: backend =>
                    request.send(backend).mapError(_.getMessage)
      _        <- ZIO.logInfo(s"OAuth2 token endpoint HTTP ${response.code}")
      token    <- response.body match
                    case Right(body) =>
                      ZIO.fromEither(
                        circeParser
                          .parse(body)
                          .flatMap(_.hcursor.downField("access_token").as[String])
                      ).mapError(err => s"Failed to parse token response: $err")
                    case Left(body)  =>
                      ZIO.fail(s"Token endpoint returned HTTP ${response.code}: $body")
    yield token)
      .provideLayer(HttpClientProvider.live)
      .mapError:
        case s: String    => s
        case t: Throwable => s"HTTP client error: ${t.getMessage}"

  /** Ensures a given authorization code is exchanged at most once on this gateway instance.
    *
    * Some browsers/private-window flows can trigger the callback URL more than once for the
    * same authorization code. Since OAuth2 auth codes are single-use, a second POST to the
    * token endpoint fails with `invalid_grant / Code not valid`. This method deduplicates
    * concurrent or repeated exchanges so all duplicate callers share the first result.
    */
  private def exchangeCodeForTokenOnce(
      auth: DocsAuth.OAuth2AuthCode,
      code: String,
      redirectUri: String
  ): ZIO[Any, String, String] =
    for
      _          <- cleanupExpiredOAuth2CodeExchanges
      nowMillis  <- Clock.currentTime(java.util.concurrent.TimeUnit.MILLISECONDS)
      promise    <- Promise.make[Nothing, Either[String, String]]
      newEntry    = OAuth2CodeExchangeEntry(nowMillis, promise)
      existing    = Option(oauth2CodeExchanges.putIfAbsent(code, newEntry))
      token      <- existing match
                      case Some(entry) =>
                        ZIO.logInfo(s"OAuth2 duplicate callback detected for code=$code; reusing in-flight/completed exchange") *>
                          entry.promise.await.flatMap(ZIO.fromEither(_))

                      case None =>
                        exchangeCodeForToken(auth, code, redirectUri)
                          .either
                          .tap(result => promise.succeed(result).ignore)
                          .flatMap(ZIO.fromEither(_))
    yield token

  private def cleanupExpiredOAuth2CodeExchanges: UIO[Unit] =
    Clock.currentTime(java.util.concurrent.TimeUnit.MILLISECONDS).map: nowMillis =>
      val iterator = oauth2CodeExchanges.entrySet().iterator()
      while iterator.hasNext do
        val entry = iterator.next()
        if nowMillis - entry.getValue.createdAtMillis > oauth2CodeExchangeTtlMillis then
          iterator.remove()

  /** Builds the authorization URL with properly encoded query parameters. */
  private def buildOAuthUrl(auth: DocsAuth.OAuth2AuthCode, state: String, redirectUri: String): String =
    val encode = java.net.URLEncoder.encode(_: String, "UTF-8")
    val params = List(
      "response_type" -> "code",
      "client_id"     -> auth.clientId,
      "redirect_uri"  -> redirectUri,
      "state"         -> state,
      "scope"         -> auth.scopes
    ).map((k, v) => s"$k=${encode(v)}").mkString("&")
    s"${auth.authorizationUrl}?$params"

  /** Serves a static file from the classpath, detecting the content type from the file extension.
    *
    * Used to serve the company documentation site (generated by Laika/publishDocs) which is
    * placed in the classpath under `/site` (e.g. `/site/index.html`, `/site/valiant/...`).
    */
  private def serveClasspathFile(resourcePath: String): ZIO[Any, Nothing, Response] =
    ZIO.attempt {
      val ext       = resourcePath.split('.').lastOption.getOrElse("").toLowerCase
      val mediaType = MediaType.forFileExtension(ext).getOrElse(MediaType.application.`octet-stream`)
      Option(getClass.getClassLoader.getResourceAsStream(resourcePath)) match
        case None         =>
          Response.status(Status.NotFound)
        case Some(stream) =>
          val bytes = stream.readAllBytes()
          stream.close()
          Response(
            body    = Body.fromArray(bytes),
            headers = Headers(Header.ContentType(mediaType))
          )
    }.catchAll(_ => ZIO.succeed(Response.status(Status.NotFound)))

  /** Derives the OAuth2 `redirect_uri` from the incoming request's Host header.
    *
    * Points to `/docs/oauth2/callback` – a dedicated, unprotected route – so that Keycloak
    * always redirects the browser there and never deposits `code`/`state` params on the main
    * `/docs` page. Register `http(s)://<gateway-host>/docs/oauth2/callback` as a valid
    * redirect URI in Keycloak.
    *
    * Uses `X-Forwarded-Proto` (set by reverse proxies) to detect https, falling back to `http`.
    */
  private def deriveCallbackUri(request: Request): String =
    val host   = request.header(Header.Host).map(_.renderedValue).getOrElse("localhost")
    val scheme = forwardedProto(request)
    s"$scheme://$host/docs/oauth2/callback"

  private def forwardedProto(request: Request): String =
    request.rawHeader("X-Forwarded-Proto")
      .flatMap(_.split(",").headOption)
      .map(_.trim)
      .filter(_.nonEmpty)
      .getOrElse("http")

end OpenApiRoutes
