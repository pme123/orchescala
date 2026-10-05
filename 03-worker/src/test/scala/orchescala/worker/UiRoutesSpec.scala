package orchescala.worker

import zio.*
import zio.http.*
import zio.test.*

object UiRoutesSpec extends ZIOSpecDefault:

  private def get(path: String, headers: (String, String)*): ZIO[Any, Nothing, Response] =
    val request = headers.foldLeft(Request.get(URL.decode(path).toOption.get)):
      case (req, (name, value)) => req.addHeader(Header.Custom(name, value))
    ZIO.scoped(UiRoutes.routes.runZIO(request))

  /** A jar like the one of a deployed worker app: a file and a folder below ui/. */
  private lazy val jar: java.io.File =
    val file = java.io.File.createTempFile("ui-test", ".jar")
    file.deleteOnExit()
    scala.util.Using.resource(java.util.jar.JarOutputStream(java.io.FileOutputStream(file))): out =>
      out.putNextEntry(java.util.jar.JarEntry("ui/"))
      out.closeEntry()
      out.putNextEntry(java.util.jar.JarEntry("ui/app.js"))
      out.write("console.log('jar')".getBytes)
      out.closeEntry()
      out.putNextEntry(java.util.jar.JarEntry("ui/folder.d/"))
      out.closeEntry()
    file
  end jar

  private def inJar(path: String) = java.net.URI.create(s"jar:${jar.toURI}!/$path").toURL

  def spec: Spec[TestEnvironment & Scope, Any] = suite("UiRoutes")(
    test("the root and app routes resolve to index.html") {
      assertTrue(
        UiRoutes.candidates(Seq.empty, acceptsHtml = false) == Seq(UiRoutes.indexFile),
        UiRoutes.candidates(Seq("customers", "42"), acceptsHtml = false) == Seq(UiRoutes.indexFile)
      )
    },
    test("files resolve to the ui folder - a page request falls back to index.html, assets never") {
      assertTrue(
        UiRoutes.candidates(Seq("assets", "app-abc123.js"), acceptsHtml = true) ==
          Seq("ui/assets/app-abc123.js"),
        UiRoutes.candidates(Seq("favicon.svg"), acceptsHtml = false) == Seq("ui/favicon.svg"),
        UiRoutes.candidates(Seq("users", "john.doe"), acceptsHtml = true) ==
          Seq("ui/users/john.doe", UiRoutes.indexFile)
      )
    },
    test("below assets/ nothing falls back to index.html - also without a dot") {
      assertTrue(
        UiRoutes.candidates(
          Seq("assets", "LICENSE"),
          acceptsHtml = true
        ) == Seq("ui/assets/LICENSE"),
        UiRoutes.candidates(Seq("assets", "foo"), acceptsHtml = false) == Seq("ui/assets/foo")
      )
    },
    test("If-None-Match matches lists, weak ETags and *") {
      assertTrue(
        UiRoutes.matches("\"a\"", "\"a\""),
        UiRoutes.matches("\"x\", W/\"a\"", "\"a\""),
        UiRoutes.matches("*", "\"a\""),
        !UiRoutes.matches("\"b\"", "\"a\"")
      )
    },
    test("segments are decoded - and checked after decoding") {
      assertTrue(
        UiRoutes.decodeSegments(Seq("assets", "my%20logo.svg")).contains(Seq(
          "assets",
          "my logo.svg"
        )),
        UiRoutes.decodeSegments(Seq("a+b.js")).contains(Seq("a+b.js")),
        UiRoutes.decodeSegments(Seq("..")).isEmpty,
        UiRoutes.decodeSegments(Seq("%2e%2e", "OpenApi.yml")).isEmpty,
        UiRoutes.decodeSegments(Seq("a%2Fb.js")).isEmpty,
        UiRoutes.decodeSegments(Seq("a%5Cb.js")).isEmpty,
        UiRoutes.decodeSegments(Seq("%zz")).isEmpty
      )
    },
    test("hashed assets are cached, everything else revalidated") {
      assertTrue(
        UiRoutes.cacheControl("ui/assets/app-abc123.js").contains("immutable"),
        UiRoutes.cacheControl(UiRoutes.indexFile) == "no-cache"
      )
    },
    test("GET /ui/ serves index.html with an ETag") {
      for
        response <- get("/ui/")
        body     <- response.body.asString
      yield assertTrue(
        response.status == Status.Ok,
        body.contains("test-ui"),
        response.rawHeader("Cache-Control").contains("no-cache"),
        response.rawHeader("ETag").exists(_.startsWith("\""))
      )
    },
    test("GET /ui serves index.html") {
      get("/ui").map(response => assertTrue(response.status == Status.Ok))
    },
    test("an unchanged file is answered with 304") {
      for
        first  <- get("/ui/")
        etag    = first.rawHeader("ETag").get
        second <- get("/ui/", "If-None-Match" -> etag)
        other  <- get("/ui/", "If-None-Match" -> "\"something-else\"")
      yield assertTrue(second.status == Status.NotModified, other.status == Status.Ok)
    },
    test("a deep link of the app serves index.html - also with a dot in the last segment") {
      for
        plain  <- get("/ui/customers/42")
        dotted <- get("/ui/users/john.doe", "Accept" -> "text/html,application/xhtml+xml")
        body   <- dotted.body.asString
      yield assertTrue(
        plain.status == Status.Ok,
        dotted.status == Status.Ok,
        body.contains("test-ui")
      )
    },
    test("GET /ui/assets/... serves the file with its content type") {
      for
        response <- get("/ui/assets/app-abc123.js")
        body     <- response.body.asString
      yield assertTrue(
        response.status == Status.Ok,
        body.contains("console.log"),
        response.rawHeader("Content-Type").exists(_.contains("javascript")),
        response.rawHeader("Cache-Control").exists(_.contains("immutable"))
      )
    },
    test("a file name with an escaped space is found") {
      get("/ui/assets/my%20logo.svg").map(response => assertTrue(response.status == Status.Ok))
    },
    test("GET /ui/assets/ without file extension is 404, not index.html") {
      get("/ui/assets/LICENSE", "Accept" -> "text/html").map(r =>
        assertTrue(r.status == Status.NotFound)
      )
    },
    test("a missing file is 404 - also for a page request below assets/") {
      for
        missing <- get("/ui/assets/missing.js")
        page    <- get("/ui/assets/missing.js", "Accept" -> "text/html")
      yield assertTrue(missing.status == Status.NotFound, page.status == Status.NotFound)
    },
    test("the default limit of the WorkerConfig is the one of the gateway") {
      assertTrue(
        DefaultWorkerConfig(orchescala.engine.DefaultEngineConfig()).uiMaxFileSize ==
          UiRoutes.defaultMaxFileSize
      )
    },
    test("error answers carry the security headers too") {
      get("/ui/assets/missing.js").map: response =>
        assertTrue(
          response.status == Status.NotFound,
          response.rawHeader("X-Content-Type-Options").contains("nosniff"),
          response.rawHeader("Referrer-Policy").isDefined
        )
    },
    test("in a jar a file is a file, a folder entry is not") {
      assertTrue(
        UiRoutes.isFile(inJar("ui/app.js")),
        !UiRoutes.isFile(inJar("ui/folder.d/")),
        !UiRoutes.isFile(inJar("ui/missing.js"))
      )
    },
    test("only GET is routed - HEAD is 404; a Range header is ignored, the whole file comes") {
      val head =
        Request(method = Method.HEAD, url = URL.decode("/ui/assets/app-abc123.js").toOption.get)
      for
        headResponse <- ZIO.scoped(UiRoutes.routes.runZIO(head))
        ranged       <- get("/ui/assets/app-abc123.js", "Range" -> "bytes=0-3")
        body         <- ranged.body.asString
      yield assertTrue(
        headResponse.status == Status.NotFound,
        ranged.status == Status.Ok,
        body.contains("console.log")
      )
      end for
    },
    test("a folder on the classpath is not served as a file") {
      get("/ui/folder.d").map(response => assertTrue(response.status == Status.NotFound))
    },
    test("responses say they vary by Accept - a page request may get index.html") {
      for
        found   <- get("/ui/")
        missing <- get("/ui/users/john.doe")
      yield assertTrue(
        found.rawHeader("Vary").contains("Accept"),
        missing.status == Status.NotFound,
        missing.rawHeader("Vary").contains("Accept")
      )
    },
    test("a file larger than the limit of the WorkerConfig is not served - 500, logged") {
      ZIO.scoped(UiRoutes.routesWith(maxFileSize =
        10
      ).runZIO(Request.get(URL.decode("/ui/").toOption.get)))
        .map(response => assertTrue(response.status == Status.InternalServerError))
    },
    test("an escaped path that leaves the ui folder is 404") {
      get("/ui/%2e%2e/OpenApi.yml").map(response => assertTrue(response.status == Status.NotFound))
    }
  )
end UiRoutesSpec
