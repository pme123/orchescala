package orchescala.helper.dev.company.docs.site

/** The catalog of orch-spec (`spec/catalog.generated.json` in the site): services from the
  * projects' OpenAPI operations, domain classes read straight from the Scala sources and the
  * call activities from the company's `catalog.md`.
  *
  * The generators are orch-spec's own tools (`04-orch-spec/tools`), bundled as standalone Node
  * scripts into the orchescala-orch-doc jar (`orch-doc-tools/`) - run here with Node.js if it is
  * installed. Without Node.js the catalog is skipped (orch-spec works without it, with what it
  * knows from its own sources); the site does not depend on it.
  */
object SpecCatalog:

  private val tools = Seq("openapi2catalog.js", "domain2catalog.js", "site2catalog.js")

  def hasNode: Boolean =
    scala.util.Try(os.proc("node", "--version").call(check = false, stderr = os.Pipe).exitCode == 0).getOrElse(false)

  /** @param sourceDirs the project checkouts (services + domain classes)
    * @param catalogMd  the company's generated `catalog.md` (call activities), if it exists
    * @param outFile    `<site>/spec/catalog.generated.json` - replaced, never merged with an old one
    */
  def generate(sourceDirs: Seq[os.Path], catalogMd: Option[os.Path], outFile: os.Path): Unit =
    if !hasNode then
      println(s"Spec catalog skipped - no Node.js on this machine ($outFile stays as it is)")
    else
      val toolsDir = os.temp.dir(prefix = "orch-spec-tools")
      tools.foreach(t => os.write(toolsDir / t, os.read.bytes(os.resource / "orch-doc-tools" / t)))
      os.makeDir.all(outFile / os.up)
      // the tools merge into an existing --out - an old catalog would keep entries that are gone
      os.remove(outFile)
      println(s"Generating spec catalog from ${sourceDirs.mkString(", ")} -> $outFile")
      run(toolsDir / "openapi2catalog.js", sourceDirs.map(_.toString) :+ "--out" :+ outFile.toString)
      run(toolsDir / "domain2catalog.js", sourceDirs.map(_.toString) :+ "--out" :+ outFile.toString)
      catalogMd.filter(os.exists).foreach: md =>
        run(toolsDir / "site2catalog.js", Seq(md.toString, "--out", outFile.toString))
  end generate

  /** Adds the project colors (`ProjectConfig.color`, from all `ProjectsPerGitRepoConfig`s) to the
    * catalog as `projectColors: { "<project>": "#rrggbb" }` - orch-spec colors a worker or call
    * activity of such a project in the diagram. The default `#fff` means "no color" and is left
    * out. Works without Node.js: a missing catalog gets a file with just the colors.
    */
  def writeProjectColors(colors: Seq[(String, String)], outFile: os.Path): Unit =
    val set = colors.filter { case (name, color) => name.nonEmpty && !Set("", "#fff", "#ffffff").contains(color.trim.toLowerCase) }
    if set.nonEmpty then
      val base = Option.when(os.exists(outFile))(os.read(outFile))
        .flatMap(io.circe.parser.parse(_).toOption)
        .flatMap(_.asObject)
        .getOrElse(io.circe.JsonObject.empty)
      val json = base.add(
        "projectColors",
        io.circe.Json.obj(set.map { case (name, color) => name -> io.circe.Json.fromString(color.trim) }*)
      )
      os.write.over(outFile, io.circe.Json.fromJsonObject(json).spaces2, createFolders = true)
      println(s"  ✓ project colors in spec catalog: ${set.map(_._1).mkString(", ")}")
  end writeProjectColors

  private def run(script: os.Path, args: Seq[String]): Unit =
    val r = os.proc("node", script.toString, args).call(check = false, stdout = os.Inherit, stderr = os.Inherit)
    if r.exitCode != 0 then
      throw new IllegalStateException(s"${script.last} failed (exit code ${r.exitCode})")

end SpecCatalog
