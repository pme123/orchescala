package orchescala.helper.dev.company.docs.site

import munit.FunSuite

/** The whole site from a real company `00-docs` and its project checkouts in git-temp - skipped if
  * they are not on this machine. No WebDAV involved. The API of a project (writeApi) is tested on a
  * git-temp of its own (GitTempFixture), always.
  */
class SiteAssemblerTest extends FunSuite:
  import GitTempFixture.*

  // the 00-docs of a company-orchescala repo - only from COMPANY_DOCS_PATH, otherwise the test is
  // skipped: no fallback, so the outcome never depends on what lies in a home directory
  private val docsPath: Option[os.Path] = sys.env.get("COMPANY_DOCS_PATH").map(os.Path(_)).filter(os.exists)
  // the project checkouts - only used together with COMPANY_DOCS_PATH
  private val gitTemp = sys.env.get("GIT_TEMP_PATH")
    .map(os.Path(_))
    .getOrElse(os.home / "git-temp")

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

  test("clearAppAssets empties the apps' assets folders - and nothing else"):
    val out = os.temp.dir(prefix = "site-assets")
    os.write(out / "assets" / "index-OLD.js", "old", createFolders = true)
    os.write(out / "spec" / "assets" / "index-OLD.js", "old", createFolders = true)
    os.write(out / "spec" / "catalog.generated.json", "{}")
    os.write(out / "valiant" / "1.0" / "assets" / "classic.js", "keep", createFolders = true)
    SiteAssembler.clearAppAssets(out, Seq("index.html", "assets/index-NEW.js", "spec/index.html", "spec/assets/index-NEW.js"))
    assert(!os.exists(out / "assets"), "old assets/ still there")
    assert(!os.exists(out / "spec" / "assets"), "old spec/assets/ still there")
    assert(os.exists(out / "spec" / "catalog.generated.json"), "catalog removed")
    assert(os.exists(out / "valiant" / "1.0" / "assets" / "classic.js"), "classic site assets removed")

  test("writeProjectColors adds the colors to the catalog - keeps what is there, leaves out #fff"):
    val out = os.temp.dir(prefix = "spec-colors") / "spec" / "catalog.generated.json"
    os.write(out, """{"services": [{"id": "a"}]}""", createFolders = true)
    SpecCatalog.writeProjectColors(Seq("globex-cards" -> "#c8feda", "globex-services" -> "#fff"), out)
    val json = io.circe.parser.parse(os.read(out)).toOption.get.hcursor
    assertEquals(json.downField("projectColors").downField("globex-cards").as[String], Right("#c8feda"))
    assert(json.downField("projectColors").downField("globex-services").failed, "#fff is no color")
    assertEquals(json.downField("services").downN(0).downField("id").as[String], Right("a"))

  test("writeProjectColors creates the catalog if there is none (no Node.js)"):
    val out = os.temp.dir(prefix = "spec-colors") / "spec" / "catalog.generated.json"
    SpecCatalog.writeProjectColors(Seq("globex-cards" -> "#c8feda"), out)
    assert(os.read(out).contains("globex-cards"))

  test("assemble builds the layout /site has, in a fresh dir"):
    docsPath match
    case None                             => println("Skipping: COMPANY_DOCS_PATH not set (or not found)")
    case Some(_) if !os.exists(gitTemp)   => println(s"Skipping: git-temp ($gitTemp) not available")
    case Some(docsPath)                   =>
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
      // the search index: every operation, workers with their topic
      val search = docs.map(d => d / "search.json").filter(os.exists)
      assert(search.nonEmpty, "no <company>/search.json")
      val entries = search.flatMap(f => io.circe.parser.parse(os.read(f)).toOption.flatMap(_.asArray).getOrElse(Vector.empty))
      assert(entries.size > 50, s"only ${entries.size} search entries")
      assert(entries.exists(_.hcursor.get[String]("topic").toOption.exists(_.contains("."))), "no worker topic in the search index")
      assert(entries.forall(e => e.hcursor.get[String]("id").isRight && e.hcursor.get[String]("project").isRight), "entry without id/project")

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

  test("writeApi - the API of a project in a single repo, at its tag"):
    val gitTemp = singleRepoGitTemp()
    val repo    = gitTemp / "orchescala-acme"
    os.write(repo / "projects" / "acme-shop" / "03-api" / "PostmanOpenApi.yml", "postman\n", createFolders = true)
    git(repo, "add", ".")
    git(repo, "commit", "-q", "-m", "postman")
    git(repo, "tag", "acme-shop-v1.1.0")
    val shop   = ProjectRepo.locate(gitTemp, "acme-shop").get
    assertEquals(SiteAssembler.releaseRef(shop, "1.0.0"), Some("acme-shop-v1.0.0"))
    assertEquals(SiteAssembler.releaseRef(shop, "4.0.0"), None)
    val target = os.temp.dir(prefix = "site") / "acme" / "acme-shop"
    val yml    = SiteAssembler.writeApi(shop, "acme-shop-v1.0.0", target, "<html/>")
    assertEquals(yml.map(new String(_)), Some("version: 1.0.0\n"))
    assertEquals(os.read(target / "OpenApi.html"), "<html/>")
    assert(os.exists(target / "diagrams" / "shop.bpmn"))
    assert(!os.exists(target / "PostmanOpenApi.yml")) // not yet at 1.0.0
    SiteAssembler.writeApi(shop, "acme-shop-v1.1.0", target, "<html/>")
    assertEquals(os.read(target / "PostmanOpenApi.yml"), "postman\n")
    val cards = ProjectRepo.locate(gitTemp, "acme-new").get
    assertEquals(SiteAssembler.writeApi(cards, "acme-new-v0.1.0", os.temp.dir() / "x", "<html/>"), None) // no OpenApi.yml

  test("writeApi - a diagram with a non-ASCII name (git quotes it without -z)"):
    val gitTemp = singleRepoGitTemp()
    val repo    = gitTemp / "orchescala-acme"
    os.write(repo / "projects" / "acme-shop" / "src" / "main" / "resources" / "camunda" / "Prüfung.bpmn", "<bpmn ü/>")
    git(repo, "add", ".")
    git(repo, "commit", "-q", "-m", "umlaut")
    git(repo, "tag", "acme-shop-v1.2.0")
    val target = os.temp.dir(prefix = "site") / "acme" / "acme-shop"
    SiteAssembler.writeApi(ProjectRepo.locate(gitTemp, "acme-shop").get, "acme-shop-v1.2.0", target, "<html/>")
    assertEquals(os.read(target / "diagrams" / "Prüfung.bpmn"), "<bpmn ü/>")

  test("newestRef - an own clone at a tag: its default branch, not the checked-out tag"):
    val origin = singleRepoGitTemp() / "orchescala-acme"
    val clone  = os.temp.dir(prefix = "git-temp") / "orchescala-acme"
    os.proc("git", "clone", "-q", origin.toString, clone.toString).call(stdout = os.Pipe, stderr = os.Pipe)
    os.proc("git", "-C", clone.toString, "checkout", "-q", "acme-shop-v1.0.0").call(stdout = os.Pipe, stderr = os.Pipe)
    assertEquals(SiteAssembler.newestRef(ProjectRepo(clone, "", "orchescala-acme")), "origin/HEAD")
    // without a remote (a clone of its own making): HEAD
    assertEquals(SiteAssembler.newestRef(ProjectRepo(origin, "", "orchescala-acme")), "HEAD")
    // a remote without origin/HEAD (git init + remote add + fetch): its main branch
    val made   = os.temp.dir(prefix = "git-temp") / "made"
    os.makeDir.all(made)
    git(made, "init", "-q")
    git(made, "remote", "add", "origin", origin.toString)
    val branch = os.proc("git", "-C", origin.toString, "branch", "--show-current").call().out.text().trim
    git(made, "fetch", "-q", "origin", s"$branch:refs/remotes/origin/main")
    assertEquals(SiteAssembler.newestRef(ProjectRepo(made, "", "made")), "origin/main")

  test("writeApi - two diagrams of the same name: the first taken, said"):
    val gitTemp = singleRepoGitTemp()
    val repo    = gitTemp / "orchescala-acme"
    val camunda = repo / "projects" / "acme-shop" / "src" / "main" / "resources" / "camunda"
    os.write(camunda / "a" / "order.bpmn", "<bpmn a/>", createFolders = true)
    os.write(camunda / "b" / "order.bpmn", "<bpmn b/>", createFolders = true)
    git(repo, "add", ".")
    git(repo, "commit", "-q", "-m", "twice")
    git(repo, "tag", "acme-shop-v1.3.0")
    val target  = os.temp.dir(prefix = "site") / "acme" / "acme-shop"
    val out     = java.io.ByteArrayOutputStream()
    Console.withOut(out)(SiteAssembler.writeApi(ProjectRepo.locate(gitTemp, "acme-shop").get, "acme-shop-v1.3.0", target, "<html/>"))
    assertEquals(os.read(target / "diagrams" / "order.bpmn"), "<bpmn a/>")
    assert(out.toString.contains("2 diagrams named order.bpmn"), out.toString)

  test("writeApi - the same diagram for both engines: camunda8's, as before, without a warning"):
    val gitTemp = singleRepoGitTemp()
    val repo    = gitTemp / "orchescala-acme"
    val main    = repo / "projects" / "acme-shop" / "src" / "main" / "resources"
    os.write(main / "camunda" / "pay.bpmn", "<bpmn c7/>", createFolders = true)
    os.write(main / "camunda8" / "pay.bpmn", "<bpmn c8/>", createFolders = true)
    git(repo, "add", ".")
    git(repo, "commit", "-q", "-m", "both engines")
    git(repo, "tag", "acme-shop-v1.4.0")
    val target  = os.temp.dir(prefix = "site") / "acme" / "acme-shop"
    val out     = java.io.ByteArrayOutputStream()
    Console.withOut(out)(SiteAssembler.writeApi(ProjectRepo.locate(gitTemp, "acme-shop").get, "acme-shop-v1.4.0", target, "<html/>"))
    assertEquals(os.read(target / "diagrams" / "pay.bpmn"), "<bpmn c8/>")
    assert(!out.toString.contains("diagrams named pay.bpmn"), out.toString)

end SiteAssemblerTest
