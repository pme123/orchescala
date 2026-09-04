package orchescala.helper.dev.company.docs.site

import munit.FunSuite

/** The whole site from a real company `00-docs` and its project checkouts in git-temp - skipped if
  * they are not on this machine. No WebDAV involved.
  */
class SiteAssemblerTest extends FunSuite:

  private val docsPath = sys.env.get("COMPANY_DOCS_PATH")
    .map(os.Path(_))
    .getOrElse(os.Path("/Users/pme/dev-valiant/valiant-orchescala/00-docs"))
  private val gitTemp  = sys.env.get("GIT_TEMP_PATH")
    .map(os.Path(_))
    .getOrElse(os.Path("/Users/pme/git-temp"))

  test("the orch-doc jar ships the site app, the API page and the spec tools"):
    val files = os.read.lines(os.resource / "orch-doc-site" / "files.txt")
    assert(files.contains("index.html"), "site app index.html missing")
    assert(files.exists(_.startsWith("assets/")), "site app assets missing")
    assert(files.contains("spec/index.html"), "orch-spec missing")
    val page = os.read(os.resource / "OrchDocApi.html")
    assert(page.length > 500 * 1024, s"API page suspiciously small: ${page.length}")
    assert(!page.contains("""src="./assets/"""), "API page still references an assets/ folder")
    Seq("openapi2catalog.js", "domain2catalog.js", "site2catalog.js").foreach: t =>
      assert(os.read(os.resource / "orch-doc-tools" / t).nonEmpty, s"spec tool $t missing")

  test("assemble builds the layout /site has, in a fresh dir"):
    if !os.exists(docsPath) || !os.exists(gitTemp) then
      println(s"Skipping: company 00-docs ($docsPath) or git-temp ($gitTemp) not available")
    else
      val out = os.temp.dir(prefix = "site-test")
      SiteAssembler(Seq(docsPath), gitTemp, out).assemble()
      assert(os.exists(out / "index.html"), "no index.html")
      assert(os.isDir(out / "assets"), "no assets/")
      assert(os.exists(out / "index.json"), "no index.json")
      assert(os.exists(out / "spec" / "index.html"), "no spec/")
      val docs = os.list(out).filter(os.isDir).flatMap(d => Option.when(os.exists(d / "docs.json"))(d))
      assert(docs.nonEmpty, "no <company>/docs.json")
      val apiPages = docs.flatMap(d => os.walk(d).filter(_.last == "OpenApi.html"))
      assert(apiPages.nonEmpty, "no project OpenApi.html")
      assert(apiPages.forall(os.size(_) > 500 * 1024), "a project's OpenApi.html is not the single-file page")
      assert(apiPages.forall(p => os.exists(p / os.up / "OpenApi.yml")), "OpenApi.yml missing next to a page")

  test("LocalSiteServer serves an assembled site"):
    val site = os.temp.dir(prefix = "site-serve")
    os.write(site / "index.html", "<html><title>Orchescala</title></html>")
    os.write(site / "a" / "docs.json", """{"x":1}""", createFolders = true)
    // port 0: any free port - the test must not depend on what else runs on this machine
    val running = LocalSiteServer.start(site, 0).getOrElse(fail("could not start the server"))
    try
      val url   = running.url
      assert(url.matches("http://localhost:\\d+/"), url)
      val index = os.proc("curl", "--silent", "--max-time", "5", url).call().out.text()
      assert(index.contains("Orchescala"), index)
      val json  = os.proc("curl", "--silent", "--max-time", "5", s"${url}a/docs.json").call().out.text()
      assertEquals(json, """{"x":1}""")
      val code  = os.proc("curl", "--silent", "-o", "/dev/null", "-w", "%{http_code}", s"${url}nope.txt").call().out.text()
      assertEquals(code, "404")
    finally running.stop()

end SiteAssemblerTest
