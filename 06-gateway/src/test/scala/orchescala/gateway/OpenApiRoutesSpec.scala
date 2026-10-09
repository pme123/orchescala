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

  // the worker apps of the projects: none - a closed port on this machine, refused at once (the default
  // docsAppUrl could reach a real worker app of the developer, e.g. on localhost:5555)
  private val noWorkerApps =
    // a port taken and closed again - refused at once, without relying on a «well-known closed» port
    val closed = java.net.ServerSocket(0, 1, java.net.InetAddress.getLoopbackAddress)
    val port   = closed.getLocalPort
    closed.close()
    OpenApiRoutes()(using testConfig.copy(docsAppUrl = _ => Some(s"http://127.0.0.1:$port")))

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
      val cookie = openApiRoutes.docsTokenCookie("token-value", secure = false)

      assertTrue(
        cookie.name == "orchescala_docs_token",
        cookie.content == "token-value",
        cookie.path.contains(Path.root),
        cookie.isHttpOnly,
        cookie.sameSite.contains(Cookie.SameSite.Lax),
        cookie.maxAge.contains(1.hour),
        !cookie.isSecure
      )
    },
    test("a project's API: the worker app's when it answers, else the released one of the site") {
      val unreachable = Response.status(Status.ServiceUnavailable)
      def shop(forwarded: Response) = openApiRoutes.orSiteFile("acme", "acme-shop", "OpenApi.yml", MediaType.text.yaml)(forwarded)
      for
        released   <- shop(unreachable)
        body       <- released.body.asString
        noUrl      <- shop(Response.status(Status.NotFound))
        live       <- shop(Response.text("live"))
        liveBody   <- live.body.asString
        // the worker app answers with an error, or its URL is wrong: not hidden behind the released file
        workerErr  <- shop(Response.status(Status.BadGateway))
        wrongUrl   <- shop(Response.status(Status.InternalServerError))
        missing    <- openApiRoutes.orSiteFile("acme", "acme-cards", "OpenApi.yml", MediaType.text.yaml)(unreachable)
        traversal  <- openApiRoutes.orSiteFile("..", "acme-shop", "OpenApi.yml", MediaType.text.yaml)(unreachable)
      yield assertTrue(
        released.status == Status.Ok,
        released.rawHeader(openApiRoutes.DocsSourceHeader).contains("released"),
        body.contains("acme-shop (released)"),
        noUrl.status == Status.Ok,
        liveBody == "live",
        live.rawHeader(openApiRoutes.DocsSourceHeader).isEmpty,
        workerErr.status == Status.BadGateway,
        wrongUrl.status == Status.InternalServerError,
        missing.status == Status.ServiceUnavailable,
        traversal.status == Status.ServiceUnavailable
      )
    },
    test("the routes of a project's API: without its worker app the released files of the site") {
      def get(path: String) =
        noWorkerApps.routes.runZIO(Request.get(URL.decode(path).toOption.get))
          .flatMap(r => r.body.asString.map(r.status -> _))
      def headers(path: String) =
        noWorkerApps.routes.runZIO(Request.get(URL.decode(path).toOption.get)).map: r =>
          (r.header(Header.ContentType).map(_.mediaType), r.rawHeader("X-Content-Type-Options"))
      for
        yml     <- get("/site/acme/acme-shop/OpenApi.yml")
        page    <- get("/site/acme/acme-shop/OpenApi.html")
        diagram <- get("/site/acme/acme-shop/diagrams/shop.bpmn")
        none    <- get("/site/acme/acme-cards/OpenApi.yml")
        diaHead <- headers("/site/acme/acme-shop/diagrams/shop.bpmn")
        ymlHead <- headers("/site/acme/acme-shop/OpenApi.yml")
      yield assertTrue(
        yml._1 == Status.Ok, yml._2.contains("acme-shop (released)"),
        page._1 == Status.Ok, page._2.contains("acme-shop API (released)"),
        diagram._1 == Status.Ok, diagram._2.contains("<bpmn"),
        none._1 == Status.ServiceUnavailable,
        // the headers of the live answer: a diagram is XML, not sniffed
        diaHead == (Some(MediaType.application.xml), Some("nosniff")),
        ymlHead == (Some(MediaType.text.yaml), Some("nosniff"))
      )
    } @@ TestAspect.timeout(20.seconds), // a sandbox that drops packets instead of refusing: fail, not hang
    test("a worker app that does not answer: the released file after docsForwardTimeout, then at once") {
      // accepts connections, never answers - like a host that is up but stuck (or a proxy that drops)
      val stuck = java.net.ServerSocket(0, 50, java.net.InetAddress.getLoopbackAddress)
      val port  = stuck.getLocalPort
      val held  = java.util.concurrent.ConcurrentLinkedQueue[java.net.Socket]()
      val accept = Thread(() => try while true do held.add(stuck.accept()) catch case _: java.io.IOException => ())
      accept.setDaemon(true)
      accept.start()
      val slowConfig = new DefaultGatewayConfig(
        engineConfig = DefaultEngineConfig(),
        workerConfig = DefaultWorkerConfig(DefaultEngineConfig()),
        docsAppUrl = _ => Some(s"http://127.0.0.1:$port")
      ):
        override def docsForwardTimeout: zio.Duration = 1.second
      val routes = OpenApiRoutes()(using slowConfig).routes
      def get(path: String) = routes.runZIO(Request.get(URL.decode(path).toOption.get))
      (for
        first  <- get("/site/acme/acme-shop/OpenApi.yml").timed
        second <- get("/site/acme/acme-shop/diagrams/shop.bpmn")
        // the accept thread has seen the first connection (it waited a second on it) - give it a moment
        _      <- ZIO.succeed(held.size).repeatUntil(_ >= 1)
                    .timeoutFail(new AssertionError("the stalled server saw no connection"))(2.seconds)
      yield assertTrue(
        first._2.status == Status.Ok,
        first._2.rawHeader(openApiRoutes.DocsSourceHeader).contains("released"),
        first._1.toMillis >= 900, // waited for the timeout
        second.status == Status.Ok,
        held.size == 1 // the worker app did not answer just now: not asked again
      )).ensuring(ZIO.succeed { stuck.close(); held.forEach(_.close()) })
    } @@ TestAspect.withLiveClock @@ TestAspect.timeout(30.seconds),
    test("a worker app that answers 503 (restarting): the released file; one that answers 500 or 404: passed on (502)") {
      def server(code: Int) =
        val srv = com.sun.net.httpserver.HttpServer.create(java.net.InetSocketAddress(java.net.InetAddress.getLoopbackAddress, 0), 0)
        srv.createContext("/", ex => { ex.sendResponseHeaders(code, -1); ex.close() })
        srv.start()
        srv
      def api(port: Int) = OpenApiRoutes()(using testConfig.copy(docsAppUrl = _ => Some(s"http://127.0.0.1:$port")))
      ZIO.acquireRelease(ZIO.succeed((server(503), server(500), server(404))))((a, b, c) => ZIO.succeed { a.stop(0); b.stop(0); c.stop(0) })
        .flatMap: (restarting, broken, missing) =>
          val restartingApi = api(restarting.getAddress.getPort)
          // a mark from before (its window over): the 503 of an app that answers takes it away
          restartingApi.docsDown.markDown("acme-shop", java.lang.System.currentTimeMillis - 60000)
          for
            released <- restartingApi.routes.runZIO(Request.get(URL.decode("/site/acme/acme-shop/OpenApi.yml").toOption.get))
            body     <- released.body.asString
            passed   <- api(broken.getAddress.getPort).routes.runZIO(Request.get(URL.decode("/site/acme/acme-shop/OpenApi.yml").toOption.get))
            notThere <- api(missing.getAddress.getPort).routes.runZIO(Request.get(URL.decode("/site/acme/acme-shop/OpenApi.yml").toOption.get))
          yield assertTrue(
            released.status == Status.Ok,
            body.contains("acme-shop (released)"),
            // it answered (503 for this file): not marked down - the next file is asked live
            !restartingApi.docsDown.isDown("acme-shop", java.lang.System.currentTimeMillis),
            restartingApi.docsDown.size == 0, // the old mark is gone, not only expired
            passed.status == Status.BadGateway,
            // its own 404 is its answer (502) - not replaced by the released file
            notThere.status == Status.BadGateway
          )
    } @@ TestAspect.withLiveClock @@ TestAspect.timeout(30.seconds),
    test("not reachable: the project marked down - the next file from the site without asking") {
      // a port that refuses: «not there» - the first file marks it, the second does not ask again
      val closed = java.net.ServerSocket(0, 1, java.net.InetAddress.getLoopbackAddress)
      val port   = closed.getLocalPort
      closed.close()
      val api    = OpenApiRoutes()(using testConfig.copy(docsAppUrl = _ => Some(s"http://127.0.0.1:$port")))
      def get(path: String) = api.routes.runZIO(Request.get(URL.decode(path).toOption.get))
      for
        first  <- get("/site/acme/acme-shop/OpenApi.yml")
        marked  = api.docsDown.isDown("acme-shop", java.lang.System.currentTimeMillis)
        second <- get("/site/acme/acme-shop/diagrams/shop.bpmn")
      yield assertTrue(
        first.status == Status.Ok, // the released file
        marked,
        second.status == Status.Ok,
        second.rawHeader(api.DocsSourceHeader).contains("released")
      )
    } @@ TestAspect.withLiveClock @@ TestAspect.timeout(30.seconds),
    test("not reachable, no site folder: not in the main down list, in the small one (no 20 s per file)") {
      val closed = java.net.ServerSocket(0, 1, java.net.InetAddress.getLoopbackAddress)
      val port   = closed.getLocalPort
      closed.close()
      val api    = OpenApiRoutes()(using testConfig.copy(docsAppUrl = _ => Some(s"http://127.0.0.1:$port")))
      for
        answer <- api.routes.runZIO(Request.get(URL.decode("/site/acme/made-up-name/OpenApi.yml").toOption.get))
      yield assertTrue(
        answer.status == Status.ServiceUnavailable,
        api.docsDown.size == 0, // a made-up name does not take a place in the main list
        api.docsDownNoSite.isDown("made-up-name", java.lang.System.currentTimeMillis) // but is not asked again
      )
    } @@ TestAspect.withLiveClock @@ TestAspect.timeout(30.seconds),
    test("down by another company's request (no site there): this company's released file, not a bare 503") {
      // b/shop has no site folder (in the small list) - acme/acme-shop has one: the shortcut still falls back
      val api = OpenApiRoutes()(using testConfig.copy(docsAppUrl = _ => Some("http://127.0.0.1:1")))
      api.docsDownNoSite.markDown("acme-shop", java.lang.System.currentTimeMillis)
      for
        answer <- api.routes.runZIO(Request.get(URL.decode("/site/acme/acme-shop/OpenApi.yml").toOption.get))
        body   <- answer.body.asString
      yield assertTrue(
        answer.status == Status.Ok,
        body.contains("acme-shop (released)"),
        answer.rawHeader(api.DocsSourceHeader).contains("released")
      )
    },
    test("DownList - 503 down for the window, a good answer clears it, at most max projects") {
      val down = OpenApiRoutes.DownList(downForMs = 30000, max = 2)
      down.markDown("shop", now = 0)
      val inWindow  = down.isDown("shop", now = 29999)
      val after     = down.isDown("shop", now = 30000)
      down.markUp("shop") // it answered: asked again at once
      val cleared   = !down.isDown("shop", now = 1001)
      val notDown   = !down.isDown("cards", now = 1) // never marked
      // full: expired ones go first, then the one that ends first - the new project is remembered
      down.markDown("a", now = 0)
      down.markDown("b", now = 5)
      down.markDown("c", now = 10)
      val capped    = down.size == 2 && down.isDown("c", now = 11) && !down.isDown("a", now = 11) && down.isDown("b", now = 11)
      down.markDown("d", now = 40000) // b and c have expired
      val refreshed = down.isDown("d", now = 40001) && down.size == 1
      assertTrue(inWindow, !after, cleared, notDown, capped, refreshed)
    },
    test("DownList - markDown / markUp from many threads: never over max, no error") {
      val down    = OpenApiRoutes.DownList(downForMs = 30000, max = 50)
      val threads = (1 to 8).map: t =>
        Thread(() =>
          for i <- 1 to 2000 do
            val p = s"p${(t * 7919 + i) % 120}"
            if i % 3 == 0 then down.markUp(p) else down.markDown(p, now = i.toLong)
            assert(down.size <= 50)
        )
      threads.foreach(_.start())
      threads.foreach(_.join(10000))
      assertTrue(down.size <= 50, threads.forall(!_.isAlive))
    },
    test("isValidSiteFolder - a company folder may have _ (no fallback is skipped for it)") {
      assertTrue(
        openApiRoutes.isValidSiteFolder("acme_corp"),
        openApiRoutes.isValidSiteFolder("acme-shop"),
        !openApiRoutes.isValidSiteFolder(".."),
        !openApiRoutes.isValidSiteFolder("a/b"),
        !openApiRoutes.isValidSiteFolder("_x")
      )
    },
    test("the favicon is served (its stream closed)") {
      for
        response <- openApiRoutes.routes.runZIO(Request.get(URL.decode("/favicon.ico").toOption.get))
        bytes    <- response.body.asArray
      yield assertTrue(response.status == Status.Ok, bytes.nonEmpty)
    },
    test("the directory entries of the site are read once - the same answer from the cache") {
      val first  = openApiRoutes.cachedDirectoryEntries("site/unknown-company")
      val second = openApiRoutes.cachedDirectoryEntries("site/unknown-company")
      assertTrue(first == openApiRoutes.classpathDirectoryEntries("site/unknown-company"), first == second)
    },
    test("behind https the docs token cookie is Secure") {
      assertTrue(openApiRoutes.docsTokenCookie("token-value", secure = true).isSecure)
    },
    test("sanitizeOAuth2Target rejects targets that break out of the continue page (XSS)") {
      assertTrue(
        openApiRoutes.sanitizeOAuth2Target("/site/</script><script>alert(1)</script>").isEmpty,
        openApiRoutes.sanitizeOAuth2Target("/docs/\"onmouseover=alert(1)").isEmpty,
        openApiRoutes.sanitizeOAuth2Target("/site/a b").isEmpty,
        openApiRoutes.sanitizeOAuth2Target("/site/#/globex").contains("/site/#/globex"),
        openApiRoutes.sanitizeOAuth2Target("/site/globex/2026-04/a%20b.html").contains("/site/globex/2026-04/a%20b.html")
      )
    },
    suite("docs forwarding to the worker apps (SSRF)")(
      test("only a plain host name is a project name") {
        assertTrue(
          openApiRoutes.isValidProjectName("globex-product"),
          openApiRoutes.isValidProjectName("sample"),
          !openApiRoutes.isValidProjectName("attacker.example"),
          !openApiRoutes.isValidProjectName("10.0.0.5"),
          !openApiRoutes.isValidProjectName("host:8080"),
          !openApiRoutes.isValidProjectName("user@host"),
          !openApiRoutes.isValidProjectName("-host"),
          !openApiRoutes.isValidProjectName("")
        )
      },
      test("a diagram name is a file name - no path traversal") {
        assertTrue(
          openApiRoutes.isValidDiagramName("my-process.bpmn"),
          openApiRoutes.isValidDiagramName("decision_1.dmn"),
          !openApiRoutes.isValidDiagramName(".."),
          !openApiRoutes.isValidDiagramName("..%2Fadmin"),
          !openApiRoutes.isValidDiagramName(".hidden"),
          !openApiRoutes.isValidDiagramName("")
        )
      },
      test("a host in the path is not forwarded to - the docsAppUrl is not even asked") {
        val asked     = java.util.concurrent.ConcurrentLinkedQueue[String]()
        val routes    = OpenApiRoutes()(using testConfig.copy(docsAppUrl = project =>
          asked.add(project)
          None
        )).routes
        val request   = Request.get(URL.decode("/site/c/attacker.example/OpenApi.html").toOption.get)
        for response <- routes.runZIO(request)
        yield assertTrue(response.status == Status.NotFound, asked.isEmpty)
      }
    ),
    suite("docs OAuth2 code exchange")(
      test("a duplicate callback of the same login reuses the exchange") {
        val routes = OpenApiRoutes()(using testConfig)
        for
          calls  <- Ref.make(0)
          exchange = calls.update(_ + 1).as("token")
          first  <- routes.exchangeCodeForTokenOnce("code", "state", exchange)
          second <- routes.exchangeCodeForTokenOnce("code", "state", exchange)
          count  <- calls.get
        yield assertTrue(first == "token", second == "token", count == 1)
      },
      test("a code with another state is not answered from the cache (leaked code)") {
        val routes = OpenApiRoutes()(using testConfig)
        for
          calls  <- Ref.make(0)
          _      <- routes.exchangeCodeForTokenOnce("code", "state", calls.update(_ + 1).as("token"))
          replay <- routes.exchangeCodeForTokenOnce("code", "attacker-state", calls.update(_ + 1) *> ZIO.fail("invalid_grant")).either
          count  <- calls.get
        yield assertTrue(replay == Left("invalid_grant"), count == 2)
      },
      test("a failed exchange is not kept") {
        val routes = OpenApiRoutes()(using testConfig)
        for
          _       <- ZIO.foreachDiscard(1 to 50): i =>
                       routes.exchangeCodeForTokenOnce(s"made-up-$i", "state", ZIO.fail("invalid_grant")).ignore
        yield assertTrue(routes.pendingCodeExchanges == 0)
      }
    )
  )
end OpenApiRoutesSpec


