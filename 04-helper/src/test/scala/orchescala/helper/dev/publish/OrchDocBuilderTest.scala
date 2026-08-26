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

  private val valiantDocsPath = sys.env.get("VALIANT_DOCS_PATH")
    .map(os.Path(_))
    .getOrElse(os.Path("/Users/pme/dev-valiant/valiant-orchescala/00-docs"))

  test("buildPreview assembles the same layout /site has, in a fresh temp dir"):
    if !os.exists(orchDocPath) || !os.exists(valiantDocsPath) then
      println(s"Skipping: orch-doc ($orchDocPath) or 00-docs ($valiantDocsPath) not available")
    else
      val out = OrchDocBuilder(orchDocPath).buildPreview(Seq(valiantDocsPath))

      assert(os.exists(out / "index.html"), s"missing ${out / "index.html"}")
      assert(os.isDir(out / "assets"), s"missing ${out / "assets"}")
      assert(os.exists(out / "index.json"), s"missing ${out / "index.json"}")
      assert(os.exists(out / "valiant" / "docs.json"), s"missing ${out / "valiant" / "docs.json"}")

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

  private val gitTempPath = sys.env.get("GIT_TEMP_PATH")
    .map(os.Path(_))
    .getOrElse(os.Path("/Users/pme/git-temp"))
  private val catalogHtmlPath =
    valiantDocsPath / "site" / "valiant" / "catalog.html"

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
      OrchDocBuilder(orchDocPath).generateSpecCatalog(Seq(filIsPath), Some(catalogHtmlPath))

      val out  = orchSpecPath / "public" / "catalog.generated.json"
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
