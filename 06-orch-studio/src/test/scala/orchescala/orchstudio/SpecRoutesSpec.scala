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
  )
