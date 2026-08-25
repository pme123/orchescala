package orchescala.helper.dev.publish

import orchescala.helper.util.Helpers

/** Builds the orch-doc app (z9nai/orch-doc) from a local checkout and hands back the built
  * `dist/` directory - to be uploaded as a project's API doc instead of the static Redoc shell.
  *
  * First, non-final integration step - see PublishConfig.apiDocPath.
  */
case class OrchDocBuilder(orchDocPath: os.Path) extends Helpers:

  def build(): os.Path =
    println(s"Building orch-doc: $orchDocPath")
    if !os.exists(orchDocPath / "node_modules") then
      os.proc("npm", "install").callOnConsole(orchDocPath)
    os.proc("npm", "run", "build").callOnConsole(orchDocPath)
    orchDocPath / "dist"
  end build

  /** Assembles the full orch-doc site (app + docs.json + versioned APIs + orch-spec) for one or
    * more companies' `00-docs` folders - the same tool used for local preview (`npm run site`).
    * Pass every company's `00-docs` (this one's and its siblings') to get all of them in the
    * result, matching what a plain local `npm run site` produces. Writes to a fresh temp dir, so
    * it never touches `dist-site/` or a previous preview build.
    */
  def buildPreview(docsPaths: Seq[os.Path]): os.Path =
    println(s"Assembling orch-doc preview for ${docsPaths.mkString(", ")}")
    if !os.exists(orchDocPath / "node_modules") then
      os.proc("npm", "install").callOnConsole(orchDocPath)
    val out = os.temp.dir(prefix = "orchescala-preview")
    os.proc("node", "tools/assemble.ts", docsPaths.map(_.toString), "--out", out.toString)
      .callOnConsole(orchDocPath)
    out
  end buildPreview

  /** Assembles the site and serves it locally in the background (same as `npm run site
    * --serve`) - no WebDAV involved. Returns once the server actually answers, so the printed
    * URL is immediately clickable. The server process outlives this JVM; stop it yourself
    * (`lsof -nP -iTCP:<port>` + kill) when done.
    */
  def serveLocally(docsPaths: Seq[os.Path], port: Int = 3004): String =
    println(s"Assembling orch-doc preview for ${docsPaths.mkString(", ")}")
    if !os.exists(orchDocPath / "node_modules") then
      os.proc("npm", "install").callOnConsole(orchDocPath)
    val logFile = os.temp(prefix = "orchescala-preview-server-", suffix = ".log")
    os.proc(
      "node",
      "tools/assemble.ts",
      docsPaths.map(_.toString),
      "--out",
      "dist-site",
      "--serve",
      port.toString
    ).spawn(cwd = orchDocPath, stdout = logFile, stderr = logFile)

    val url      = s"http://localhost:$port/"
    val deadline = System.currentTimeMillis() + 60000
    while !os.read(logFile).contains("Serving") && System.currentTimeMillis() < deadline do
      Thread.sleep(500)
    if os.read(logFile).contains("Serving") then
      println(s"\nPreview ready: $url\n")
    else
      println(s"\nServer did not report ready within 60s - check $logFile\n")
    url
  end serveLocally

  /** Regenerates orch-spec's full catalog from `sourceDirs` (project checkouts, e.g.
    * gitBasePath): services from OpenAPI operations, domain classes read straight from the Scala
    * sources (openapi2catalog alone only sees classes reachable from an exposed operation - a
    * project whose OpenApi.yml has none, e.g. a pure domain module, would otherwise contribute no
    * classes at all - domain2catalog reads the sources directly and catches those too), and, if
    * `catalogHtml` exists, call activities from a locally-rendered catalog.html - no network/auth
    * needed anywhere in this. Writes into orch-spec's OWN `public/` folder (sibling checkout
    * `../orch-spec`, same convention as orch-doc's build:spec), so `catalog.generated.json` ships
    * with orch-spec's client build itself - same-origin, no shared folder, no CORS. Read-only
    * from the user's point of view: every build overwrites it.
    */
  def generateSpecCatalog(sourceDirs: Seq[os.Path], catalogHtml: Option[os.Path]): Unit =
    val orchSpecPath = orchDocPath / os.up / "orch-spec"
    if !os.exists(orchSpecPath) then
      println(s"Skipping spec catalog - no orch-spec checkout at $orchSpecPath")
    else
      val out = orchSpecPath / "public" / "catalog.generated.json"
      os.makeDir.all(out / os.up)
      println(s"Generating spec catalog from ${sourceDirs.mkString(", ")} -> $out")
      os.proc("node", "tools/openapi2catalog.ts", sourceDirs.map(_.toString), "--out", out.toString)
        .callOnConsole(orchSpecPath)
      os.proc("node", "tools/domain2catalog.ts", sourceDirs.map(_.toString), "--out", out.toString)
        .callOnConsole(orchSpecPath)
      catalogHtml.filter(os.exists).foreach: html =>
        os.proc("node", "tools/site2catalog.ts", html.toString, "--out", out.toString)
          .callOnConsole(orchSpecPath)
    end if
  end generateSpecCatalog

end OrchDocBuilder
