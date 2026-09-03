package orchescala.helper.dev.company.docs.site

import io.circe.{Json, JsonObject}
import io.circe.parser.parse
import io.circe.syntax.*

import scala.collection.mutable
import scala.util.matching.Regex

/** A company's `00-docs` (CONFIG.conf, VERSIONS.conf, the markdown in `src/docs`) -> the data
  * the documentation app (orch-doc, `04-orch-doc`) renders:
  *
  *   - `<out>/index.json`              list of companies (merged if it exists)
  *   - `<out>/<company>/docs.json`     everything the app renders
  *   - `<out>/<company>/pages/`        the hand-written pages (pattern, onboarding, …) as .md
  *   - `<out>/<company>/<dir>/`        images referenced by the pages
  *
  * The JSON is the contract with the app - `04-orch-doc/src/types.ts` describes it. This is the
  * Scala twin of orch-doc's `tools/docs2json.ts` (kept for the app's own development); both must
  * produce the same files.
  */
object DocsJson:

  case class Result(company: String, docsJson: os.Path, projects: Int, pages: Int)

  /** @param spec where orch-spec is deployed, relative to the site root - e.g. `spec/` */
  def write(docsDir: os.Path, out: os.Path, spec: Option[String] = Some("spec/"), companyOpt: Option[String] = None): Result =
    val src = docsDir / "src" / "docs"
    require(os.exists(src), s"no src/docs in $docsDir")
    def read(f: String): String =
      val p = src / os.RelPath(f)
      if os.exists(p) then os.read(p) else ""
    def readBase(f: String): String =
      val p = docsDir / f
      if os.exists(p) then os.read(p) else ""

    // ── CONFIG.conf ────────────────────────────────────────────────────────────
    val conf          = readBase("CONFIG.conf")
    def confStr(key: String): Option[String] =
      ("(?m)^\\s*" + Regex.quote(key) + "\\s*=\\s*\"([^\"]*)\"").r.findFirstMatchIn(conf).map(_.group(1))
    val releaseTag    = confStr("release.tag").getOrElse("unknown")
    val released      = "(?m)^\\s*released\\s*=\\s*true".r.findFirstIn(conf).isDefined
    val olderReleases = """releases\.older\s*=\s*\[([^\]]*)\]""".r.findFirstMatchIn(conf).map(_.group(1)).getOrElse("")
      .split(",").map(_.trim.replace("\"", "")).filter(_.nonEmpty).toSeq
    val notes         = """(?s)release\.notes\s*=\s*"{3}(.*?)"{3}""".r.findFirstMatchIn(conf).map(_.group(1).trim).getOrElse("")
    val respName      = """(?s)release\.responsible\s*\{[^}]*name\s*=\s*"([^"]*)"""".r.findFirstMatchIn(conf).map(_.group(1))
    val respDate      = """(?s)release\.responsible\s*\{[^}]*date\s*=\s*"([^"]*)"""".r.findFirstMatchIn(conf).map(_.group(1))
    val jiraUrl       = confStr("jira.release.url")

    // ── VERSIONS.conf: <camelProject>Version / <camelProject>WorkerVersion ─────
    val versions   = readBase("VERSIONS.conf")
    val versionMap = """(?m)^\s*(\w+)Version\s*=\s*"([^"]*)"""".r.findAllMatchIn(versions)
      .map(m => m.group(1) -> m.group(2)).toMap
    def camel(project: String) = project.split("-").zipWithIndex
      .map((p, i) => if i == 0 then p else p.head.toUpper.toString + p.tail).mkString

    // ── index.md: groups, projects, colors, graph ──────────────────────────────
    val index    = read("index.md")
    val repoName = (docsDir / os.up).last
    val company  = companyOpt.getOrElse:
      if repoName.endsWith("-orchescala") then repoName.stripSuffix("-orchescala")
      else "(?m)^# (\\w+)".r.findFirstMatchIn(index).map(_.group(1).toLowerCase).getOrElse(docsDir.last)
    val mdTitle  = "(?m)^# (.+)$".r.findFirstMatchIn(index).map(_.group(1).trim)
    // some repos carry a copy-pasted title of another company - then build our own
    val title    = mdTitle.filter(_.toLowerCase.contains(company))
      .getOrElse(s"${company.capitalize} Process Documentation")
    val createdDay = """created\.day\s*=\s*"([^"]*)"""".r.findFirstMatchIn(read("directory.conf")).map(_.group(1)).getOrElse("")

    val groupOrder   = mutable.ListBuffer.empty[(String, String)]
    val projectGroup = mutable.LinkedHashMap.empty[String, String]
    """(?s)subgraph (\S+)\s*\n(.*?)\n\s*end""".r.findAllMatchIn(index).foreach: m =>
      val group = m.group(1)
      val color = s"style ${Regex.quote(group)} fill:[^,]*,color:(\\w+)".r.findFirstMatchIn(index).map(_.group(1)).getOrElse("gray")
      groupOrder += group -> color
      """([\w-]+)\(""".r.findAllMatchIn(m.group(2)).foreach(p => projectGroup.getOrElseUpdate(p.group(1), group))
    val colors = """(?m)^\s*style ([\w-]+) fill:\s*(#[0-9a-fA-F]{3,6}|\w+)\s*$""".r.findAllMatchIn(index)
      .map(m => m.group(1) -> m.group(2)).toMap
    // direct edges: `a --> b & c` (only outside the subgraph blocks)
    val graph  = """(?m)^\s*([\w-]+) --> ([\w\- &]+)$""".r.findAllMatchIn(index).toSeq.flatMap: m =>
      m.group(2).split("&").map(_.trim).filter(_.nonEmpty).map(to => m.group(1) -> to)
    // flat list of "- **project:** [API Doc](..) - [Dependencies](..)" tells us who has a dependency page
    val hasDepPage = """\*\*([\w-]+):\*\*[^\n]*\[Dependencies\]""".r.findAllMatchIn(index).map(_.group(1)).toSet

    case class Project(name: String, group: String, color: String, version: Option[String],
        workerVersion: Option[String], apiDocUrl: String, external: Boolean, var hasDependencies: Boolean)
    val projects = mutable.ListBuffer.from(projectGroup.keys.map: name =>
      val external = !name.startsWith(company)
      Project(
        name, projectGroup(name), colors.getOrElse(name, "white"),
        versionMap.get(camel(name)).filter(_.nonEmpty),
        versionMap.get(camel(name) + "Worker").filter(_.nonEmpty),
        // API docs of other companies live in their own folder: ../../swisscom/<p>/OpenApi.html
        if external then s"../${name.split("-").head}/$name/OpenApi.html" else s"$name/OpenApi.html",
        external, hasDepPage(name)
      ))

    // ── dependencies/<project>.md ──────────────────────────────────────────────
    val depDir       = src / "dependencies"
    val dependencies = mutable.ListBuffer.empty[Json]
    if os.exists(depDir) then
      os.list(depDir).filter(_.ext == "md").sortBy(_.last).foreach: f =>
        val md = os.read(f)
        """(?m)^## ([\w-]+):([\w.]+)""".r.findFirstMatchIn(md).foreach: head =>
          val deps    = """(?s)-->\s*\n(.*?)\n\s*\n""".r.findFirstMatchIn(md).map(_.group(1)).getOrElse("")
          val preview = md.contains("Preview to the next Release")
          dependencies += Json.obj(
            "project" -> head.group(1).asJson,
            "version" -> head.group(2).asJson,
            "preview" -> (if preview then Json.True else Json.Null),
            "dependsOn" -> """([\w-]+):([\w.]+)""".r.findAllMatchIn(deps).toSeq
              .map(m => Json.obj("project" -> m.group(1).asJson, "version" -> m.group(2).asJson)).asJson
          )
          val name = head.group(1)
          if !projects.exists(_.name == name) then
            projects += Project(name, "projects", "white", None, None, s"$name/OpenApi.html", false, true)
          projects.find(_.name == name).foreach(_.hasDependencies = true)

    // ── release.md: two tables + notes per project ─────────────────────────────
    val release       = read("release.md")
    val releaseTables = """(?m)^## (Camunda|Worker) Dependencies\s*\n((?s:.*?))(?=\n\(\\\*\))""".r.findAllMatchIn(release).toSeq.map: m =>
      val lines   = m.group(2).trim.split("\n").filter(_.startsWith("|"))
      def cells(l: String) = l.drop(1).dropRight(1).split("\\|", -1).map(_.trim).toSeq
      val header  = cells(lines(0)).drop(3)
      val columns = header.map: h =>
        """\*\*([\w-]+)\*\*\s*([\w.]*)""".r.findFirstMatchIn(h) match
          case Some(c) => c.group(1) -> c.group(2)
          case None    => h -> ""
      val rows    = lines.drop(2).toSeq.map: l =>
        val c     = cells(l)
        val name  = c(0).replaceAll("[*\\[\\]_]", "")
        val stars = """\*+$""".r.findFirstIn(c(0)).map(_.length).getOrElse(0)
        val uses  = columns.zipWithIndex.collect:
          case ((project, _), i) if c.lift(3 + i).exists(_.nonEmpty) => project -> c(3 + i).asJson
        Json.obj(
          "project" -> name.asJson,
          "version" -> c(1).replaceAll("[*_]", "").asJson,
          "previousVersion" -> c(2).replaceAll("[*_]", "").asJson,
          "status" -> (if stars >= 4 then "patched" else if stars >= 3 then "new" else "unchanged").asJson,
          "uses" -> Json.fromJsonObject(JsonObject.fromIterable(uses))
        )
      Json.obj(
        "kind" -> (if m.group(1) == "Camunda" then "bpmn" else "worker").asJson,
        "title" -> s"${m.group(1)} Dependencies".asJson,
        "columns" -> columns.map((p, v) => Json.obj("project" -> p.asJson, "version" -> v.asJson)).asJson,
        "rows" -> rows.asJson
      )
    val notesPart    = release.split("(?m)^# Release Notes", 2).lift(1).getOrElse("")
    val releaseNotes = notesPart.split("(?m)^## ").drop(1).toSeq.flatMap: sec =>
      """^\[([\w-]+)\]\(([^)"]+)""".r.findFirstMatchIn(sec).map: h =>
        val groups = sec.split("(?m)^### ").drop(1).toSeq.flatMap: g =>
          val name    = g.split("\n", 2).head.trim
          val tickets = g.split("\n(?=\\*\\*)").drop(1).toSeq.flatMap: t =>
            val tm      = """^\*\*(?:\[([\w-]+)\]\(([^)]+)\)|([\w-]+))\*\*""".r.findFirstMatchIn(t)
            val entries = t.split("\n").filter(_.startsWith("- ")).map(_.drop(2).trim).toSeq
            Option.when(entries.nonEmpty):
              Json.obj(
                "ticket" -> tm.flatMap(x => Option(x.group(1)).orElse(Option(x.group(3)))).asJson,
                "url" -> tm.flatMap(x => Option(x.group(2))).asJson,
                "entries" -> entries.asJson
              )
          Option.when(tickets.nonEmpty)(Json.obj("name" -> name.asJson, "tickets" -> tickets.asJson))
        // `../../x` -> `../x`, `../x` -> `x` (like docs2json.ts)
        val prefix    = """^(\.\./)+""".r.findFirstIn(h.group(2)).getOrElse("")
        val apiDocUrl = (if prefix.length > 3 then "../" else "") + h.group(2).drop(prefix.length)
        Json.obj("project" -> h.group(1).asJson, "apiDocUrl" -> apiDocUrl.asJson, "groups" -> groups.asJson)

    // ── catalog.md ─────────────────────────────────────────────────────────────
    val kinds   = Set("Bpmn", "Worker", "Message", "Signal", "UserTask", "Dmn", "Timer")
    val catalog = read("catalog.md").split("(?m)^### ").drop(1).toSeq.map: sec =>
      val lines = sec.split("\n").toSeq
      val seen  = mutable.Set.empty[String]
      val entries = lines.drop(1).flatMap: l =>
        """^- \[(\w+): ([^\]]+)\]\(([^)]+)\)""".r.findFirstMatchIn(l).filter(m => seen.add(m.group(3))).map: m =>
          Json.obj(
            "kind" -> (if kinds(m.group(1)) then m.group(1) else "Other").asJson,
            "name" -> m.group(2).trim.asJson,
            "url" -> m.group(3).asJson
          )
      Json.obj("title" -> lines.head.trim.asJson, "entries" -> entries.asJson)

    // ── devStatistics.md ───────────────────────────────────────────────────────
    val devStats = read("devStatistics.md").split("(?m)^\\*{5,}$").toSeq.flatMap: sec =>
      """count for \*\*([^*]+)\*\* files""".r.findFirstMatchIn(sec).map: t =>
        val rows = """(?m)^\s*- ([\w-]+): (\d+) of (\d+) Files""".r.findAllMatchIn(sec).toSeq.map: m =>
          Json.obj("project" -> m.group(1).asJson, "lines" -> m.group(2).toInt.asJson, "files" -> m.group(3).toInt.asJson)
        val tot  = """\*\*Total\*\*[^*]*\*\*(\d+)\*\* of \*\*(\d+)\*\*""".r.findFirstMatchIn(sec)
        Json.obj(
          "title" -> t.group(1).asJson,
          "rows" -> rows.asJson,
          "total" -> Json.obj(
            "lines" -> tot.map(_.group(1).toInt).getOrElse(0).asJson,
            "files" -> tot.map(_.group(2).toInt).getOrElse(0).asJson
          )
        )

    // ── markdown pages ─────────────────────────────────────────────────────────
    val outCompany = out / company
    os.makeDir.all(outCompany / "pages")
    val pages = mutable.ListBuffer.empty[Json]
    def stripFrontMatter(md: String): String =
      val noFront = """(?ms)^\{%.*?%\}\s*""".r.replaceFirstIn(md, "")
      val callouts = """(?s)@:callout\((\w+)\)\s*(.*?)@:@""".r.replaceAllIn(noFront, m =>
        Regex.quoteReplacement(s"> **${m.group(1)}:** ${m.group(2).trim}\n"))
      val images   = """@:image\(([^)]+)\)\s*\{[^}]*\}""".r.replaceAllIn(callouts, m => Regex.quoteReplacement(s"![](${m.group(1).trim})"))
      images.replace("${release.tag}", releaseTag).replace("${created.day}", createdDay)
    def addPage(file: String, slug: String, section: Option[String]): Unit =
      val md = read(file)
      if md.nonEmpty then
        val t      = "(?m)^#{1,3} (.+)$".r.findFirstMatchIn(md).map(_.group(1).trim).getOrElse(slug)
        val target = s"pages/${slug.replace("/", "-")}.md"
        os.write.over(outCompany / os.RelPath(target), stripFrontMatter(md))
        pages += Json.obj("slug" -> slug.asJson, "title" -> t.asJson, "file" -> target.asJson, "section" -> section.asJson)
    addPage("pattern.md", "pattern", None)
    addPage("statistics.md", "statistics", None)
    addPage("contact.md", "contact", None)
    addPage("development/instructions.md", "development/instructions", Some("Development"))
    addPage("development/onboarding.md", "development/onboarding", Some("Development"))
    // images next to the pages (pattern/*.png)
    Seq("pattern", "development").map(src / _).filter(os.exists).foreach: dir =>
      os.list(dir).filter(f => f.ext.toLowerCase.matches("png|jpe?g|svg|gif")).foreach: f =>
        os.makeDir.all(outCompany / dir.last)
        os.copy.over(f, outCompany / dir.last / f.last)

    // ── write ──────────────────────────────────────────────────────────────────
    val docs = Json.obj(
      "company" -> company.asJson,
      "title" -> title.asJson,
      "release" -> Json.obj(
        "tag" -> releaseTag.asJson,
        "released" -> released.asJson,
        "createdDay" -> createdDay.asJson,
        "jiraUrl" -> jiraUrl.asJson,
        "notes" -> notes.asJson,
        "olderReleases" -> olderReleases.asJson,
        "approvedBy" -> respName.map(n => Json.obj("name" -> n.asJson, "date" -> respDate.getOrElse("").asJson)).asJson
      ),
      "groups" -> groupOrder.toSeq.map((n, c) => Json.obj("name" -> n.asJson, "color" -> c.asJson)).asJson,
      "projects" -> projects.toSeq.map(p => Json.obj(
        "name" -> p.name.asJson, "group" -> p.group.asJson, "color" -> p.color.asJson,
        "version" -> p.version.asJson, "workerVersion" -> p.workerVersion.asJson,
        "apiDocUrl" -> p.apiDocUrl.asJson,
        "external" -> (if p.external then Json.True else Json.Null),
        "hasDependencies" -> p.hasDependencies.asJson
      )).asJson,
      "graph" -> graph.map((f, t) => Json.obj("from" -> f.asJson, "to" -> t.asJson)).asJson,
      "dependencies" -> dependencies.toSeq.asJson,
      "releaseTables" -> releaseTables.asJson,
      "releaseNotes" -> releaseNotes.asJson,
      "catalog" -> catalog.asJson,
      "devStats" -> devStats.asJson,
      "pages" -> pages.toSeq.asJson
    )
    val docsJson = outCompany / "docs.json"
    os.write.over(docsJson, print(docs))

    // ── index.json: the list of companies ──────────────────────────────────────
    val indexPath = out / "index.json"
    val siteIndex = Option.when(os.exists(indexPath))(parse(os.read(indexPath)).toOption).flatten
      .flatMap(_.asObject).getOrElse(JsonObject(
        "title" -> "Process & Worker Catalogs".asJson,
        "companies" -> Json.arr(),
        "orchescalaUrl" -> "https://pme123.github.io/orchescala/".asJson
      ))
    // company logo: src/docs/logo.(svg|png), else the company's favicon.ico (the classic sites
    // used it as such) - always the current file, never a stale index.json entry
    val logoFile  = Seq("logo.svg", "logo.png", "favicon.ico").find(f => os.exists(src / f))
    logoFile.foreach(f => os.copy.over(src / f, outCompany / f))
    val companies = siteIndex("companies").flatMap(_.asArray).getOrElse(Vector.empty)
    val prev      = companies.find(_.hcursor.get[String]("id").toOption.contains(company))
    def prevStr(k: String) = prev.flatMap(_.hcursor.get[String](k).toOption)
    val ref       = Json.obj(
      "id" -> company.asJson,
      "name" -> prevStr("name").getOrElse(company.capitalize).asJson,
      "release" -> releaseTag.asJson,
      "logo" -> logoFile.map(f => s"$company/$f").asJson,
      "url" -> prevStr("url").asJson
    )
    val merged = (companies.filterNot(c => prev.contains(c)) :+ ref)
      .sortBy(_.hcursor.get[String]("id").getOrElse(""))
    val withSpec  = spec.fold(siteIndex)(s => siteIndex.add("specUrl", s.asJson))
    os.write.over(indexPath, print(Json.fromJsonObject(withSpec.add("companies", merged.asJson))))

    Result(company, docsJson, projects.size, pages.size)
  end write

  // like `JSON.stringify(x, null, 2)`: 2-space indent, no `null` for absent optionals
  private def print(json: Json): String = json.deepDropNullValues.spaces2

end DocsJson
