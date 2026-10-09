package orchescala.gateway

import orchescala.engine.rest.TokenFingerprint

import io.circe.parser as circeParser
import java.net.JarURLConnection
import java.nio.file.{Files, Paths}
import java.util.concurrent.ConcurrentHashMap
import orchescala.engine.rest.{HttpClientProvider, SttpClientBackend}
import sttp.client3.basicRequest
import sttp.model.Uri
import scala.jdk.CollectionConverters.*
import scala.util.Using
import zio.*
import zio.http.*

/** Routes for serving OpenAPI documentation.
  */
class OpenApiRoutes()(using config: GatewayConfig):

  private case class OAuth2CodeExchangeEntry(
      createdAtMillis: Long,
      promise: Promise[Nothing, Either[String, String]]
  )

  // keyed by state AND code: a duplicate callback of the same browser login gets the token again,
  // a leaked code alone does not (the attacker brings his own state cookie)
  private val oauth2CodeExchanges = ConcurrentHashMap[(String, String), OAuth2CodeExchangeEntry]()
  // duplicate callbacks come within seconds - Keycloak's codes are valid for a minute
  private val oauth2CodeExchangeTtlMillis = 1.minute.toMillis
  // failed exchanges are removed at once, so only real logins of the last minute are kept
  private val oauth2CodeExchangesMax      = 1000
  private val docsTokenCookieName         = "orchescala_docs_token"
  private val oauth2StateCookieName       = "orchescala_oauth_state"
  private val oauth2TargetCookieName      = "orchescala_oauth_target"
  private val defaultOAuth2Target         = "/docs"

  // one verifier per auth config - it caches the signing keys
  private val docsTokenVerifiers = ConcurrentHashMap[DocsAuth.OAuth2AuthCode, TokenVerifier]()

  private def docsTokenVerifier(auth: DocsAuth.OAuth2AuthCode): TokenVerifier =
    docsTokenVerifiers.computeIfAbsent(auth, a => TokenVerifier(a.docsTokenValidation).get)

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
  /** The gateway's own API doc page: orch-doc's single-file page `OrchDocApi.html` from the
    * orchescala-orch-doc jar (a dependency of this gateway).
    */
  private lazy val apiDocPage =
    ZIO.attempt {
      val htmlContent = Using.resource(scala.io.Source.fromResource("OrchDocApi.html"))(_.mkString)
      Response.text(htmlContent).addHeader(Header.ContentType(MediaType.text.html))
    }.catchAll { error =>
      ZIO.succeed(
        Response.text(
          s"No API documentation page (OrchDocApi.html) on the classpath - the orchescala-orch-doc " +
            s"jar is missing or was built without Node.js. (${error.getMessage})"
        ).status(Status.NotFound)
      )
    }

  def routes: Routes[Any, Response] =
    val protectedRoutes = Routes(
      // Canonicalize only the exact /site path so relative links like ./globex/... resolve
      // below /site/ without causing a redirect loop on the already-canonical /site/ URL.
      Method.GET / "site" -> handler {
        (request: Request) =>
          if needsCanonicalSiteRedirect(request.url.path.toString) then
            ZIO.succeed(siteCanonicalRedirectResponse)
          else
            serveClasspathFile("site/index.html")
      },

      // Serve the documentation site (the orch-doc app + its data, e.g. /site/, /site/index.json,
      // /site/globex/docs.json) and the classic sites of older releases (/site/globex/2026-04/)
      Method.GET / "site" / trailing -> handler { (path: Path, request: Request) =>
        val relativePath = path.segments.mkString("/")
        companySiteRedirect(relativePath)
          .orElse(siteFolderRedirectLocation(relativePath, request.url.path.toString)) match
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
        (companyName: String, projectName: String, _: Request) =>
          forwardDocsRequest(projectName, Seq("docs"), MediaType.text.html)
            .flatMap(orSiteFile(companyName, projectName, "OpenApi.html", MediaType.text.html))
      },

      // Forward OpenApi.yml for a project worker app
      Method.GET / "site" / string("companyName") / string("projectName") / "OpenApi.yml" -> handler {
        (companyName: String, projectName: String, _: Request) =>
          forwardDocsRequest(projectName, Seq("docs", "OpenApi.yml"), MediaType.text.yaml)
            .flatMap(orSiteFile(companyName, projectName, "OpenApi.yml", MediaType.text.yaml))
      },

      // Forward BPMN/DMN diagrams for a project worker app
      Method.GET / "site" / string("companyName") / string("projectName") / "diagrams" / string(
        "diagramName"
      ) -> handler {
        (companyName: String, projectName: String, diagramName: String, _: Request) =>
          if isValidDiagramName(diagramName) then
            forwardDocsRequest(projectName, Seq("docs", "diagrams", diagramName), MediaType.application.xml)
              .flatMap(orSiteFile(companyName, projectName, s"diagrams/$diagramName", MediaType.application.xml))
          else ZIO.succeed(Response.status(Status.NotFound))
      },

      // The gateway's own API doc: orch-doc's single-file page (`OrchDocApi.html`, put into the
      // company gateway's resources by the company's `./helper.scala update`). The page loads the
      // yml named like itself - so it is served as /docs/OpenApi.html (-> /docs/OpenApi.yml);
      // /docs is the same page and needs the yml at the root for that.
      Method.GET / "docs" -> handler(apiDocPage),
      Method.GET / "docs" / "OpenApi.html" -> handler(apiDocPage),
      Method.GET / "OpenApi.yml" -> handler {
        val yaml = OpenApiGenerator.generateYaml
        Response.text(yaml).addHeader(Header.ContentType(MediaType.text.yaml))
      }
    )

    // Favicon is always public (browsers request it automatically)
    val faviconRoute = Routes(
      Method.GET / "favicon.ico" -> handler {
        ZIO.attempt {
          val faviconBytes =
            Using.resource(getClass.getClassLoader.getResourceAsStream("favicon.ico"))(_.readAllBytes())
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

  /** Why a docs request did not reach the worker app - the status the gateway answers with. */
  private case class DocsFailure(status: Status, message: String)

  /** A worker app that did not answer at all (not reachable, no answer in time) is not asked again for
    * this long: the rest of the page (yml, diagrams) comes from the site at once, the same release as its
    * OpenApi.html. A worker app that answers stays live - also when it gives a 503 of its own for one
    * file: that file comes from the site, the others stay its own (a page may then mix the two).
    */
  private[gateway] val DocsDownFor = 10.seconds
  private def nowMs: Long          = java.lang.System.currentTimeMillis
  // per instance - the gateway makes one (GatewayServer); keyed by project: the docs URL depends on the
  // project only (docsAppUrl), so a company has no worker app of its own
  private[gateway] val docsDown    = OpenApiRoutes.DownList(DocsDownFor.toMillis, max = 1000)

  /** Marks a docs answer that is not the worker app's (live) one. */
  private[gateway] val DocsSourceHeader = "X-Orchescala-Docs-Source"

  /** When the project's worker app is not there - no docs URL for it (404) or not reachable (503, see
    * forwardDocsRequest; e.g. a project of another team, not running here) - the released version the
    * docs site holds (`site/<company>/<project>/…`, written by the helper's SiteAssembler at the tag of
    * VERSIONS.conf), logged and with the header `X-Orchescala-Docs-Source: released` (not live). A 404
    * is only forwardDocsRequest's own (no docs URL): a worker app's 404 comes back as 502.
    * A worker app that answers - also with an error of its own (502) - or a wrong docs URL (500) is
    * passed on: the live one, not hidden behind an older file.
    *
    * The site's OpenApi.html is the API page of the orch-doc jar (not the worker app's): it loads
    * `OpenApi.yml` and `diagrams/<name>` relative to itself - these same routes, with the same fallback.
    */
  // the statuses come from forwardDocsRequest: 404 only its own «no docs URL» (a worker app's 404 is 502),
  // 503 «not there» (not reachable, no answer in time, its own 503)
  private[gateway] def orSiteFile(
      companyName: String,
      projectName: String,
      file: String,
      contentType: MediaType
  )(
      forwarded: Response
  ): ZIO[Any, Nothing, Response] =
    val unavailable = forwarded.status == Status.NotFound || forwarded.status == Status.ServiceUnavailable
    if !unavailable then ZIO.succeed(forwarded)
    else if !isValidSiteFolder(companyName) || !isValidProjectName(projectName) then
      ZIO.logInfo(s"Docs of '$companyName/$projectName': no site folder of that name - no fallback")
        .as(forwarded)
    else
      // the same headers as the live answer (forwardDocsRequest) - .bpmn/.dmn have no type of their own
      val resource = siteResourcePath(s"$companyName/$projectName/$file")
      serveClasspathFile(resource, Some(contentType)).flatMap: fromSite =>
        if fromSite.status.isSuccess then
          // per file (the yml, each diagram) - info, the header marks the answer
          ZIO.logInfo(
            s"Docs of '$projectName' (${forwarded.status.code}): the released $file of the site instead"
          ).as(
            fromSite
              .addHeader("X-Content-Type-Options", "nosniff")
              .addHeader(DocsSourceHeader, "released")
          )
        else ZIO.succeed(forwarded)

  /** Forwards a docs request to the worker app of the project.
    *
    * The project name comes from the request path, and the default `docsAppUrl` takes it as the
    * host: `/site/x/attacker.example/OpenApi.html` made the gateway fetch any host and serve the
    * answer as HTML on its own origin (SSRF and XSS). Only a plain host name (no dots, ports or
    * slashes) is accepted - the path goes into the URL as encoded segments.
    *
    * No docs URL: 404; the worker app not reachable or no answer within `docsForwardTimeout`: 503
    * (and for DocsDownFor not asked again); its error answer: 502; a wrong URL: 500.
    */
  private def forwardDocsRequest(
      projectName: String,
      path: Seq[String],
      contentType: MediaType
  ): ZIO[Any, Nothing, Response] =
    (if isValidProjectName(projectName) then config.docsAppUrl(projectName) else None) match
      case None          =>
        ZIO.logWarning(
          s"No docs URL for project: $projectName"
        ).as(Response.status(Status.NotFound))
      case Some(_) if docsDown.isDown(projectName, nowMs) =>
        ZIO.logDebug(s"Docs of '$projectName': its worker app did not answer just now - not asked")
          .as(Response.status(Status.ServiceUnavailable))
      case Some(baseUrl) =>
        (for
          uri      <- ZIO.fromEither(Uri.parse(baseUrl).map(_.addPath(path)))
                        .mapError(err => DocsFailure(Status.InternalServerError, s"Invalid docs URL: $err"))
          _        <- ZIO.logInfo(s"Forwarding docs request to: $uri")
          request   = basicRequest.get(uri)
          response <- ZIO.serviceWithZIO[SttpClientBackend]: backend =>
                        request.send(backend)
                          .mapError(err => DocsFailure(Status.ServiceUnavailable, err.getMessage))
                          // a worker app that is not there should not hold the page for the client's
                          // default timeout - the released file is the answer then
                          .timeoutFail(
                            DocsFailure(Status.ServiceUnavailable, s"no answer within ${config.docsForwardTimeout}")
                          )(config.docsForwardTimeout)
          result   <- response.body match
                        case Right(body) =>
                          // it answers: not down (any more)
                          ZIO.succeed(docsDown.answered(projectName, Status.Ok, nowMs)) *>
                          ZIO.succeed(
                            Response.text(body)
                              .addHeader(Header.ContentType(contentType))
                              .addHeader("X-Content-Type-Options", "nosniff")
                          )
                        // its own 503 (e.g. restarting, or a file it does not serve): this file from the
                        // site - the project is not marked down for it (it answers); any other error is its
                        // answer (502)
                        case Left(err) if response.code.code == 503 =>
                          // it answers - a down mark from before goes
                          ZIO.succeed(docsDown.answered(projectName, Status.Ok, nowMs)) *>
                          ZIO.logWarning(s"Docs service '$projectName' unavailable (503): $err")
                            .as(Response.status(Status.ServiceUnavailable))
                        case Left(err)   =>
                          // it answered (with an error): not down
                          ZIO.succeed(docsDown.answered(projectName, Status.BadGateway, nowMs)) *>
                          ZIO.logError(
                            s"Error response from docs service '$projectName': $err"
                          ).as(Response.status(Status.BadGateway))
        yield result)
          .provideLayer(HttpClientProvider.live)
          .catchAll: failure =>
            val docsFailure = failure match
              case f: DocsFailure => f
              // HttpClientProvider.live could not be built - no request was sent
              case err: Throwable => DocsFailure(Status.InternalServerError, err.getMessage)
            // not reachable or no answer in time: down - the rest of the page from the site at once
            // (a warning: the page is served from the site - an error only for a wrong URL / client, 500)
            if docsFailure.status == Status.ServiceUnavailable then
              ZIO.succeed(docsDown.answered(projectName, Status.ServiceUnavailable, nowMs)) *>
                ZIO.logWarning(s"Docs of '$projectName' not reachable: ${docsFailure.message}")
                  .as(Response.status(docsFailure.status))
            else
              ZIO.logError(s"Error forwarding docs request for '$projectName': ${docsFailure.message}")
                .as(Response.status(docsFailure.status))

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

                // ── 1. Token cookie: verify it (signature, expiry, issuer) ──
                // Its mere presence let anyone in: `Cookie: orchescala_docs_token=x`.
                case Some(cookie) if cookie.content.nonEmpty =>
                  docsTokenVerifier(auth)
                    .validate(cookie.content)
                    .foldZIO(
                      reason =>
                        ZIO.logWarning(
                          s"Docs token ${TokenFingerprint(cookie.content)} rejected: $reason"
                        ) *>
                          redirectToLogin(auth, request)
                            .map(_.addCookie(clearRootCookie(docsTokenCookieName, isHttps(request)))),
                      _ => handler(request)
                    )

                // ── 2. No token → redirect to Keycloak ──────────────────────
                case _ =>
                  redirectToLogin(auth, request)

  /** Redirects the browser to the Keycloak login, remembering the requested page. */
  private def redirectToLogin(auth: DocsAuth.OAuth2AuthCode, request: Request): UIO[Response] =
    val state       = java.util.UUID.randomUUID().toString
    val target      = deriveOAuth2Target(request)
    val redirectUri = deriveCallbackUri(request)
    val authUrl     = buildOAuthUrl(auth, state, redirectUri)
    val secure      = isHttps(request)
    // no state in the log - with it, a code from the log could be exchanged once more
    ZIO.logInfo(s"Redirecting to Keycloak: ${auth.authorizationUrl}\n- RedirectUri: $redirectUri\n- Target: $target").as:
      Response(status = Status.Found, headers = Headers("location" -> authUrl))
        .addCookie(
          Cookie.Response(
            name       = oauth2StateCookieName,
            content    = state,
            path       = Some(Path.root),
            isSecure   = secure,
            isHttpOnly = true,
            sameSite   = Some(Cookie.SameSite.Lax)
          )
        )
        .addCookie(
          Cookie.Response(
            name       = oauth2TargetCookieName,
            content    = target,
            path       = Some(Path.root),
            isSecure   = secure,
            isHttpOnly = true,
            sameSite   = Some(Cookie.SameSite.Lax)
          )
        )
  end redirectToLogin

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
        // the scheme as for the authorization request (deriveCallbackUri) - the raw header of
        // several proxies (`https, http`) gave a different redirect_uri
        val scheme      = forwardedProto(request)
        val host        = request.header(Header.Host).map(_.renderedValue).getOrElse("localhost")
        val callbackUri = s"$scheme://$host${request.url.path}"
        val secure      = isHttps(request)

        (codeOpt, stateOpt) match

          // ── Valid callback: state matches ────────────────────────────────
          case (Some(code), Some(state)) if storedState.contains(state) =>
            exchangeCodeForTokenOnce(auth, code, state, callbackUri)
              .foldZIO(
                err =>
                  ZIO.logError(s"OAuth2 token exchange failed: $err")
                    .as(
                      Response.text(s"OAuth2 token exchange failed:\n$err")
                        .status(Status.BadGateway)
                        .addCookie(clearRootCookie(oauth2StateCookieName, secure))
                        .addCookie(clearRootCookie(oauth2TargetCookieName, secure))
                    ),
                token =>
                  ZIO.succeed:
                    oauth2ContinuePageResponse(target)
                      .addCookie(docsTokenCookie(token, secure))
                      .addCookie(clearRootCookie(oauth2StateCookieName, secure))
                      .addCookie(clearRootCookie(oauth2TargetCookieName, secure))
              )

          // ── State mismatch (CSRF / stale request) ───────────────────────
          case (Some(_), Some(_)) =>
            ZIO.logWarning("OAuth2: state mismatch – possible CSRF attempt or stale callback")
              .as(
                Response.status(Status.Unauthorized)
                  .addCookie(clearRootCookie(oauth2StateCookieName, secure))
                  .addCookie(clearRootCookie(oauth2TargetCookieName, secure))
              )

          // ── Missing code or state → restart the flow ────────────────────
          case _ =>
            ZIO.logWarning(s"OAuth2 callback: missing code or state, redirecting to $target")
              .as(
                oauth2ContinuePageResponse(target)
                  .addCookie(clearRootCookie(oauth2StateCookieName, secure))
                  .addCookie(clearRootCookie(oauth2TargetCookieName, secure))
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
           |      <meta http-equiv=\"refresh\" content=\"0;url=${escapeHtml(target)}\" />
           |      <p><a href=\"${escapeHtml(target)}\">Continue</a></p>
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
      // `</script>` in the target ended the script element
      case '<'  => "\\u003c"
      case '>'  => "\\u003e"
      case '&'  => "\\u0026"
      case c    => c.toString
    } + "\""

  private def escapeHtml(value: String): String =
    value.flatMap {
      case '&'  => "&amp;"
      case '<'  => "&lt;"
      case '>'  => "&gt;"
      case '"'  => "&quot;"
      case '\'' => "&#39;"
      case c    => c.toString
    }

  /** @param secure
    *   behind https (`X-Forwarded-Proto`) - the browser then never sends the token over http
    */
  private[gateway] def docsTokenCookie(token: String, secure: Boolean): Cookie.Response =
    Cookie.Response(
      name       = docsTokenCookieName,
      content    = token,
      path       = Some(Path.root),
      isSecure   = secure,
      isHttpOnly = true,
      // `/site` is protected by the same OAuth2 middleware as `/docs`, so the cookie must be
      // available on both route trees after the callback lands on the original target page.
      // `Lax` still allows the first top-level navigation back from Keycloak while avoiding the
      // stricter behavior that can trigger an auth loop immediately after login.
      sameSite   = Some(Cookie.SameSite.Lax),
      maxAge     = Some(1.hour)
    )

  private def clearRootCookie(name: String, secure: Boolean): Cookie.Response =
    Cookie.Response(
      name       = name,
      content    = "",
      path       = Some(Path.root),
      isSecure   = secure,
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
      // the target goes into the page after the login - no quotes, brackets or spaces
      .filter(_.matches("[A-Za-z0-9/._~%#-]*"))
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

  /** A plain host name - the default `docsAppUrl` takes the project name as host. */
  private[gateway] def isValidProjectName(projectName: String): Boolean =
    projectName.matches("[A-Za-z0-9]+(-[A-Za-z0-9]+)*")

  /** A company's folder of the site (`site/<company>/`) - a plain name, also with `_`. */
  private[gateway] def isValidSiteFolder(name: String): Boolean =
    name.matches("[A-Za-z0-9][A-Za-z0-9_-]*")

  private[gateway] def isValidDiagramName(diagramName: String): Boolean =
    diagramName.matches("[A-Za-z0-9_-][A-Za-z0-9._-]*") && !diagramName.contains("..")

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

  private[gateway] def companySiteRedirect(relativePath: String): Option[String] =
    companySiteRedirect(relativePath, cachedDirectoryEntries)

  /** `/site/<company>`, `/site/<company>/` and `/site/<company>/index.html` -> the company's page
    * in the documentation app (`/site/#/<company>`). The app is one page for all companies; a
    * company folder only holds its data (docs.json, pages/, the project APIs) and the classic
    * sites of older releases (`<company>/<tag>/`, still served as they are).
    */
  private[gateway] def companySiteRedirect(
      relativePath: String,
      directoryEntries: String => Seq[String]
  ): Option[String] =
    Option(relativePath)
      .map(_.trim)
      .filter(_.nonEmpty)
      .flatMap: path =>
        path.split('/').filter(_.nonEmpty).toList match
          case company :: rest if rest.isEmpty || rest == List("index.html") =>
            Option.when(directoryEntries(s"site/$company").nonEmpty)(s"/site/#/$company")
          case _                                                             =>
            None

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

  private[gateway] def classpathResourceExists(resourcePath: String): Boolean =
    Option(getClass.getClassLoader.getResource(resourcePath.stripSuffix("/"))).nonEmpty

  private[gateway] def classpathDirectoryExists(resourceDirectory: String): Boolean =
    classpathResourceExists(resourceDirectory) || cachedDirectoryEntries(resourceDirectory).nonEmpty

  // the classpath does not change at runtime - it was read (the whole jar) on every /site request;
  // bounded: the directories come from the request path
  private val directoryEntriesCache =
    com.github.blemale.scaffeine.Scaffeine().maximumSize(1_000).build[String, Seq[String]]()

  private[gateway] def cachedDirectoryEntries(resourceDirectory: String): Seq[String] =
    directoryEntriesCache.get(resourceDirectory, classpathDirectoryEntries)

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
  private[gateway] def exchangeCodeForTokenOnce(
      auth: DocsAuth.OAuth2AuthCode,
      code: String,
      state: String,
      redirectUri: String
  ): ZIO[Any, String, String] =
    exchangeCodeForTokenOnce(code, state, exchangeCodeForToken(auth, code, redirectUri))

  private[gateway] def exchangeCodeForTokenOnce(
      code: String,
      state: String,
      exchange: IO[String, String]
  ): ZIO[Any, String, String] =
    val key = (state, code)
    for
      _          <- cleanupExpiredOAuth2CodeExchanges
      nowMillis  <- Clock.currentTime(java.util.concurrent.TimeUnit.MILLISECONDS)
      promise    <- Promise.make[Nothing, Either[String, String]]
      newEntry    = OAuth2CodeExchangeEntry(nowMillis, promise)
      existing    =
        if oauth2CodeExchanges.size >= oauth2CodeExchangesMax then None // full: no deduplication
        else Option(oauth2CodeExchanges.putIfAbsent(key, newEntry))
      token      <- existing match
                      case Some(entry) =>
                        // no code in the log - it could be exchanged once more
                        ZIO.logInfo("OAuth2 duplicate callback detected; reusing in-flight/completed exchange") *>
                          entry.promise.await.flatMap(ZIO.fromEither(_))

                      case None =>
                        exchange
                          .either
                          .tap: result =>
                            promise.succeed(result).ignore *>
                              // a failed code is not kept - callbacks with made-up codes fill nothing
                              ZIO.succeed(oauth2CodeExchanges.remove(key, newEntry)).when(result.isLeft)
                          .flatMap(ZIO.fromEither(_))
    yield token
    end for
  end exchangeCodeForTokenOnce

  private[gateway] def pendingCodeExchanges: Int = oauth2CodeExchanges.size

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
    * Used to serve the documentation site (the orch-doc build, see the company's publishDocs)
    * which is placed in the classpath under `/site` (e.g. `/site/index.html`, `/site/globex/...`).
    */
  private def serveClasspathFile(
      resourcePath: String,
      contentType: Option[MediaType] = None
  ): ZIO[Any, Nothing, Response] =
    // reading a file of the jar - not on the compute pool (the fallback of every diagram comes here)
    ZIO.attemptBlocking {
      val ext       = resourcePath.split('.').lastOption.getOrElse("").toLowerCase
      val mediaType = contentType
        .orElse(MediaType.forFileExtension(ext))
        .getOrElse(MediaType.application.`octet-stream`)
      Option(getClass.getClassLoader.getResourceAsStream(resourcePath)) match
        case None         =>
          Response.status(Status.NotFound)
        case Some(stream) =>
          val bytes = Using.resource(stream)(_.readAllBytes()) // closed also when reading fails
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

  private def isHttps(request: Request): Boolean =
    forwardedProto(request).equalsIgnoreCase("https")

  private def forwardedProto(request: Request): String =
    request.rawHeader("X-Forwarded-Proto")
      .flatMap(_.split(",").headOption)
      .map(_.trim)
      .filter(_.nonEmpty)
      .getOrElse("http")

end OpenApiRoutes

object OpenApiRoutes:

  /** The worker apps that did not answer (503) - for `downForMs` not asked again. At most `max`
    * projects (the request path names them): when full, expired entries go first, then the one that
    * ends first. Check and change are one step.
    */
  final class DownList(downForMs: Long, max: Int):
    // a ReentrantLock as the helper's locks - it never blocks long here, but no pinned carrier either
    private val lock  = java.util.concurrent.locks.ReentrantLock()
    private val until = scala.collection.mutable.HashMap.empty[String, Long]
    private def locked[A](a: => A): A =
      lock.lock()
      try a
      finally lock.unlock()

    def isDown(project: String, now: Long): Boolean = locked(until.get(project).exists(_ > now))

    /** The answer for a project: 503 remembers it as down, any other forgets it. */
    def answered(project: String, status: Status, now: Long): Unit = locked:
      if status != Status.ServiceUnavailable then until.remove(project)
      else
        if until.size >= max then until.filterInPlace((_, t) => t > now)
        // still full: the one that ends first goes - a new project is remembered, not asked again each time
        if until.size >= max && !until.contains(project) then until.remove(until.minBy(_._2)._1)
        until.update(project, now + downForMs)

    def size: Int = locked(until.size)
  end DownList
end OpenApiRoutes
