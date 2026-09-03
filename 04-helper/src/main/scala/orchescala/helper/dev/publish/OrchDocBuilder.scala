package orchescala.helper.dev.publish

import orchescala.helper.util.Helpers

/** Builds the orch-doc app (z9nai/orch-doc) from a local checkout - the company docs site
  * (buildSite / serveLocally), the orch-spec catalog and the projects' single-file API page
  * (buildSingleFile). See PublishConfig.apiDocPath.
  */
case class OrchDocBuilder(orchDocPath: os.Path) extends Helpers:

  def build(): os.Path =
    println(s"Building orch-doc: $orchDocPath")
    if !os.exists(orchDocPath / "node_modules") then
      os.proc("npm", "install").callOnConsole(orchDocPath)
    os.proc("npm", "run", "build").callOnConsole(orchDocPath)
    orchDocPath / "dist"
  end build

  /** The standalone API page as ONE self-contained html (`npm run build:single` -
    * JS, CSS, fonts and favicon inlined, no assets folder). This is what a project ships as its
    * `03-api/OpenApi.html` / `PostmanOpenApi.html` - the page loads the yml named like itself.
    * Returns the built file.
    */
  def buildSingleFile(): os.Path =
    println(s"Building orch-doc single-file API page: $orchDocPath")
    if !os.exists(orchDocPath / "node_modules") then
      os.proc("npm", "install").callOnConsole(orchDocPath)
    os.proc("npm", "run", "build:single").callOnConsole(orchDocPath)
    val html = orchDocPath / "dist-single" / "api.html"
    if !os.exists(html) then
      throw new IllegalStateException(s"orch-doc build:single produced no $html")
    html
  end buildSingleFile

  /** Assembles the full documentation site (app + docs.json + the APIs at their released
    * versions + orch-spec) for one or more companies' `00-docs` folders - the same tool used
    * for the local preview (`npm run site`). Pass every company's `00-docs` (this one's and its
    * siblings') to get all of them in the result. Writes into `out` (the company's `00-docs/site`
    * - what publishDocs uploads to /site and the company gateway serves from its classpath);
    * the classic sites of older releases already in there (`<company>/<tag>/`) are kept.
    */
  def buildSite(docsPaths: Seq[os.Path], out: os.Path): os.Path =
    println(s"Assembling the documentation site for ${docsPaths.mkString(", ")} -> $out")
    if !os.exists(orchDocPath / "node_modules") then
      os.proc("npm", "install").callOnConsole(orchDocPath)
    os.makeDir.all(out)
    os.proc(
      "node", "tools/assemble.ts", docsPaths.map(_.toString),
      "--out", out.toString, "--old-releases"
    ).callOnConsole(orchDocPath)
    out
  end buildSite

  /** Assembles the site and serves it locally in the background (same as `npm run site
    * --serve`) - no WebDAV involved. Returns once the server actually answers, so the printed
    * URL is immediately clickable. The server process outlives this JVM; stop it yourself
    * (`lsof -nP -iTCP:<port>` + kill) when done.
    */
  def serveLocally(docsPaths: Seq[os.Path], port: Int = 3004): String =
    val url = s"http://localhost:$port/"
    println(s"Assembling orch-doc preview for ${docsPaths.mkString(", ")}")
    if !os.exists(orchDocPath / "node_modules") then
      os.proc("npm", "install").callOnConsole(orchDocPath)

    // The server outlives the JVM on purpose - so the previous prepareDocs run is still bound
    // to the port. Replace our own old server; never touch a foreign process on that port.
    val listeners = os.proc("lsof", "-ti", s"tcp:$port", "-sTCP:LISTEN").call(check = false)
      .out.lines().map(_.trim).filter(_.nonEmpty)
    val foreign   = listeners.filterNot: pid =>
      val cmd = os.proc("ps", "-o", "command=", "-p", pid).call(check = false).out.text()
      val ours = cmd.contains("tools/assemble.ts")
      if ours then
        println(s"Stopping previous preview server (pid $pid)")
        os.proc("kill", pid).call(check = false)
      ours
    if foreign.nonEmpty then
      println(
        s"\nPort $port is used by another process (pid ${foreign.mkString(", ")}) - " +
          s"stop it or use another port. Preview NOT started.\n"
      )
      return url
    end if

    val logFile = os.temp(prefix = "orchescala-preview-server-", suffix = ".log")
    val server  = os.proc(
      "node",
      "tools/assemble.ts",
      docsPaths.map(_.toString),
      "--out",
      "dist-site",
      "--serve",
      port.toString
    ).spawn(cwd = orchDocPath, stdout = logFile, stderr = logFile)

    val deadline = System.currentTimeMillis() + 60000
    def log      = os.read(logFile)
    def failed   = !server.isAlive() || log.contains("EADDRINUSE")
    while !log.contains("Serving") && !failed && System.currentTimeMillis() < deadline do
      Thread.sleep(500)
    if log.contains("Serving") then
      println(s"\nPreview ready: $url\n")
    else
      val why = if failed then "Server exited" else "Server did not report ready within 60s"
      println(s"\n$why - last lines of $logFile:\n${log.linesIterator.toSeq.takeRight(15).mkString("\n")}\n")
    url
  end serveLocally

  /** Regenerates orch-spec's full catalog from `sourceDirs` (project checkouts, e.g.
    * gitBasePath): services from OpenAPI operations, domain classes read straight from the Scala
    * sources (openapi2catalog alone only sees classes reachable from an exposed operation - a
    * project whose OpenApi.yml has none, e.g. a pure domain module, would otherwise contribute no
    * classes at all - domain2catalog reads the sources directly and catches those too), and, if
    * `catalogMd` exists, call activities from the company's generated `catalog.md` (the same
    * links the site shows) - no network/auth needed anywhere in this. Writes into orch-spec's OWN `public/` folder (sibling checkout
    * `../orch-spec`, same convention as orch-doc's build:spec), so `catalog.generated.json` ships
    * with orch-spec's client build itself - same-origin, no shared folder, no CORS. Read-only
    * from the user's point of view: every build overwrites it.
    */
  def generateSpecCatalog(
      sourceDirs: Seq[os.Path],
      catalogMd: Option[os.Path],
      // only for tests - the real pipeline always writes into orch-spec's public/ folder
      outFile: Option[os.Path] = None
  ): Unit =
    val orchSpecPath = orchDocPath / os.up / "orch-spec"
    if !os.exists(orchSpecPath) then
      println(s"Skipping spec catalog - no orch-spec checkout at $orchSpecPath")
    else
      val out = outFile.getOrElse(orchSpecPath / "public" / "catalog.generated.json")
      os.makeDir.all(out / os.up)
      // the tools merge into an existing --out and parse it as JSON - an empty leftover of an
      // interrupted run would fail every following run ("Unexpected end of JSON input")
      if os.exists(out) && os.size(out) == 0 then
        println(s"Removing empty leftover $out")
        os.remove(out)
      println(s"Generating spec catalog from ${sourceDirs.mkString(", ")} -> $out")
      os.proc("node", "tools/openapi2catalog.ts", sourceDirs.map(_.toString), "--out", out.toString)
        .callOnConsole(orchSpecPath)
      os.proc("node", "tools/domain2catalog.ts", sourceDirs.map(_.toString), "--out", out.toString)
        .callOnConsole(orchSpecPath)
      catalogMd.filter(os.exists).foreach: md =>
        os.proc("node", "tools/site2catalog.ts", md.toString, "--out", out.toString)
          .callOnConsole(orchSpecPath)
    end if
  end generateSpecCatalog

end OrchDocBuilder
