package orchescala.gateway

import orchescala.engine.DefaultEngineConfig
import orchescala.worker.DefaultWorkerConfig
import zio.*
import zio.http.*
import zio.test.*

object AppRoutesSpec extends ZIOSpecDefault:

  private val testConfig = DefaultGatewayConfig(
    engineConfig = DefaultEngineConfig(),
    workerConfig = DefaultWorkerConfig(DefaultEngineConfig())
  )

  private val appRoutes = AppRoutes()(using testConfig)

  private def get(path: String): ZIO[Any, Nothing, Response] =
    ZIO.scoped(appRoutes.routes.runZIO(Request.get(URL.decode(path).toOption.get)))

  def spec: Spec[TestEnvironment & Scope, Any] = suite("AppRoutes")(
    test("uiUri puts the path below /ui/ of the worker app") {
      assertTrue(
        appRoutes.uiUri("http://my-project:5555", Seq("assets", "index-3f9a.js"))
          .map(_.toString)
          .contains("http://my-project:5555/ui/assets/index-3f9a.js"),
        appRoutes.uiUri("http://my-project:5555", Seq.empty)
          .map(_.toString)
          .contains("http://my-project:5555/ui")
      )
    },
    test("only plain host names are accepted as project name") {
      assertTrue(
        appRoutes.isValidProjectName("esprit-konto"),
        !appRoutes.isValidProjectName("attacker.example"),
        !appRoutes.isValidProjectName("host:8080"),
        !appRoutes.isValidProjectName("")
      )
    },
    test("escaped segments are decoded once - the worker app gets them encoded once") {
      val decoded = orchescala.worker.UiRoutes.decodeSegments(Seq("assets", "my%20logo.svg")).get
      assertTrue(
        appRoutes.uiUri("http://my-project:5555", decoded)
          .map(_.toString)
          .contains("http://my-project:5555/ui/assets/my%20logo.svg")
      )
    },
    test("an escaped path that leaves the ui folder is 404") {
      for
        dots  <- get("/app/esprit-konto/%2e%2e/OpenApi.yml")
        slash <- get("/app/esprit-konto/a%2Fb.js")
      yield assertTrue(dots.status == Status.NotFound, slash.status == Status.NotFound)
    },
    test("GET /app/{projectName} redirects to the canonical path with slash") {
      get("/app/esprit-konto").map: response =>
        assertTrue(
          response.status == Status.MovedPermanently,
          response.rawHeader("Location").contains("/app/esprit-konto/")
        )
    },
    test("the redirect keeps the query - e.g. code and state of an OIDC login") {
      get("/app/esprit-konto?code=abc&state=xyz").map: response =>
        assertTrue(
          response.status == Status.MovedPermanently,
          response.rawHeader("Location").contains("/app/esprit-konto/?code=abc&state=xyz")
        )
    },
    test("an invalid project name is 404") {
      for
        redirect <- get("/app/attacker.example")
        forward  <- get("/app/attacker.example/index.html")
      yield assertTrue(redirect.status == Status.NotFound, forward.status == Status.NotFound)
    },
    test("a 200 of the worker app passes body, content type and cache headers through") {
      val headers  = Map(
        "Content-Type"  -> "text/javascript",
        "Cache-Control" -> "public, max-age=31536000, immutable",
        "Set-Cookie"    -> "x=1"
      )
      val response = appRoutes.toResponse(200, "code".getBytes, headers.get)
      for body <- response.body.asString
      yield assertTrue(
        response.status == Status.Ok,
        body == "code",
        response.rawHeader("Content-Type").contains("text/javascript"),
        response.rawHeader("Cache-Control").exists(_.contains("immutable")),
        response.rawHeader("X-Content-Type-Options").contains("nosniff"),
        response.rawHeader("Set-Cookie").isEmpty,
        response.rawHeader("Content-Security-Policy").isEmpty
      )
    },
    test("304 and client errors pass through, server errors become 502") {
      assertTrue(
        appRoutes.toResponse(304, Array.empty, _ => None).status == Status.NotModified,
        appRoutes.toResponse(404, Array.empty, _ => None).status == Status.NotFound,
        appRoutes.toResponse(403, Array.empty, _ => None).status == Status.Forbidden,
        appRoutes.toResponse(500, Array.empty, _ => None).status == Status.BadGateway
      )
    },
    test("a configured Content-Security-Policy is added") {
      val withCsp = new DefaultGatewayConfig(
        engineConfig = DefaultEngineConfig(),
        workerConfig = DefaultWorkerConfig(DefaultEngineConfig())
      ):
        override def uiContentSecurityPolicy: Option[String] = Some("default-src 'self'")
      val response = AppRoutes()(using withCsp).toResponse(200, Array.empty, _ => None)
      assertTrue(response.rawHeader("Content-Security-Policy").contains("default-src 'self'"))
    }
  )
end AppRoutesSpec
