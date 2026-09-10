package orchescala.helper.dev.company.docs.site

import io.circe.parser.parse

/** Assembles the complete documentation site of one or more companies into `out` - the layout the
  * WebDAV server (`/site`) and the company gateway serve:
  *
  *   - `index.html` + `assets/`, `spec/`         the documentation app and orch-spec - from the
  *                                                orchescala-orch-doc jar (`orch-doc-site/`)
  *   - `index.json`, `<company>/docs.json`, `<company>/pages/`   DocsJson, per company
  *   - `<company>/<project>/OpenApi.html|yml` (+ `PostmanOpenApi.*`) + `diagrams/`
  *                                                the referenced APIs, taken from the project
  *                                                checkouts in gitTemp at the version defined in
  *                                                VERSIONS.conf (`git show v<version>:…` - the
  *                                                working trees stay untouched)
  *   - `<company>/<tag>/`                         the classic static sites of older releases,
  *                                                copied from `<00-docs>/site/<company>/<tag>`
  *   - `spec/catalog.generated.json`              the spec catalog (SpecCatalog, if Node.js is there)
  *
  * `out` may be a company's own `00-docs/site` (publishDocs builds in place) - what is already
  * there is written over, the older releases are then simply found in place. The Scala twin of
  * orch-doc's `tools/assemble.ts` (kept for the app's own development).
  */
case class SiteAssembler(docsDirs: Seq[os.Path], gitTemp: os.Path, out: os.Path):

  def assemble(projectDirsForCatalog: Seq[os.Path] = Seq.empty, catalogMd: Option[os.Path] = None): os.Path =
    os.makeDir.all(out)
    // ── 1. markdown sources -> site data ──────────────────────────────────────
    docsDirs.foreach: d =>
      val r = DocsJson.write(d, out)
      println(s"  ${r.company} -> ${r.docsJson}: ${r.projects} projects · ${r.pages} pages")
    val companies = parse(os.read(out / "index.json")).toOption
      .flatMap(_.hcursor.downField("companies").as[Seq[io.circe.Json]].toOption).getOrElse(Seq.empty)
      .flatMap(_.hcursor.get[String]("id").toOption)
    // ── 2. referenced APIs at the defined versions ────────────────────────────
    var apiOk = 0; var apiHead = 0; var apiMissing = 0
    // the search index (`<company>/search.json`): every operation of every API - a project listed
    // by two companies (swisscom-fil-is in valiant's docs) is indexed once, under its own company
    val searchEntries = scala.collection.mutable.LinkedHashMap.empty[String, io.circe.Json]
    companies.foreach: co =>
      val docs     = parse(os.read(out / co / "docs.json")).toOption.get
      val projects = docs.hcursor.downField("projects").as[Seq[io.circe.Json]].getOrElse(Seq.empty)
      projects.foreach: p =>
        val name          = p.hcursor.get[String]("name").getOrElse("")
        val apiDocUrl     = p.hcursor.get[String]("apiDocUrl").getOrElse("")
        val version       = p.hcursor.get[String]("version").toOption
        val workerVersion = p.hcursor.get[String]("workerVersion").toOption
        val repo          = gitTemp / name
        val targetCo      = """^\.\./([\w-]+)/""".r.findFirstMatchIn(apiDocUrl).map(_.group(1)).getOrElse(co)
        val target        = out / targetCo / name
        if !os.exists(repo) then
          println(s"  ✗ $name: no checkout in $gitTemp - API skipped")
          apiMissing += 1
        else
          // bpmn and worker are released separately - the API doc is the NEWEST of the two
          val newest = Seq(version, workerVersion).flatten.sortWith(cmpVersion(_, _) < 0).lastOption
          var ref    = newest.map("v" + _).getOrElse("HEAD")
          if ref != "HEAD" && git(repo, "rev-parse", "-q", "--verify", s"$ref^{commit}").isEmpty then
            println(s"  ! $name: tag $ref not found - using HEAD")
            ref = "HEAD"
          // old-style projects (pre 03-api) keep openApi.yml in the repo root
          val ymlPath = Seq("03-api/OpenApi.yml", "openApi.yml", "OpenApi.yml")
            .find(f => git(repo, "cat-file", "-e", s"$ref:$f").isDefined)
          ymlPath.flatMap(f => git(repo, "show", s"$ref:$f")) match
            case None      =>
              println(s"  ✗ $name: no OpenApi.yml at $ref")
              apiMissing += 1
            case Some(yml) =>
              os.makeDir.all(target / "diagrams")
              os.write.over(target / "OpenApi.yml", yml)
              SiteAssembler.searchEntries(targetCo, name, new String(yml, java.nio.charset.StandardCharsets.UTF_8))
                .foreach(e => searchEntries.getOrElseUpdate(s"$targetCo/$name/${e.hcursor.get[String]("id").getOrElse("")}", e))
              // the API page: always the CURRENT one from the jar, not what the project shipped at that tag
              os.write.over(target / "OpenApi.html", apiPage)
              // the company gateway's Postman variant (only projects generated with that config have it)
              git(repo, "show", s"$ref:03-api/PostmanOpenApi.yml").foreach: postman =>
                os.write.over(target / "PostmanOpenApi.yml", postman)
                os.write.over(target / "PostmanOpenApi.html", apiPage)
              Seq("src/main/resources/camunda", "src/main/resources/camunda8").foreach: dia =>
                git(repo, "ls-tree", "-r", "--name-only", ref, "--", dia).map(new String(_).trim).filter(_.nonEmpty)
                  .foreach: ls =>
                    ls.split("\n").filter(_.matches(".*\\.(bpmn|dmn)$")).foreach: f =>
                      git(repo, "show", s"$ref:$f").foreach(b => os.write.over(target / "diagrams" / f.split("/").last, b))
              println(s"  ✓ $name @ $ref")
              if ref == "HEAD" && newest.isDefined then apiHead += 1 else apiOk += 1
    searchEntries.values.groupBy(_.hcursor.get[String]("company").getOrElse("")).foreach: (co, entries) =>
      os.write.over(out / co / "search.json", io.circe.Json.arr(entries.toSeq*).spaces2, createFolders = true)
      println(s"  ✓ search index $co: ${entries.size} operations")
    // ── 3. older releases (classic static sites) ──────────────────────────────
    companies.foreach: co =>
      val docs  = parse(os.read(out / co / "docs.json")).toOption.get
      val older = docs.hcursor.downField("release").downField("olderReleases").as[Seq[String]].getOrElse(Seq.empty)
      older.foreach: tag =>
        val dest = out / co / tag
        docsDirs.map(_ / "site" / co / tag).find(os.exists).foreach: src =>
          if src == dest then println(s"  ✓ classic site $co/$tag (in place)")
          else
            os.copy.over(src, dest, createFolders = true)
            println(s"  ✓ classic site $co/$tag")
    // ── 4. the apps from the jar ──────────────────────────────────────────────
    SiteAssembler.copySiteApp(out)
    // ── 5. the spec catalog ───────────────────────────────────────────────────
    if projectDirsForCatalog.nonEmpty then
      SpecCatalog.generate(projectDirsForCatalog, catalogMd, out / "spec" / "catalog.generated.json")
    println(s"\nSite assembled in $out")
    println(s"  APIs: $apiOk at their defined version · $apiHead on HEAD (tag missing) · $apiMissing skipped")
    out
  end assemble

  private lazy val apiPage: String = os.read(os.resource / "OrchDocApi.html")

  private def git(repo: os.Path, args: String*): Option[Array[Byte]] =
    val r = os.proc("git", "-C", repo.toString, args).call(check = false, stderr = os.Pipe)
    Option.when(r.exitCode == 0)(r.out.bytes)

  private def cmpVersion(a: String, b: String): Int =
    val pa = a.split("\\.").map(_.toIntOption.getOrElse(0)); val pb = b.split("\\.").map(_.toIntOption.getOrElse(0))
    (0 until math.max(pa.length, pb.length)).iterator
      .map(i => pa.lift(i).getOrElse(0) - pb.lift(i).getOrElse(0)).find(_ != 0).getOrElse(0)

end SiteAssembler

object SiteAssembler:

  /** The documentation app incl. orch-spec (`orch-doc-site/` in the orchescala-orch-doc jar) into
    * `out` - by the index `files.txt` the build writes, since a jar cannot be listed.
    */
  def copySiteApp(out: os.Path): Unit =
    val base  = os.resource / "orch-doc-site"
    val files = os.read.lines(base / "files.txt").filter(_.nonEmpty)
    files.foreach: rel =>
      val target = out / os.RelPath(rel)
      os.makeDir.all(target / os.up)
      os.write.over(target, os.read.bytes(base / os.RelPath(rel)))
    println(s"  ✓ documentation app (${files.size} files) from the orchescala-orch-doc jar")
  end copySiteApp

  /** The search index entries of one project API (see orch-doc `types.ts` SearchEntry): every
    * operation with its path - for workers `/worker/<topic>`, the topic being unique across all
    * projects, which is what people search for. The `id` is what the API view selects: the
    * operationId, qualified with its tag when the id repeats within the project (`Process start`
    * of several processes) - the same rule the app uses.
    */
  def searchEntries(company: String, project: String, yml: String): Seq[io.circe.Json] =
    import io.circe.syntax.*
    import scala.jdk.CollectionConverters.*
    val parsed = scala.util.Try(io.swagger.v3.parser.OpenAPIV3Parser().readContents(yml, null, null)).toOption
    val paths  = parsed.flatMap(p => Option(p.getOpenAPI)).flatMap(o => Option(o.getPaths)).map(_.asScala.toSeq).getOrElse(Seq.empty)
    val ops    = paths.flatMap: (path, item) =>
      item.readOperationsMap().asScala.values.toSeq.map: op =>
        val operationId = Option(op.getOperationId).getOrElse(path)
        val tag         = Option(op.getTags).map(_.asScala).flatMap(_.headOption).getOrElse("General")
        (path, operationId, tag, Option(op.getSummary))
    val counts = ops.groupBy(_._2).view.mapValues(_.size).toMap
    ops.map: (path, operationId, tag, summary) =>
      val topic = Option.when(path.startsWith("/worker/"))(path.stripPrefix("/worker/")).filter(_.nonEmpty)
      io.circe.Json.obj(
        "company" -> company.asJson,
        "project" -> project.asJson,
        "id" -> (if counts(operationId) > 1 then s"$tag · $operationId" else operationId).asJson,
        "operationId" -> operationId.asJson,
        "tag" -> tag.asJson,
        "path" -> path.asJson,
        "topic" -> topic.asJson,
        "summary" -> summary.asJson
      ).deepDropNullValues
  end searchEntries

end SiteAssembler
