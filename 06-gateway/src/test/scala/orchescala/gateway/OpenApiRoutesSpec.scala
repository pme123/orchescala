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
        !openApiRoutes.needsCanonicalSiteRedirect("/site/valiant/index.html")
      )
    },
    test("siteResourcePath resolves the site index for the canonical /site/ root") {
      assertTrue(
        openApiRoutes.siteResourcePath("") == "site/index.html",
        openApiRoutes.siteResourcePath("   ") == "site/index.html"
      )
    },
    test("siteResourcePath preserves nested Laika assets under /site") {
      assertTrue(
        openApiRoutes.siteResourcePath("valiant/helium/site/icofont.min.css") ==
          "site/valiant/helium/site/icofont.min.css",
        openApiRoutes.siteResourcePath("valiant/development/catalog.html") ==
          "site/valiant/development/catalog.html"
      )
    },
    test("siteFolderRedirectLocation resolves nested folder URLs to index.html") {
      val resourceExists = Set(
        "site/valiant/index.html",
        "site/valiant/2026-04/index.html"
      )
      val directoryExists = Set(
        "site/valiant",
        "site/valiant/2026-04"
      )

      assertTrue(
        openApiRoutes.siteFolderRedirectLocation(
          "valiant/2026-04",
          "/site/valiant/2026-04/",
          resourceExists.contains,
          directoryExists.contains
        ).contains("/site/valiant/2026-04/index.html"),
        openApiRoutes.siteFolderRedirectLocation(
          "valiant/2026-04",
          "/site/valiant/2026-04",
          resourceExists.contains,
          directoryExists.contains
        ).contains("/site/valiant/2026-04/index.html")
      )
    },
    test("siteFolderRedirectLocation ignores direct file requests and unknown folders") {
      assertTrue(
        openApiRoutes.siteFolderRedirectLocation(
          "valiant/development/catalog.html",
          "/site/valiant/development/catalog.html",
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
    test("versionedSiteRedirect forwards a generic company index to the newest available release") {
      val redirect = openApiRoutes.versionedSiteRedirect(
        "valiant/index.html",
        company =>
          if company == "valiant" then Seq("2025-11", "2026-04", "notes")
          else Seq.empty
      )

      assertTrue(redirect.contains("/site/valiant/2026-04/index.html"))
    },
    test("versionedSiteRedirect ignores already-versioned or unrelated paths") {
      assertTrue(
        openApiRoutes.versionedSiteRedirect(
          "valiant/2026-04/index.html",
          _ => Seq("2026-04")
        ).isEmpty,
        openApiRoutes.versionedSiteRedirect(
          "valiant/assets/app.css",
          _ => Seq("2026-04")
        ).isEmpty,
        openApiRoutes.versionedSiteRedirect(
          "unknown/index.html",
          _ => Seq.empty
        ).isEmpty
      )
    },
    test("sanitizeOAuth2Target keeps protected docs and site routes") {
      assertTrue(
        openApiRoutes.sanitizeOAuth2Target("/docs").contains("/docs"),
        openApiRoutes.sanitizeOAuth2Target("/docs/openApis/sample").contains("/docs/openApis/sample"),
        openApiRoutes.sanitizeOAuth2Target("/site").contains("/site"),
        openApiRoutes.sanitizeOAuth2Target("/site/").contains("/site/"),
        openApiRoutes.sanitizeOAuth2Target("/site/valiant/index.html").contains("/site/valiant/index.html")
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


