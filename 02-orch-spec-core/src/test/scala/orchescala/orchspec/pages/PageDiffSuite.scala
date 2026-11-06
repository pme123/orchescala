package orchescala.orchspec.pages

import io.circe.parser.parse
import orchescala.orchspec.OrchSpecCore

/** The cases of `pageDiff` in orch-spec (tests/aiPages.test.ts) - the pages are what its tools made,
  * the expected JSON is what the TypeScript `pageDiff` answered before it moved here. Runs on the JVM
  * and on Scala.js.
  */
class PageDiffSuite extends munit.FunSuite:

  private val book =
    """{"path":"shop/book","title":"Termin buchen","access":"public","state":{"contact":{}},"body":[{"type":"heading","text":"Termin buchen"},{"type":"section","label":"Kontakt","body":[{"type":"fields","fields":[{"bind":"contact.name","label":"Name","required":true}]}]},{"type":"button","label":"Buchen","actions":[]}]}"""

  private def diff(after: String) = OrchSpecCore.pageDiff(book, after)

  test("the same page - no differences"):
    assertEquals(diff(book), Right("[]"))

  test("new field, changed block, moved, added, page title"):
    val edited =
      """{"path":"shop/book","title":"Beratung buchen","access":"public","state":{"contact":{}},"body":[{"type":"button","label":"Buchen","actions":[]},{"type":"heading","text":"Termin buchen"},{"type":"text","text":"Hinweis","id":"b-d812b1f182"},{"type":"section","label":"Kontakt","body":[{"type":"fields","fields":[{"bind":"contact.name","label":"Name","required":true},{"bind":"contact.branch","label":"Filiale"}]}]}]}"""
    assertEquals(
      diff(edited),
      Right(
        """[{"kind":"page","label":"Titel","detail":"«Termin buchen» → «Beratung buchen»"},{"kind":"moved","key":"0","label":"Button «Buchen»","detail":"von 2"},{"kind":"added","key":"2","label":"Text «Hinweis»"},{"kind":"changed","key":"3.0","label":"Eingabefelder","detail":"«Filiale» neu"}]"""
      )
    )

  test("removed block"):
    val removed =
      """{"path":"shop/book","title":"Termin buchen","access":"public","state":{"contact":{}},"body":[{"type":"heading","text":"Termin buchen"},{"type":"section","label":"Kontakt","body":[{"type":"fields","fields":[{"bind":"contact.name","label":"Name","required":true}]}]}]}"""
    assertEquals(diff(removed), Right("""[{"kind":"removed","key":"2","label":"Button «Buchen»"}]"""))

  test("a new label after an insert before it: the only button changed - not one new and one removed"):
    val relabeled =
      """{"path":"shop/book","title":"Termin buchen","access":"public","state":{"contact":{}},"body":[{"type":"heading","text":"Termin buchen"},{"type":"section","label":"Kontakt","body":[{"type":"fields","fields":[{"bind":"contact.name","label":"Name","required":true}]}]},{"type":"text","text":"Datenschutz","id":"b-80b60e8f1d"},{"type":"button","label":"Verbindlich anfragen","actions":[]}]}"""
    assertEquals(
      diff(relabeled),
      Right("""[{"kind":"added","key":"2","label":"Text «Datenschutz»"},{"kind":"changed","key":"3","label":"Button «Verbindlich anfragen»"}]""")
    )

  test("changed keys - new, changed and moved blocks of the draft"):
    val changes = Seq(
      PageChange(PageChange.Kind.page, None, "Titel", None),
      PageChange(PageChange.Kind.moved, Some("0"), "Button «Buchen»", Some("von 2")),
      PageChange(PageChange.Kind.changed, Some("3.0"), "Eingabefelder", None),
      PageChange(PageChange.Kind.removed, Some("2"), "Text", None)
    )
    assertEquals(PageDiff.changedKeys(changes), Set("0", "3.0"))

  test("a hand-edited page: no body, a body that is no list, a block that is no object"):
    val odd = parse("""{"title":"x","body":[42,{"type":"text","text":"Hallo"}]}""").toOption.get
    assertEquals(
      PageDiff(parse("""{"title":"x","body":"kaputt"}""").toOption.get, odd).map(c => (c.kind, c.key, c.label)),
      Vector((PageChange.Kind.added, Some("1"), "Text «Hallo»"))
    )

  test("JSON that cannot be read - the reason"):
    assert(OrchSpecCore.pageDiff("{", book).left.exists(_.startsWith("before is no JSON")))

  // edge cases - the expected JSON is what the TypeScript pageDiff of orch-spec (develop, before it
  // moved here) answered for the same pages
  private def page(body: String) = s"""{"path":"p","title":"T","access":"public","body":[$body]}"""
  private val a  = """{"type":"text","text":"A"}"""
  private val b  = """{"type":"text","text":"B"}"""
  private val go = """{"type":"button","label":"Go","actions":[]}"""

  private val edgeCases = Seq(
    ("empty pages", page(""), page(""), "[]"),
    ("all new", page(""), page(s"$a,$go"),
      """[{"kind":"added","key":"0","label":"Text «A»"},{"kind":"added","key":"1","label":"Button «Go»"}]"""),
    ("all removed", page(s"$a,$go"), page(""),
      """[{"kind":"removed","key":"0","label":"Text «A»"},{"kind":"removed","key":"1","label":"Button «Go»"}]"""),
    ("all moved - the order reversed", page(s"$a,$b,$go"), page(s"$go,$b,$a"),
      """[{"kind":"moved","key":"1","label":"Text «B»","detail":"von 1"},{"kind":"moved","key":"2","label":"Text «A»","detail":"von 0"}]"""),
    ("the same block twice", page(s"$a,$a,$go"), page(s"$go,$a,$a"),
      """[{"kind":"moved","key":"0","label":"Button «Go»","detail":"von 2"}]"""),
    ("one of two same blocks changed", page(s"$a,$a"), page(s"""$a,{"type":"text","text":"A","tone":"muted"}"""),
      """[{"kind":"changed","key":"1","label":"Text «A»"}]"""),
    ("a new block in a section - the section itself unchanged",
      page(s"""{"type":"section","label":"S","body":[$a]}"""), page(s"""{"type":"section","label":"S","body":[$a,$b]}"""),
      """[{"kind":"added","key":"0.1","label":"Text «B»"}]""")
  )

  edgeCases.foreach: (name, before, after, expected) =>
    test(s"edge case: $name"):
      assertEquals(OrchSpecCore.pageDiff(before, after), Right(expected))

  test("keys in another order: the block changed, the state a change of the page - as the TypeScript pageDiff"):
    assertEquals(
      OrchSpecCore.pageDiff(
        """{"path":"p","title":"T","access":"public","state":{"a":1,"b":2},"body":[{"type":"text","text":"A"},{"type":"button","label":"Go","actions":[]}]}""",
        """{"path":"p","title":"T","access":"public","state":{"b":2,"a":1},"body":[{"text":"A","type":"text"},{"type":"button","label":"Go","actions":[]}]}"""
      ),
      Right("""[{"kind":"page","label":"Anfangszustand"},{"kind":"changed","key":"0","label":"Text «A»"}]""")
    )

  test("a value that is no object keeps its index - also before a section and inside one"):
    val body = parse("""[{"type":"text","text":"A"},42,{"type":"section","body":["x",{"type":"text","text":"B"}]}]""").toOption
    assertEquals(Blocks.flatten(body).map(b => (b.key, b.depth)), Vector(("0", 0), ("2", 0), ("2.1", 1)))

  test("sections nested 5000 deep - no stack overflow"):
    import io.circe.Json
    val deep = (1 to 5000).foldLeft(Json.arr()): (body, _) =>
      Json.arr(Json.obj("type" -> Json.fromString("section"), "body" -> body))
    val blocks = Blocks.flatten(Some(deep))
    assertEquals(blocks.size, 5000)
    assertEquals(blocks.last.depth, 4999)
    assertEquals(blocks.take(3).map(_.key), Vector("0", "0.0", "0.0.0"))

end PageDiffSuite
