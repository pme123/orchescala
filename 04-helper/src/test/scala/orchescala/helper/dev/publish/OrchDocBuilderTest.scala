package orchescala.helper.dev.publish

import munit.FunSuite

/** Local, offline verification of the orch-doc build layout that ProjectWebDAV.upload() relies
  * on - no WebDAV server involved. Skips if no orch-doc checkout is configured on this machine.
  */
class OrchDocBuilderTest extends FunSuite:

  private val orchDocPath = sys.env.get("ORCH_DOC_PATH")
    .map(os.Path(_))
    .getOrElse(os.Path("/Users/pme/dev/Github/z9nai/orch-doc"))

  test("orch-doc's dist/ has the standalone API page layout ProjectWebDAV expects"):
    if !os.exists(orchDocPath) then
      println(s"Skipping: no orch-doc checkout at $orchDocPath")
    else
      val distDir = OrchDocBuilder(orchDocPath).build()

      assert(os.exists(distDir / "api.html"), s"missing ${distDir / "api.html"}")
      assert(os.isDir(distDir / "assets"), s"missing ${distDir / "assets"}")
      assert(os.exists(distDir / "favicon.png"), s"missing ${distDir / "favicon.png"}")

      val apiHtml = os.read(distDir / "api.html")
      assert(
        apiHtml.contains("""src="./assets/""") || apiHtml.contains("""href="./assets/"""),
        s"api.html does not reference assets/ with a relative path:\n$apiHtml"
      )
      assert(
        apiHtml.contains("""href="favicon.png""""),
        s"api.html does not reference favicon.png with a relative path:\n$apiHtml"
      )

  // what a project ships as 03-api/OpenApi.html + PostmanOpenApi.html (ApiGenerator) and uploads
  // as is (ProjectWebDAV): one file, nothing loaded from an assets/ folder next to it
  test("buildSingleFile produces one self-contained html"):
    if !os.exists(orchDocPath) then
      println(s"Skipping: no orch-doc checkout at $orchDocPath")
    else
      val html = OrchDocBuilder(orchDocPath).buildSingleFile()
      assertEquals(html.last, "api.html")
      val content = os.read(html)
      assert(os.size(html) > 500 * 1024, s"suspiciously small: ${os.size(html)} bytes")
      assert(!content.contains("""src="./assets/"""), "still references an assets/ folder")
      assert(!content.contains("""href="./assets/"""), "still references an assets/ folder")
      assert(content.contains("data:image/png"), "favicon not inlined")

  private val valiantDocsPath = sys.env.get("VALIANT_DOCS_PATH")
    .map(os.Path(_))
    .getOrElse(os.Path("/Users/pme/dev-valiant/valiant-orchescala/00-docs"))

  test("buildSite assembles the layout /site has into the given dir"):
    if !os.exists(orchDocPath) || !os.exists(valiantDocsPath) then
      println(s"Skipping: orch-doc ($orchDocPath) or 00-docs ($valiantDocsPath) not available")
    else
      // a temp dir, never the real 00-docs/site
      val out = OrchDocBuilder(orchDocPath).buildSite(Seq(valiantDocsPath), os.temp.dir(prefix = "site-test"))

      assert(os.exists(out / "index.html"), s"missing ${out / "index.html"}")
      assert(os.isDir(out / "assets"), s"missing ${out / "assets"}")
      assert(os.exists(out / "index.json"), s"missing ${out / "index.json"}")
      assert(os.exists(out / "valiant" / "docs.json"), s"missing ${out / "valiant" / "docs.json"}")
      // every project API gets the single-file page - there is no Redoc shell any more
      val apiHtml = os.walk(out / "valiant").filter(_.last == "OpenApi.html")
      assert(apiHtml.nonEmpty, "no project OpenApi.html in the site")
      assert(apiHtml.forall(os.size(_) > 500 * 1024), "a project's OpenApi.html is not the single-file page")

  test("serveLocally starts a background server that actually answers"):
    if !os.exists(orchDocPath) || !os.exists(valiantDocsPath) then
      println(s"Skipping: orch-doc ($orchDocPath) or 00-docs ($valiantDocsPath) not available")
    else
      val port = 34041 // dedicated test port - never the real 3004
      val url  = OrchDocBuilder(orchDocPath).serveLocally(Seq(valiantDocsPath), port)
      try
        assertEquals(url, s"http://localhost:$port/")
        val body = os.proc("curl", "--silent", "--max-time", "5", url).call().out.text()
        assert(body.contains("Orchescala"), body)
      finally
        os.proc("lsof", "-ti", s"tcp:$port").call().out.lines()
          .foreach(pid => os.proc("kill", pid).call())

  // The server outlives the JVM on purpose, so every prepareDocs run finds the previous one on
  // the port. serveLocally must replace our own old server instead of dying with EADDRINUSE.
  test("serveLocally replaces its own previous server on the port"):
    if !os.exists(orchDocPath) || !os.exists(valiantDocsPath) then
      println(s"Skipping: orch-doc ($orchDocPath) or 00-docs ($valiantDocsPath) not available")
    else
      val port     = 34043
      def pidsOn   = os.proc("lsof", "-ti", s"tcp:$port", "-sTCP:LISTEN").call(check = false)
        .out.lines().map(_.trim).filter(_.nonEmpty)
      val oldLog   = os.temp(prefix = "old-preview-", suffix = ".log")
      os.proc("node", "tools/assemble.ts", valiantDocsPath.toString, "--out", "dist-site",
        "--serve", port.toString).spawn(cwd = orchDocPath, stdout = oldLog, stderr = oldLog)
      val deadline = System.currentTimeMillis() + 60000
      while pidsOn.isEmpty && System.currentTimeMillis() < deadline do Thread.sleep(500)
      val oldPid   = pidsOn.headOption
      assert(oldPid.nonEmpty, s"old server never listened:\n${os.read(oldLog)}")
      try
        OrchDocBuilder(orchDocPath).serveLocally(Seq(valiantDocsPath), port)
        val newPids = pidsOn
        assert(newPids.nonEmpty, "no server listening after serveLocally")
        assert(!newPids.contains(oldPid.get), s"old server ${oldPid.get} still listening")
        val body = os.proc("curl", "--silent", "--max-time", "5", s"http://localhost:$port/")
          .call().out.text()
        assert(body.contains("Orchescala"), body)
      finally
        pidsOn.foreach(pid => os.proc("kill", pid).call(check = false))

  private val gitTempPath = sys.env.get("GIT_TEMP_PATH")
    .map(os.Path(_))
    .getOrElse(os.Path("/Users/pme/git-temp"))
  // the generated catalog.md - the call activities for orch-spec come from its links
  private val catalogMdPath =
    valiantDocsPath / "src" / "docs" / "catalog.md"

  test("generateSpecCatalog takes an explicit project list, not a directory scan"):
    val orchSpecPath  = orchDocPath / os.up / "orch-spec"
    val filIsPath     = gitTempPath / "valiant-fil-is"
    if !os.exists(orchDocPath) || !os.exists(orchSpecPath) || !os.exists(filIsPath) then
      println(
        s"Skipping: orch-doc ($orchDocPath), orch-spec ($orchSpecPath) or valiant-fil-is ($filIsPath) not available"
      )
    else
      // only ONE explicit project dir, not the whole git-temp - proves generateSpecCatalog works
      // off a caller-supplied list (DocCreator.ownProjectDirs), not an implicit directory walk
      // that would also pick up sibling companies / orphaned checkouts.
      // Written to a temp path: the default target is orch-spec's REAL public/catalog.generated.json,
      // and a single-project test catalog must never overwrite the shipped one. The path must not
      // exist yet - the tools read an existing --out as JSON, and an empty file is not JSON.
      val out = os.temp.dir(prefix = "catalog-test") / "catalog.json"
      OrchDocBuilder(orchDocPath)
        .generateSpecCatalog(Seq(filIsPath), Some(catalogMdPath), outFile = Some(out))

      assert(os.exists(out), s"missing $out")
      val json = os.read(out)
      assert(json.contains(""""services": ["""), s"no services in catalog.generated.json:\n$json")
      assert(
        json.contains(""""domainTypes": ["""),
        s"no domainTypes in catalog.generated.json:\n$json"
      )
      // domain2catalog reads the Scala sources directly - catches classes openapi2catalog
      // misses (e.g. valiant-fil-is's domain module has no operations in its OpenApi.yml)
      assert(
        json.contains(""""pkg": "valiant.fil.is."""),
        s"missing valiant-fil-is domain classes in catalog.generated.json"
      )
end OrchDocBuilderTest
