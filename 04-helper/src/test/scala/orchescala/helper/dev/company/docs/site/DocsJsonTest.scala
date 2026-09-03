package orchescala.helper.dev.company.docs.site

import io.circe.Json
import io.circe.parser.parse
import munit.FunSuite

/** DocsJson is the Scala twin of orch-doc's `tools/docs2json.ts` - both must produce the same
  * files. Verified against a real company `00-docs` if one is on this machine (skipped otherwise).
  */
class DocsJsonTest extends FunSuite:

  private val docsPath = sys.env.get("COMPANY_DOCS_PATH")
    .map(os.Path(_))
    .getOrElse(os.Path("/Users/pme/dev-valiant/valiant-orchescala/00-docs"))
  // orchescala's own 04-orch-doc (the tests may run from the root or from 04-helper)
  private val orchDocPath =
    Iterator.iterate(os.pwd)(_ / os.up).take(4).map(_ / "04-orch-doc").find(os.exists)
      .getOrElse(os.pwd / "04-orch-doc")

  test("DocsJson writes docs.json, index.json and the pages"):
    if !os.exists(docsPath) then println(s"Skipping: no company 00-docs at $docsPath")
    else
      val out = os.temp.dir(prefix = "docs-json")
      val r   = DocsJson.write(docsPath, out)
      assert(os.exists(out / "index.json"), "no index.json")
      assert(os.exists(r.docsJson), s"no ${r.docsJson}")
      assert(r.projects > 0, "no projects")
      assert(r.pages > 0, "no pages")
      val docs = parse(os.read(r.docsJson)).toOption.get
      assertEquals(docs.hcursor.get[String]("company").toOption, Some(r.company))
      assert(docs.hcursor.downField("catalog").as[Seq[Json]].exists(_.nonEmpty), "no catalog")
      assert(docs.hcursor.downField("releaseTables").as[Seq[Json]].exists(_.nonEmpty), "no release tables")

  test("DocsJson produces the same data as orch-doc's tools/docs2json.ts"):
    val node = scala.util.Try(os.proc("node", "--version").call(check = false).exitCode == 0).getOrElse(false)
    if !os.exists(docsPath) || !os.exists(orchDocPath / "tools" / "docs2json.ts") || !node then
      println(s"Skipping: company 00-docs ($docsPath), 04-orch-doc ($orchDocPath) or Node.js not available")
    else
      val scalaOut = os.temp.dir(prefix = "docs-json-scala")
      val tsOut    = os.temp.dir(prefix = "docs-json-ts")
      val r        = DocsJson.write(docsPath, scalaOut)
      os.proc("node", "tools/docs2json.ts", docsPath.toString, "--out", tsOut.toString, "--spec", "spec/")
        .call(cwd = orchDocPath, stdout = os.Inherit, stderr = os.Inherit)
      def json(p: os.Path) = parse(os.read(p)).toOption.getOrElse(fail(s"not JSON: $p"))
      val scalaDocs = json(r.docsJson)
      val tsDocs    = json(tsOut / r.company / "docs.json")
      // compare per top-level key - a readable diff instead of one giant assert
      val keys      = (scalaDocs.asObject.get.keys ++ tsDocs.asObject.get.keys).toSeq.distinct
      keys.foreach: k =>
        val (s, t) = (scalaDocs.hcursor.downField(k).focus, tsDocs.hcursor.downField(k).focus)
        assert(s == t, s"docs.json differs in `$k`:\n  scala: ${s.map(_.noSpaces.take(600))}\n  ts:    ${t.map(_.noSpaces.take(600))}")
      assertEquals(json(scalaOut / "index.json"), json(tsOut / "index.json"), "index.json differs")
      val pages = os.list(scalaOut / r.company / "pages").map(_.last).sorted
      assertEquals(pages, os.list(tsOut / r.company / "pages").map(_.last).sorted, "pages differ")
      pages.foreach: p =>
        assertEquals(os.read(scalaOut / r.company / "pages" / p), os.read(tsOut / r.company / "pages" / p), s"page $p differs")

end DocsJsonTest
