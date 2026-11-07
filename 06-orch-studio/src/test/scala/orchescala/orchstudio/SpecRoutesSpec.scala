package orchescala.orchstudio

import zio.*
import zio.http.*
import zio.test.*

object SpecRoutesSpec extends ZIOSpecDefault:

  private val book =
    """{"path":"shop/book","title":"Termin buchen","access":"public","body":[{"type":"heading","text":"Termin buchen"},{"type":"button","label":"Buchen","actions":[]}]}"""
  private val edited =
    """{"path":"shop/book","title":"Beratung buchen","access":"public","body":[{"type":"heading","text":"Termin buchen"},{"type":"text","text":"Hinweis"},{"type":"button","label":"Buchen","actions":[]}]}"""

  private def post(body: String) =
    SpecRoutes.routes.runZIO(Request.post(URL(Path.decode("/spec/pages/diff")), Body.fromString(body)))

  def spec = suite("SpecRoutes")(
    test("POST /spec/pages/diff - the differences, as orch-spec computes them"):
      for
        r    <- post(s"""{"before":$book,"after":$edited}""")
        body <- r.body.asString
      yield assertTrue(
        r.status == Status.Ok,
        body == """[{"kind":"page","label":"Titel","detail":"«Termin buchen» → «Beratung buchen»"},{"kind":"added","key":"1","label":"Text «Hinweis»"}]"""
      )
    ,
    test("a page missing, no object or no JSON - 400 with the reason"):
      for
        missing  <- post(s"""{"before":$book}""")
        noObject <- post(s"""{"before":$book,"after":[1,2]}""")
        noJson   <- post("{")
        m        <- missing.body.asString
        o        <- noObject.body.asString
        j        <- noJson.body.asString
      yield assertTrue(
        missing.status == Status.BadRequest,
        m.contains("`after` is missing"),
        noObject.status == Status.BadRequest,
        o.contains("`after` is missing"),
        noJson.status == Status.BadRequest,
        j.contains("the body is no JSON")
      )
    ,
    test("too many building blocks - 400, not computed"):
      val blocks = Seq.fill(SpecRoutes.maxBlocks + 1)("""{"type":"text","text":"x"}""").mkString(",")
      for
        r <- post(s"""{"before":$book,"after":{"title":"x","body":[$blocks]}}""")
        b <- r.body.asString
      yield assertTrue(r.status == Status.BadRequest, b.contains(s"at most ${SpecRoutes.maxBlocks}"))
    ,
    test("a body larger than maxBody - 413"):
      for r <- post(" " * (SpecRoutes.maxBody + 1))
      yield assertTrue(r.status == Status.RequestEntityTooLarge)
    ,
    test("deeply nested JSON - 400, no stack overflow"):
      def nested(depth: Int) = """{"type":"section","body":[""" * depth + "]}" * depth
      def after(depth: Int)  = s"""{"before":$book,"after":{"title":"x","body":[${nested(depth)}]}}"""
      for
        // 35000 levels in under 1 MB: the parser of circe refuses it already
        veryDeep <- post(after(35000))
        v        <- veryDeep.body.asString
        // deeper than maxDepth, but not for the parser: refused before anything walks it
        deep     <- post(after(SpecRoutes.maxDepth))
        d        <- deep.body.asString
      yield assertTrue(
        veryDeep.status == Status.BadRequest,
        v.contains("max depth exceeded"),
        deep.status == Status.BadRequest,
        d.contains(s"deeper than ${SpecRoutes.maxDepth}")
      )
    ,
    test("the server reads no body above maxBody - also a chunked one; it answers afterwards"):
      import java.net.URI
      import java.net.http.{HttpClient, HttpRequest, HttpResponse}
      val client = HttpClient.newHttpClient()
      def request(port: Int, body: HttpRequest.BodyPublisher) =
        HttpRequest.newBuilder(URI.create(s"http://localhost:$port/spec/pages/diff")).POST(body).build()
      // without a known length the client sends it chunked
      val chunked = HttpRequest.BodyPublishers.ofInputStream(() =>
        java.io.ByteArrayInputStream(Array.fill(SpecRoutes.maxBody + 1024)(' '.toByte)))
      (for
        port   <- Server.install(SpecRoutes.routes)
        big    <- ZIO.attemptBlocking(client.send(request(port, chunked), HttpResponse.BodyHandlers.ofString()))
                    .map(_.statusCode()) // refused by the server before the handler: 413
        normal <- ZIO.attemptBlocking(client.send(
                    request(port, HttpRequest.BodyPublishers.ofString(s"""{"before":$book,"after":$edited}""")),
                    HttpResponse.BodyHandlers.ofString()))
      yield assertTrue(big == 413, normal.statusCode() == 200))
        .provide(Server.defaultWith(c => StudioServer.serverConfig(c.binding("localhost", 0))))
    ,
    test("bytes that are no UTF-8 - 400"):
      for
        r <- SpecRoutes.routes.runZIO(Request.post(URL(Path.decode("/spec/pages/diff")),
               Body.fromArray(Array[Byte]('{'.toByte, 0xC3.toByte, 0x28.toByte, '}'.toByte))))
        b <- r.body.asString
      yield assertTrue(r.status == Status.BadRequest, b.contains("no UTF-8"))
    ,
    test("umlauts count as bytes: a body of maxBody characters with umlauts is too large"):
      for r <- post("ä" * (SpecRoutes.maxBody / 2 + 1))
      yield assertTrue(r.status == Status.RequestEntityTooLarge)
    ,
    test("more diffs at once than maxParallel - all answered"):
      for rs <- ZIO.foreachPar(1 to SpecRoutes.maxParallel * 3)(_ => post(s"""{"before":$book,"after":$edited}"""))
      yield assertTrue(rs.forall(_.status == Status.Ok))
    ,
    test("a STUDIO_PORT that is no port - an error that names it"):
      val error = scala.util.Try(StudioConfig().withEnv(Map("STUDIO_PORT" -> "88a0"))).failed.toOption.map(_.getMessage)
      assertTrue(error.exists(_.contains("STUDIO_PORT")), StudioConfig().withEnv(Map("STUDIO_PORT" -> "9001")).port == 9001)
  )
