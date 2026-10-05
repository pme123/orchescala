package orchescala.gateway

import orchescala.engine.DefaultEngineConfig
import orchescala.engine.rest.SttpClientBackend
import orchescala.worker.DefaultWorkerConfig
import sttp.capabilities.WebSockets
import sttp.capabilities.zio.ZioStreams
import sttp.client3.Response as SttpResponse
import sttp.client3.asynchttpclient.zio.AsyncHttpClientZioBackend
import sttp.client3.testing.SttpBackendStub
import sttp.model.{Header as SttpHeader, StatusCode}
import zio.*
import zio.http.*
import zio.stream.ZStream
import zio.test.*

object AppRoutesSpec extends ZIOSpecDefault:

  private val testConfig = DefaultGatewayConfig(
    engineConfig = DefaultEngineConfig(),
    workerConfig = DefaultWorkerConfig(DefaultEngineConfig())
  )

  private val appRoutes = AppRoutes()(using testConfig)

  /** AppRoutes against a stubbed worker app - the whole forward path without a server. */
  private def stubbed(
      stub: SttpBackendStub[Task, ZioStreams & WebSockets],
      config: GatewayConfig = testConfig
  ) = AppRoutes(stub: SttpClientBackend)(using config)

  private def workerAnswer(status: StatusCode, body: String, headers: (String, String)*) =
    SttpResponse(
      SttpBackendStub.RawStream(ZStream.fromIterable(body.getBytes)),
      status,
      "",
      headers.map((name, value) => SttpHeader(name, value))
    )

  private def getVia(routes: AppRoutes, path: String, headers: (String, String)*) =
    val request = headers.foldLeft(Request.get(URL.decode(path).toOption.get)):
      case (req, (name, value)) => req.addHeader(Header.Custom(name, value))
    ZIO.scoped(routes.routes.runZIO(request))

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
          response.status == Status.Found,
          response.rawHeader("Location").contains("/app/esprit-konto/")
        )
    },
    test("the redirect keeps the query - e.g. code and state of an OIDC login") {
      get("/app/esprit-konto?code=abc&state=xyz").map: response =>
        assertTrue(
          response.status == Status.Found,
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
    test("the answer of the worker app is read up to the limit - a bigger one fails") {
      val bytes = zio.stream.ZStream.fromIterable("12345".getBytes)
      for
        fits   <- appRoutes.readCapped(bytes, 5)
        tooBig <- appRoutes.readCapped(bytes, 4).flip
      yield assertTrue(new String(fits) == "12345", tooBig.contains("larger than 4 bytes"))
    },
    test("Vary of the worker app is passed through, also with a 404") {
      val headers = Map("Vary" -> "Accept")
      assertTrue(
        appRoutes.toResponse(200, Array.empty, headers.get).rawHeader("Vary").contains("Accept"),
        appRoutes.toResponse(404, Array.empty, headers.get).rawHeader("Vary").contains("Accept")
      )
    },
    test("forward: a file of the worker app comes through with body and content type") {
      val stub = AsyncHttpClientZioBackend.stub
        .whenRequestMatches(_.uri.path == List("ui", "index.html"))
        .thenRespond(workerAnswer(StatusCode.Ok, "<html>ok</html>", "Content-Type" -> "text/html"))
      for
        response <- getVia(stubbed(stub), "/app/esprit-konto/index.html")
        body     <- response.body.asString
      yield assertTrue(
        response.status == Status.Ok,
        body == "<html>ok</html>",
        response.rawHeader("Content-Type").contains("text/html")
      )
      end for
    },
    test("forward: If-None-Match reaches the worker app - its 304 comes back") {
      val stub = AsyncHttpClientZioBackend.stub
        .whenRequestMatches(_.header("If-None-Match").contains("\"e1\""))
        .thenRespond(workerAnswer(StatusCode.NotModified, "", "ETag" -> "\"e1\""))
        .whenAnyRequest
        .thenRespond(workerAnswer(StatusCode.Ok, "full"))
      getVia(stubbed(stub), "/app/esprit-konto/index.html", "If-None-Match" -> "\"e1\"").map:
        response => assertTrue(response.status == Status.NotModified)
    },
    test("forward: a redirect of the worker app is not followed - 502") {
      val stub = AsyncHttpClientZioBackend.stub.whenAnyRequest
        .thenRespond(workerAnswer(StatusCode.Found, "", "Location" -> "http://elsewhere.example/"))
      getVia(stubbed(stub), "/app/esprit-konto/index.html").map: response =>
        assertTrue(response.status == Status.BadGateway)
    },
    test("forward: an unreachable worker app is 502") {
      val stub = AsyncHttpClientZioBackend.stub.whenAnyRequest
        .thenRespondF(ZIO.fail(RuntimeException("worker app down")))
      getVia(stubbed(stub), "/app/esprit-konto/index.html").map: response =>
        assertTrue(response.status == Status.BadGateway)
    },
    test("forward: error answers carry the security headers too") {
      val stub = AsyncHttpClientZioBackend.stub.whenAnyRequest
        .thenRespondF(ZIO.fail(RuntimeException("worker app down")))
      for
        badGateway <- getVia(stubbed(stub), "/app/esprit-konto/index.html")
        notFound   <- get("/app/attacker.example/index.html")
      yield assertTrue(
        badGateway.rawHeader("X-Content-Type-Options").contains("nosniff"),
        notFound.rawHeader("X-Content-Type-Options").contains("nosniff")
      )
      end for
    },
    test("forward: an answer larger than uiMaxFileSize is 502") {
      val small = new DefaultGatewayConfig(
        engineConfig = DefaultEngineConfig(),
        workerConfig = DefaultWorkerConfig(DefaultEngineConfig())
      ):
        override def uiMaxFileSize: Long = 4
      val stub  = AsyncHttpClientZioBackend.stub.whenAnyRequest
        .thenRespond(workerAnswer(StatusCode.Ok, "12345"))
      for
        tooBig <- getVia(stubbed(stub, small), "/app/esprit-konto/index.html")
        fits   <- getVia(stubbed(stub), "/app/esprit-konto/index.html")
      yield assertTrue(tooBig.status == Status.BadGateway, fits.status == Status.Ok)
    },
    test("uiMaxConcurrentForwards must be positive - else every UI request would wait for ever") {
      val none = new DefaultGatewayConfig(
        engineConfig = DefaultEngineConfig(),
        workerConfig = DefaultWorkerConfig(DefaultEngineConfig())
      ):
        override def uiMaxConcurrentForwards: Int = 0
      assertTrue(scala.util.Try(AppRoutes()(using none)).isFailure)
    },
    test("a configured Content-Security-Policy is added") {
      val withCsp  = new DefaultGatewayConfig(
        engineConfig = DefaultEngineConfig(),
        workerConfig = DefaultWorkerConfig(DefaultEngineConfig())
      ):
        override def uiContentSecurityPolicy: Option[String] = Some("default-src 'self'")
      val response = AppRoutes()(using withCsp).toResponse(200, Array.empty, _ => None)
      assertTrue(response.rawHeader("Content-Security-Policy").contains("default-src 'self'"))
    }
  )
end AppRoutesSpec
