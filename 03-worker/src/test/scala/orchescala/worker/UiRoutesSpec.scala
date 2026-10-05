package orchescala.worker

import zio.*
import zio.http.*
import zio.test.*

object UiRoutesSpec extends ZIOSpecDefault:

  private def get(path: String): ZIO[Any, Nothing, Response] =
    ZIO.scoped(UiRoutes.routes.runZIO(Request.get(URL.decode(path).toOption.get)))

  def spec: Spec[TestEnvironment & Scope, Any] = suite("UiRoutes")(
    test("resolve maps the root and app routes to index.html") {
      assertTrue(
        UiRoutes.resolve("").contains(UiRoutes.indexFile),
        UiRoutes.resolve("/").contains(UiRoutes.indexFile),
        UiRoutes.resolve("customers/42").contains(UiRoutes.indexFile)
      )
    },
    test("resolve maps files to the ui folder") {
      assertTrue(
        UiRoutes.resolve("assets/app-abc123.js").contains("ui/assets/app-abc123.js"),
        UiRoutes.resolve("favicon.svg").contains("ui/favicon.svg")
      )
    },
    test("resolve rejects paths that leave the ui folder") {
      assertTrue(
        UiRoutes.resolve("../OpenApi.yml").isEmpty,
        UiRoutes.resolve("assets/../../x.js").isEmpty,
        UiRoutes.resolve("./index.html").isEmpty,
        UiRoutes.resolve("assets\\x.js").isEmpty
      )
    },
    test("hashed assets are cached, everything else revalidated") {
      assertTrue(
        UiRoutes.cacheControl("ui/assets/app-abc123.js").contains("immutable"),
        UiRoutes.cacheControl(UiRoutes.indexFile) == "no-cache"
      )
    },
    test("GET /ui/ serves index.html") {
      for
        response <- get("/ui/")
        body     <- response.body.asString
      yield assertTrue(
        response.status == Status.Ok,
        body.contains("test-ui"),
        response.rawHeader("Cache-Control").contains("no-cache")
      )
    },
    test("GET /ui serves index.html") {
      get("/ui").map(response => assertTrue(response.status == Status.Ok))
    },
    test("a deep link of the app serves index.html") {
      for
        response <- get("/ui/customers/42")
        body     <- response.body.asString
      yield assertTrue(response.status == Status.Ok, body.contains("test-ui"))
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
    test("a missing file is 404") {
      get("/ui/assets/missing.js").map(response => assertTrue(response.status == Status.NotFound))
    }
  )
end UiRoutesSpec
