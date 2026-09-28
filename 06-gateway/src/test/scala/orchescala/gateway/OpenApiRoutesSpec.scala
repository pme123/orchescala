package orchescala.gateway

import orchescala.engine.DefaultEngineConfig
import orchescala.worker.DefaultWorkerConfig
import zio.*
import zio.http.*
import zio.test.*

object OpenApiRoutesSpec extends ZIOSpecDefault:

  private val testConfig = DefaultGatewayConfig(
    engineConfig = DefaultEngineConfig(),
    workerConfig = DefaultWorkerConfig(DefaultEngineConfig())
  )

  private val openApiRoutes = OpenApiRoutes()(using testConfig)

  def spec: Spec[TestEnvironment & Scope, Any] = suite("OpenApiRoutes")(
    test("needsCanonicalSiteRedirect only redirects the exact /site path") {
      assertTrue(
        openApiRoutes.needsCanonicalSiteRedirect("/site"),
        !openApiRoutes.needsCanonicalSiteRedirect("/site/"),
        !openApiRoutes.needsCanonicalSiteRedirect("/site/globex/index.html")
      )
    },
    test("siteResourcePath resolves the site index for the canonical /site/ root") {
      assertTrue(
        openApiRoutes.siteResourcePath("") == "site/index.html",
        openApiRoutes.siteResourcePath("   ") == "site/index.html"
      )
    },
    test("siteResourcePath preserves nested files under /site") {
      assertTrue(
        openApiRoutes.siteResourcePath("assets/index-abc123.js") ==
          "site/assets/index-abc123.js",
        openApiRoutes.siteResourcePath("globex/docs.json") ==
          "site/globex/docs.json",
        openApiRoutes.siteResourcePath("globex/2026-04/catalog.html") ==
          "site/globex/2026-04/catalog.html"
      )
    },
    test("siteFolderRedirectLocation resolves nested folder URLs to index.html") {
      val resourceExists = Set(
        "site/globex/index.html",
        "site/globex/2026-04/index.html"
      )
      val directoryExists = Set(
        "site/globex",
        "site/globex/2026-04"
      )

      assertTrue(
        openApiRoutes.siteFolderRedirectLocation(
          "globex/2026-04",
          "/site/globex/2026-04/",
          resourceExists.contains,
          directoryExists.contains
        ).contains("/site/globex/2026-04/index.html"),
        openApiRoutes.siteFolderRedirectLocation(
          "globex/2026-04",
          "/site/globex/2026-04",
          resourceExists.contains,
          directoryExists.contains
        ).contains("/site/globex/2026-04/index.html")
      )
    },
    test("siteFolderRedirectLocation ignores direct file requests and unknown folders") {
      assertTrue(
        openApiRoutes.siteFolderRedirectLocation(
          "globex/development/catalog.html",
          "/site/globex/development/catalog.html",
          _ => true,
          _ => true
        ).isEmpty,
        openApiRoutes.siteFolderRedirectLocation(
          "unknown/2026-04",
          "/site/unknown/2026-04/",
          _ => false,
          _ => false
        ).isEmpty
      )
    },
    test("companySiteRedirect forwards a company folder / index to the app's company page") {
      val entries: String => Seq[String] =
        dir => if dir == "site/globex" then Seq("docs.json", "pages", "2026-04") else Seq.empty

      assertTrue(
        openApiRoutes.companySiteRedirect("globex/index.html", entries).contains("/site/#/globex"),
        openApiRoutes.companySiteRedirect("globex/", entries).contains("/site/#/globex"),
        openApiRoutes.companySiteRedirect("globex", entries).contains("/site/#/globex")
      )
    },
    test("companySiteRedirect ignores older-release sites, files and unknown companies") {
      val entries: String => Seq[String] =
        dir => if dir == "site/globex" then Seq("2026-04") else Seq.empty
      assertTrue(
        openApiRoutes.companySiteRedirect("globex/2026-04/index.html", entries).isEmpty,
        openApiRoutes.companySiteRedirect("globex/docs.json", entries).isEmpty,
        openApiRoutes.companySiteRedirect("assets/app.css", entries).isEmpty,
        openApiRoutes.companySiteRedirect("unknown/index.html", entries).isEmpty
      )
    },
    test("sanitizeOAuth2Target keeps protected docs and site routes") {
      assertTrue(
        openApiRoutes.sanitizeOAuth2Target("/docs").contains("/docs"),
        openApiRoutes.sanitizeOAuth2Target("/docs/openApis/sample").contains("/docs/openApis/sample"),
        openApiRoutes.sanitizeOAuth2Target("/site").contains("/site"),
        openApiRoutes.sanitizeOAuth2Target("/site/").contains("/site/"),
        openApiRoutes.sanitizeOAuth2Target("/site/globex/index.html").contains("/site/globex/index.html")
      )
    },
    test("sanitizeOAuth2Target rejects non-docs routes and open redirects") {
      assertTrue(
        openApiRoutes.sanitizeOAuth2Target("").isEmpty,
        openApiRoutes.sanitizeOAuth2Target("//evil.example").isEmpty,
        openApiRoutes.sanitizeOAuth2Target("https://evil.example/docs").isEmpty,
        openApiRoutes.sanitizeOAuth2Target("/api/process").isEmpty,
        openApiRoutes.sanitizeOAuth2Target("/siteevil").isEmpty
      )
    },
    test("docs token cookie is scoped to the gateway root so /site and /docs both stay authenticated") {
      val cookie = openApiRoutes.docsTokenCookie("token-value")

      assertTrue(
        cookie.name == "orchescala_docs_token",
        cookie.content == "token-value",
        cookie.path.contains(Path.root),
        cookie.isHttpOnly,
        cookie.sameSite.contains(Cookie.SameSite.Lax),
        cookie.maxAge.contains(1.hour)
      )
    }
  )
end OpenApiRoutesSpec


