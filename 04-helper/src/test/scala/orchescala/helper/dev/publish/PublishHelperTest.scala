package orchescala.helper.dev.publish

import munit.FunSuite

class PublishHelperTest extends FunSuite:

  /** A git repository with one committed file and a CHANGELOG. */
  private def repo(): os.Path =
    val dir = os.temp.dir(prefix = "orchescala-release-")
    def git(args: String*) = os.proc("git" +: args).call(cwd = dir)
    git("init", "-q")
    git("config", "user.email", "test@example.com")
    git("config", "user.name", "test")
    os.write(dir / "build.sbt", "version := \"1.0.0\"")
    os.write(dir / "CHANGELOG.md", "# Changelog")
    git("add", ".")
    git("commit", "-q", "-m", "init")
    dir

  test("a release refuses uncommitted changes - `git commit -a` took them into the release"):
    val dir = repo()
    os.write.over(dir / "build.sbt", "version := \"1.1.0\" // unfinished work")
    val error = intercept[IllegalStateException](WorkingTree.verifyCleanWorkingTree(dir))
    assert(error.getMessage.contains("build.sbt"), error.getMessage)

  test("the edited CHANGELOG and untracked files are fine"):
    val dir = repo()
    os.write.over(dir / "CHANGELOG.md", "# Changelog\n## 1.1.0")
    os.write(dir / "notes.txt", "not tracked")
    WorkingTree.verifyCleanWorkingTree(dir)

  private val tags = Seq("v1.9.18", "v1.9.19", "v1.8.3", "not-a-release")

  test("the next patch, minor or major follows the releases"):
    assertEquals(PublishHelper.nextVersionProblem("1.9.20", tags), None)
    assertEquals(PublishHelper.nextVersionProblem("1.10.0", tags), None)
    assertEquals(PublishHelper.nextVersionProblem("2.0.0", tags), None)

  test("a patch of an older line - e.g. 1.9.20 when 1.10.0 is released already"):
    assertEquals(PublishHelper.nextVersionProblem("1.9.20", tags :+ "v1.10.0"), None)
    assertEquals(PublishHelper.nextVersionProblem("1.8.4", tags), None)

  test("a typo is found - 1.19.20 was released for 1.9.20"):
    val problem = PublishHelper.nextVersionProblem("1.19.20", tags)
    assert(problem.exists(_.contains("expected 1.9.20, 1.10.0, 2.0.0")), problem)

  test("a skipped or repeated version is found"):
    assert(PublishHelper.nextVersionProblem("1.9.21", tags).isDefined)
    assert(PublishHelper.nextVersionProblem("1.9.19", tags).isDefined)
    assert(PublishHelper.nextVersionProblem("1.11.0", tags).isDefined)

  test("no releases yet, or a SNAPSHOT: nothing to check"):
    assertEquals(PublishHelper.nextVersionProblem("0.1.0", Seq.empty), None)
    assertEquals(PublishHelper.nextVersionProblem("1.19.20-SNAPSHOT", tags), None)

  test("a failed fetch of the tags is said - the local tags may be behind"):
    val dir      = repo()
    os.proc("git", "remote", "add", "origin", "/no/such/repo.git").call(cwd = dir) // unreachable
    val warnings = collection.mutable.ListBuffer.empty[String]
    PublishHelper.verifyNextVersion("1.0.0", dir, _ => true, warn = warnings += _)
    assertEquals(warnings.size, 1)
    assert(warnings.head.contains("could not fetch the tags"), warnings.head)

  test("against the tags of the repository - stops without a yes"):
    val dir = repo()
    os.proc("git", "tag", "--no-sign", "v1.9.19").call(cwd = dir)
    PublishHelper.verifyNextVersion("1.9.20", dir, _ => fail("no question for the next patch"))
    PublishHelper.verifyNextVersion("1.19.20", dir, _ => true) // continued on a yes
    val error = intercept[IllegalArgumentException]:
      PublishHelper.verifyNextVersion("1.19.20", dir, _ => false)
    assert(error.getMessage.contains("release stopped"), error.getMessage)

end PublishHelperTest

class PublishHelperSbtRunsTest extends FunSuite:

  test("a release builds everything locally first - the upload is the last sbt run"):
    val runs = SbtRuns.of(dockerProject = Some("worker"), build = Seq("api/run"))
    assertEquals(
      runs.build,
      Seq("sbt", "package", "packageSrc", "makePom", "worker / Docker / publishLocal", "api/run")
    )
    // the image first - its tag can be overwritten, the artifacts of a release can not
    assertEquals(runs.publish, Seq("sbt", "worker / Docker / publish", "publish"))

  test("without a docker image - and with sbt options"):
    val runs = SbtRuns.of(dockerProject = None, sbtOptions = Seq("-J-Xmx3G"))
    assertEquals(runs.build, Seq("sbt", "-J-Xmx3G", "package", "packageSrc", "makePom"))
    assertEquals(runs.publish, Seq("sbt", "-J-Xmx3G", "publish"))

  test("the steps of a release: build, the docs, the upload, git - a snapshot only builds and uploads"):
    import ReleaseStep.*
    assertEquals(
      ReleaseRun.steps(isSnapshot = false, hasDocs = true),
      Seq(Build, UploadDocs, Upload, Git)
    )
    assertEquals(
      ReleaseRun.steps(isSnapshot = false, hasDocs = false),
      Seq(Build, Upload, Git)
    )
    assertEquals(ReleaseRun.steps(isSnapshot = true, hasDocs = true), Seq(Build, Upload))

  /** A release whose processes are recorded instead of run - `failing` throws; a failure is
    * recorded as `failed <step>`.
    */
  private def release(failing: Set[String] = Set.empty): (ReleaseRun, () => Seq[String]) =
    val log  = collection.mutable.ListBuffer.empty[String]
    def step(name: String): Unit =
      log += name
      if failing(name) then throw IllegalStateException(s"$name failed")
    val runs = SbtRuns.of(Some("worker"))
    val rel  = ReleaseRun(
      runs,
      uploadDocs = () => step("docs"),
      git = () => step("git"),
      exec = cmd => step(if cmd == runs.build then "build" else "upload"),
      onFailure = failed => log += s"failed $failed",
      afterFailedUpload = () => log += "reported"
    )
    (rel, () => log.toSeq)

  test("the release runs its steps in order"):
    val (rel, log) = release()
    rel.run(ReleaseRun.steps(isSnapshot = false, hasDocs = true))
    assertEquals(log(), Seq("build", "docs", "upload", "git"))
    val (snapshot, snapshotLog) = release()
    snapshot.run(ReleaseRun.steps(isSnapshot = true, hasDocs = true))
    assertEquals(snapshotLog(), Seq("build", "upload"))

  test("a failing build stops the release - nothing is uploaded"):
    val (rel, log) = release(failing = Set("build"))
    intercept[IllegalStateException]:
      rel.run(ReleaseRun.steps(isSnapshot = false, hasDocs = true))
    assertEquals(log(), Seq("build", "failed Build"))

  test("failing docs stop the release - nothing is uploaded"):
    val (rel, log) = release(failing = Set("docs"))
    intercept[IllegalStateException]:
      rel.run(ReleaseRun.steps(isSnapshot = false, hasDocs = true))
    assertEquals(log(), Seq("build", "docs", "failed UploadDocs"))

  test("a failing upload: the docs are on the webserver already, git does not run - what went out is reported"):
    val (rel, log) = release(failing = Set("upload"))
    intercept[IllegalStateException]:
      rel.run(ReleaseRun.steps(isSnapshot = false, hasDocs = true))
    assertEquals(log(), Seq("build", "docs", "upload", "failed Upload", "reported")) // the restore first

  test("the runs of a project and of the company project"):
    assertEquals(
      SbtRuns.project(hasWorkerApp = true).build,
      Seq("sbt", "-J-Xmx3G", "package", "packageSrc", "makePom", "worker / Docker / publishLocal", "api/run")
    )
    assertEquals(
      SbtRuns.project(hasWorkerApp = false).publish,
      Seq("sbt", "-J-Xmx3G", "publish")
    )
    assertEquals(
      SbtRuns.company(hasGateway = true).publish,
      Seq("sbt", "-J-Xmx3G", "gateway / Docker / publish", "publish")
    )
    assertEquals(
      SbtRuns.company(hasGateway = false).build,
      Seq("sbt", "-J-Xmx3G", "package", "packageSrc", "makePom")
    )

end PublishHelperSbtRunsTest

class PublishHelperRetryTest extends FunSuite:

  /** A git repository with one committed file and a CHANGELOG. */
  private def repo(): os.Path =
    val dir = os.temp.dir(prefix = "orchescala-retry-")
    def git(args: String*) = os.proc("git" +: args).call(cwd = dir)
    git("init", "-q")
    git("config", "user.email", "test@example.com")
    git("config", "user.name", "test")
    os.write(dir / "build.sbt", "version := \"1.0.0\"")
    os.write(dir / "ProjectDef.scala", "version = \"1.0.0\"")
    os.write(dir / "CHANGELOG.md", "# Changelog")
    git("add", ".")
    git("commit", "-q", "-m", "init")
    dir

  /** The version is rewritten, then the build fails: the next try must pass the clean-tree check. */
  test("a failed release restores the versions it rewrote - the CHANGELOG and untracked files stay"):
    val dir = repo()
    // a generated doc with a special name - `--porcelain` would quote it
    os.write(dir / "docs" / "Prozess Ü (1).md", "# v1", createFolders = true)
    os.proc("git", "add", ".").call(cwd = dir)
    os.proc("git", "commit", "-q", "-m", "doc").call(cwd = dir)
    os.write.over(dir / "CHANGELOG.md", "# Changelog\n## 1.1.0")
    os.write(dir / "notes.txt", "not tracked")
    WorkingTree.verifyCleanWorkingTree(dir)
    // as publish does: armed with the clean tree, then the release rewrites the files
    val restore = WorkingTree.restoreForRetry(isSnapshot = false, dir)
    os.remove(dir / "build.sbt") // a generator removed a file
    os.write(dir / "new.md", "added during the release")
    os.proc("git", "mv", "docs/Prozess Ü (1).md", "docs/renamed.md").call(cwd = dir) // a rename, staged
    os.write.over(dir / "docs" / "renamed.md", "# v2 generated")
    PublishHelper.replaceVersion("1.1.0", dir / "ProjectDef.scala")
    os.proc("git", "add", "ProjectDef.scala", "new.md").call(cwd = dir) // staged or not, even a new file
    intercept[IllegalStateException](WorkingTree.verifyCleanWorkingTree(dir))

    val runs = SbtRuns.of(None)
    val rel  = ReleaseRun(
      runs,
      uploadDocs = () => (),
      git = () => (),
      exec = _ => throw IllegalStateException("sbt failed"),
      onFailure = restore
    )
    intercept[IllegalStateException](rel.run(ReleaseRun.steps(isSnapshot = false, hasDocs = true)))

    WorkingTree.verifyCleanWorkingTree(dir) // the next try starts clean
    assertEquals(os.read(dir / "ProjectDef.scala"), "version = \"1.0.0\"")
    assertEquals(os.read(dir / "docs" / "Prozess Ü (1).md"), "# v1")
    assertEquals(os.read(dir / "build.sbt"), "version := \"1.0.0\"")
    assert(os.exists(dir / "new.md")) // unstaged, kept as untracked
    assert(os.exists(dir / "docs" / "renamed.md")) // the rename's target: unstaged, kept as untracked
    assertEquals(os.read(dir / "CHANGELOG.md"), "# Changelog\n## 1.1.0")
    assert(os.exists(dir / "notes.txt"))

  /** Ctrl-C: the failing sbt run and the shutdown hook both ask for the restore - it runs once,
    * the second caller waits for it (the JVM ends with the hook).
    */
  test("the restore runs once - a concurrent second call waits for it"):
    val dir     = repo()
    var runs    = 0
    val restore = WorkingTree.restoreForRetry(
      isSnapshot = false,
      dir,
      restore = _ =>
        runs += 1
        Thread.sleep(300)
    )
    val first   = Thread(() => restore(ReleaseStep.Build))
    first.start()
    Thread.sleep(50)
    val started = System.nanoTime()
    restore(ReleaseStep.Build) // the hook - waits for the first, then nothing to do
    assert((System.nanoTime() - started) / 1e6 > 200, "waited for the running restore")
    first.join()
    assertEquals(runs, 1)
    restore(ReleaseStep.Build) // a third call: done already
    assertEquals(runs, 1)

  test("a failing restore is tried again by the next caller (the hook)"):
    val dir   = repo()
    var calls = 0
    val restore = WorkingTree.restoreForRetry(
      isSnapshot = false,
      dir,
      restore = _ =>
        calls += 1
        if calls == 1 then throw IllegalStateException("index.lock")
    )
    intercept[IllegalStateException](restore(ReleaseStep.Build))
    restore(ReleaseStep.Build) // the hook: tries again
    restore(ReleaseStep.Build) // done now
    assertEquals(calls, 2)

  test("a failing rewrite before the release restores too"):
    val dir     = repo()
    val restore = WorkingTree.restoreForRetry(isSnapshot = false, dir)
    val error   = intercept[IllegalStateException]:
      WorkingTree.restoring(restore):
        PublishHelper.replaceVersion("1.1.0", dir / "ProjectDef.scala")
        throw IllegalStateException("the api file is broken")
    assertEquals(error.getMessage, "the api file is broken")
    WorkingTree.verifyCleanWorkingTree(dir)

  test("an interrupt or a fatal error goes through without a restore"):
    def interrupted(error: Throwable): Seq[String] =
      val log  = collection.mutable.ListBuffer.empty[String]
      val runs = SbtRuns.of(None)
      val rel  = ReleaseRun(
        runs,
        uploadDocs = () => (),
        git = () => (),
        exec = _ => throw error,
        onFailure = step => log += s"failed $step"
      )
      // munit's intercept lets a fatal error through (and interrupts the thread) - caught by hand
      try rel.run(ReleaseRun.steps(isSnapshot = true, hasDocs = false))
      catch case e: Throwable => assertEquals(e, error)
      Thread.interrupted() // clears the flag, should one have been set
      log.toSeq
    assertEquals(interrupted(InterruptedException("Ctrl-C")), Seq.empty)
    assertEquals(interrupted(OutOfMemoryError("sbt")), Seq.empty)
    assertEquals(interrupted(IllegalStateException("sbt failed")), Seq("failed Build"))

  test("with changes of yours in the tree the restore is not armed - whatever the caller checked"):
    val dir = repo()
    os.write.over(dir / "ProjectDef.scala", "version = \"1.0.0\" // my unfinished work")
    val restore = WorkingTree.restoreForRetry(isSnapshot = false, dir) // armed with a dirty tree
    PublishHelper.replaceVersion("1.1.0", dir / "ProjectDef.scala")
    restore(ReleaseStep.Build)
    // nothing discarded - neither the rewritten version nor the unfinished work
    assertEquals(os.read(dir / "ProjectDef.scala").trim, "version = \"1.1.0\" // my unfinished work")

  /** Ctrl-C ends the JVM: the shutdown hook of the running step restores - it is registered
    * while the step runs and gone afterwards (a hook of a finished step would restore the
    * next try's work).
    */
  test("the shutdown hook of the running step restores it - and is gone once the step is done"):
    val hooks   = collection.mutable.Set.empty[Thread]
    val log     = collection.mutable.ListBuffer.empty[String]
    val runs    = SbtRuns.of(None)
    var during  = Seq.empty[Thread]
    val rel     = ReleaseRun(
      runs,
      uploadDocs = () => (),
      git = () => (),
      exec = cmd => if cmd == runs.build then during = hooks.toSeq,
      onFailure = step => log += s"restored $step",
      awaitChild = () => log += "waited for sbt",
      addShutdownHook = hooks += _,
      removeShutdownHook = hooks -= _
    )
    rel.run(ReleaseRun.steps(isSnapshot = true, hasDocs = false))
    assertEquals(during.size, 1) // the hook of Build, while it ran
    assert(hooks.isEmpty)        // gone afterwards
    during.head.run()            // as the JVM would on Ctrl-C
    assertEquals(log.toSeq, Seq("waited for sbt", "restored Build"))
    // aborted while uploading: what went out is reported, then restored
    log.clear()
    rel.copy(afterFailedUpload = () => log += "reported").abortedAt(ReleaseStep.Upload).run()
    assertEquals(log.toSeq, Seq("waited for sbt", "restored Upload", "reported")) // the restore first

  test("the sbt child: a failing process throws, a running one is waited for"):
    assume(!scala.util.Properties.isWin, "sh, sleep and pgrep")
    intercept[IllegalStateException](SbtChild.run(Seq("false")))
    SbtChild.run(Seq("true"))
    SbtChild.awaitExit() // nothing running - returns at once
    val sleeper = Thread(() => SbtChild.run(Seq("sleep", "1")))
    sleeper.start()
    Thread.sleep(200)
    val started = System.nanoTime()
    SbtChild.awaitExit()
    assert((System.nanoTime() - started) / 1e6 > 500, "waited for the child")
    sleeper.join()

  // the long sleeps are never waited for - they are killed; the odd durations are what pgrep looks for
  test("the sbt child and what it started are killed when the thread running it is interrupted"):
    assume(!scala.util.Properties.isWin, "sh, sleep and pgrep")
    @volatile var interrupted = false
    // a shell with a child of its own - like the sbt launcher and its JVM
    val runner = Thread: () =>
      try SbtChild.run(Seq("sh", "-c", "sleep 31.7; echo done"))
      catch case _: InterruptedException => interrupted = true
    runner.start()
    Thread.sleep(500)
    assertEquals(os.proc("pgrep", "-f", "^sleep 31.7$").call(check = false).exitCode, 0, "the grandchild runs")
    runner.interrupt()
    runner.join(10000)
    assert(!runner.isAlive, "the run ended with the interrupt")
    assert(interrupted)
    // gone within a few seconds (a killed process stays a zombie until it is reaped)
    def gone = os.proc("pgrep", "-fl", "^sleep 31.7$").call(check = false)
    val deadline = System.nanoTime() + 3_000_000_000L
    while gone.exitCode == 0 && System.nanoTime() < deadline do Thread.sleep(100)
    assertEquals(gone.exitCode, 1, s"the grandchild is gone: ${gone.out.text()}")
    val started = System.nanoTime()
    SbtChild.awaitExit() // nothing running any more
    assert((System.nanoTime() - started) / 1e6 < 1000)

  test("the exit code of a failed sbt run is in the message"):
    assume(!scala.util.Properties.isWin, "sh")
    val error = intercept[IllegalStateException](SbtChild.run(Seq("sh", "-c", "exit 3")))
    assert(error.getMessage.contains("exit code 3"), error.getMessage)

  test("one sbt run at a time"):
    assume(!scala.util.Properties.isWin, "sleep")
    val sleeper = Thread(() => SbtChild.run(Seq("sleep", "1")))
    sleeper.start()
    Thread.sleep(200)
    val error = intercept[IllegalStateException](SbtChild.run(Seq("true")))
    assert(error.getMessage.contains("going on already"), error.getMessage)
    sleeper.join()

  test("awaitExit ends sbt and what it started after its timeout - Ctrl-C, sbt still writing"):
    assume(!scala.util.Properties.isWin, "sh, sleep and pgrep")
    @volatile var failed = false
    val sleeper = Thread: () =>
      try SbtChild.run(Seq("sh", "-c", "sleep 33.1; echo done"))
      catch case _: IllegalStateException => failed = true // ended: exit code != 0
    sleeper.start()
    Thread.sleep(500)
    assertEquals(os.proc("pgrep", "-f", "^sleep 33.1$").call(check = false).exitCode, 0, "the grandchild runs")
    val started = System.nanoTime()
    SbtChild.awaitExit(timeout = scala.concurrent.duration.Duration(300, "millis"))
    val waited = (System.nanoTime() - started) / 1e6
    assert(waited >= 250 && waited < 6000, s"waited $waited ms")
    sleeper.join(5000)
    assert(failed)
    def gone = os.proc("pgrep", "-fl", "^sleep 33.1$").call(check = false)
    val deadline = System.nanoTime() + 3_000_000_000L
    while gone.exitCode == 0 && System.nanoTime() < deadline do Thread.sleep(100)
    assertEquals(gone.exitCode, 1, s"the grandchild is gone: ${gone.out.text()}")

  test("a failing restore does not hide the failure of the release"):
    val runs = SbtRuns.of(None)
    val rel  = ReleaseRun(
      runs,
      uploadDocs = () => (),
      git = () => (),
      exec = _ => throw IllegalStateException("sbt failed"),
      onFailure = _ => throw IllegalArgumentException("restore failed")
    )
    val error = intercept[IllegalStateException](rel.run(ReleaseRun.steps(isSnapshot = true, hasDocs = false)))
    assertEquals(error.getSuppressed.toSeq.map(_.getMessage), Seq("restore failed"))

  test("a snapshot keeps its changes; after the git step nothing is restored"):
    val dir = repo()
    PublishHelper.replaceVersion("1.1.0-SNAPSHOT", dir / "ProjectDef.scala")
    WorkingTree.restoreForRetry(isSnapshot = true, dir)(ReleaseStep.Build)
    assertEquals(os.read(dir / "ProjectDef.scala").trim, "version = \"1.1.0-SNAPSHOT\"")
    WorkingTree.restoreForRetry(isSnapshot = false, dir)(ReleaseStep.Git)
    assertEquals(os.read(dir / "ProjectDef.scala").trim, "version = \"1.1.0-SNAPSHOT\"")

end PublishHelperRetryTest

class PublishHelperVersionFreeTest extends FunSuite:

  private val urls = RepoCheck.releaseArtifactUrls(
    "https://repo.example.com/artifactory/libs-release",
    "com.example",
    Seq("example-customer-domain", "example-customer-worker"),
    "1.2.3"
  )

  test("the poms of the modules in the release repo"):
    assertEquals(
      urls,
      Seq(
        "https://repo.example.com/artifactory/libs-release/com/example/example-customer-domain/1.2.3/example-customer-domain-1.2.3.pom",
        "https://repo.example.com/artifactory/libs-release/com/example/example-customer-worker/1.2.3/example-customer-worker-1.2.3.pom"
      )
    )

  test("a free version: every module is missing"):
    RepoCheck.verifyVersionFree("1.2.3", urls, _ => 404)

  test("a taken version - also when only one module of a half-finished release is there"):
    val error = intercept[IllegalStateException]:
      RepoCheck.verifyVersionFree("1.2.3", urls, url => if url.contains("worker") then 200 else 404)
    assert(error.getMessage.contains("is in the repository already"), error.getMessage)
    assert(error.getMessage.contains("example-customer-worker"), error.getMessage)

  test("the company's artifacts carry the Scala suffix, a project's do not"):
    val company = RepoCheck.releaseArtifactUrls(
      "https://repo", "valiant", Seq("valiant-orchescala-domain_3"), "1.2.3"
    )
    assertEquals(company, Seq("https://repo/valiant/valiant-orchescala-domain_3/1.2.3/valiant-orchescala-domain_3-1.2.3.pom"))

  test("wrong credentials, a redirect and an unreachable repository stop the release"):
    val refused  = intercept[IllegalStateException](RepoCheck.verifyVersionFree("1.2.3", urls, _ => 401))
    assert(refused.getMessage.contains("refuses the credentials"), refused.getMessage)
    val redirect = intercept[IllegalStateException](RepoCheck.verifyVersionFree("1.2.3", urls, _ => 302))
    assert(redirect.getMessage.contains("redirects"), redirect.getMessage)
    val down     = intercept[IllegalStateException](RepoCheck.verifyVersionFree("1.2.3", urls, _ => 0))
    assert(down.getMessage.contains("not reachable"), down.getMessage)
    val odd      = intercept[IllegalStateException](RepoCheck.verifyVersionFree("1.2.3", urls, _ => 500))
    assert(odd.getMessage.contains("unexpected status (500)"), odd.getMessage)

  test("the artifact suffix comes from the build's Settings.scala"):
    val project = Seq("""  val scalaV = "3.7.4"""", "    crossPaths := false").mkString("\n")
    val company = Seq("""  val scalaV = "3.7.4"""", "    // crossPaths := false,").mkString("\n")
    assertEquals(RepoCheck.artifactSuffix(project), "")
    assertEquals(RepoCheck.artifactSuffix(company), "_3")
    assertEquals(RepoCheck.artifactSuffix("""val scalaV = "2.13.16""""), "_2")
    // spelled without spaces, inside a larger line - and only in code, not in a comment
    assertEquals(RepoCheck.artifactSuffix(Seq("""val scalaV = "3.7.4"""", "crossPaths:=false").mkString("\n")), "")
    assertEquals(
      RepoCheck.artifactSuffix(Seq("""val scalaV = "3.7.4"""", "  Seq(publishMavenStyle := true, crossPaths := false)").mkString("\n")),
      ""
    )
    assertEquals(
      RepoCheck.artifactSuffix(Seq("""val scalaV = "3.7.4"""", "  publishMavenStyle := true, // crossPaths := false").mkString("\n")),
      "_3"
    )
    val error = intercept[IllegalStateException](RepoCheck.artifactSuffix("object Settings {}"))
    assert(error.getMessage.contains("scalaV"), error.getMessage)


  /** A small HTTP server playing the repository: `taken` paths exist, the rest is missing, a
    * `redirect` path redirects, and without the expected credentials everything is 401. Every
    * request path is recorded.
    */
  private def withRepo(authorized: com.sun.net.httpserver.HttpExchange => Boolean)(
      body: (String, () => Seq[String]) => Unit
  ): Unit =
    import com.sun.net.httpserver.HttpServer
    import java.net.InetSocketAddress
    val requests = collection.mutable.ListBuffer.empty[String]
    val server   = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
    server.createContext(
      "/",
      exchange =>
        val path   = exchange.getRequestURI.getPath
        requests += path
        val status =
          if path.endsWith("/redirect") then
            exchange.getResponseHeaders.add("Location", "/repo/missing")
            302
          else if !authorized(exchange) then 401
          else if path.contains("taken") || path.matches(".*/api/v4/projects/[^/]+") then 200 // a GitLab project
          else 404
        exchange.sendResponseHeaders(status, -1)
        exchange.close()
    )
    server.start()
    try body(s"http://127.0.0.1:${server.getAddress.getPort}", () => requests.toSeq)
    finally server.stop(0)
  end withRepo

  test("curlStatus: status codes, no redirect followed, the credentials of the config, unreachable"):
    withRepo(e => Option(e.getRequestHeaders.getFirst("Private-Token")).contains("secret")): (base, _) =>
      val config = Seq("""header = "Private-Token: secret"""")
      assertEquals(RepoCheck.curlStatus(config)(s"$base/repo/taken"), 200)
      assertEquals(RepoCheck.curlStatus(config)(s"$base/repo/missing"), 404)
      assertEquals(RepoCheck.curlStatus(config)(s"$base/repo/redirect"), 302)
      assertEquals(RepoCheck.curlStatus(Seq.empty)(s"$base/repo/taken"), 401)
    // nobody listens there - `000` becomes 0
    assertEquals(RepoCheck.curlStatus(Seq.empty)("http://127.0.0.1:1/repo"), 0)

  test("curl that fails before any status: 0, not an error - the report's unreachable branch"):
    assertEquals(RepoCheck.curlStatus(Seq.empty, curl = "true")("http://127.0.0.1:1/repo"), 0)

  test("a program that answers no status is an error - not a free version"):
    val error = intercept[IllegalStateException]:
      RepoCheck.curlStatus(Seq.empty, curl = "echo")("http://127.0.0.1:1/repo")
    assert(error.getMessage.contains("answered no HTTP status"), error.getMessage)

  test("without curl: a clear message, no stack trace of a missing program"):
    val error = intercept[IllegalStateException]:
      RepoCheck.curlStatus(Seq.empty, curl = "/no/such/curl")("http://127.0.0.1:1/repo")
    assert(error.getMessage.contains("`/no/such/curl` is needed"), error.getMessage)

  test("a GitLab project registry: the project tells whether the token reads it"):
    val registry = "https://gitlab.example.com/api/v4/projects/42/packages/maven"
    assertEquals(RepoCheck.gitlabProjectUrl(registry), Some("https://gitlab.example.com/api/v4/projects/42"))
    assertEquals(RepoCheck.gitlabProjectUrl("https://gitlab.example.com/api/v4/groups/7/-/packages/maven"), None)
    RepoCheck.verifyGitlabCredentials(registry, _ => 200, confirm = _ => fail("nothing to ask with 200"))
    // not shown to the token: wrong - or a deploy token that may not read the project: asked
    RepoCheck.verifyGitlabCredentials(registry, _ => 404, confirm = _ => true)
    val refused = intercept[IllegalStateException](RepoCheck.verifyGitlabCredentials(registry, _ => 404, confirm = _ => false))
    assert(refused.getMessage.contains("does not show") && refused.getMessage.contains("release stopped"), refused.getMessage)
    // a group registry can not be checked: goes on when confirmed, else stops
    val group = "https://gitlab.example.com/api/v4/groups/7/-/packages/maven"
    RepoCheck.verifyGitlabCredentials(group, _ => fail("nothing to ask"), confirm = _ => true)
    val stopped = intercept[IllegalStateException]:
      RepoCheck.verifyGitlabCredentials(group, _ => fail("nothing to ask"), confirm = _ => false)
    assert(stopped.getMessage.contains("release stopped"), stopped.getMessage)

  test("verifyVersionFree for a GitLab DevConfig - the project first, then the poms"):
    import orchescala.api.{ApiProjectConfig, ModuleType, VersionConfig}
    import orchescala.engine.config.{RepoConfig, RepoCredentials, ReposConfig}
    import orchescala.helper.util.{DevConfig, SbtConfig}
    withRepo(e =>
      Option(e.getRequestHeaders.getFirst("Private-Token")).contains("secret") ||
        Option(e.getRequestHeaders.getFirst("Job-Token")).contains("secret")
    ): (base, requests) =>
      val devConfig = DevConfig(
        ApiProjectConfig("democompany-customer", VersionConfig("1.2.3"), Seq.empty, Seq.empty, Seq.empty, Seq(ModuleType.domain))
      ).withSbtConfig(SbtConfig(reposConfig = ReposConfig(
        credentials = Seq(RepoCredentials.PrivateToken("gitlab", "127.0.0.1", "GITLAB_TOKEN")),
        repos = Seq(RepoConfig.Gitlab("release", s"$base/api/v4/projects/42/packages/maven"))
      )))
      RepoCheck.verifyVersionFree("1.2.3", devConfig, "", Map("GITLAB_TOKEN" -> "secret").get)
      assertEquals(
        requests(),
        Seq(
          "/api/v4/projects/42",
          "/api/v4/projects/42/packages/maven/democompany/democompany-customer-domain/1.2.3/democompany-customer-domain-1.2.3.pom"
        )
      )
      val wrong = intercept[IllegalStateException]:
        RepoCheck.verifyVersionFree("1.2.3", devConfig, "", Map("GITLAB_TOKEN" -> "wrong").get, confirm = _ => false)
      assert(wrong.getMessage.contains("does not show"), wrong.getMessage)
      // no credentials at all: the check would run anonymously - it asks, and stops without a yes
      val anonymous = devConfig.withSbtConfig(SbtConfig(reposConfig = ReposConfig(
        repos = Seq(RepoConfig.Gitlab("release", s"$base/api/v4/projects/42/packages/maven"))
      )))
      val stopped   = intercept[IllegalStateException]:
        RepoCheck.verifyVersionFree("1.2.3", anonymous, "", _ => None, confirm = _ => false)
      assert(stopped.getMessage.contains("anonymously"), stopped.getMessage)
      // a pipeline: the job token is GitLab's own - the project is not probed
      val before = requests().size
      RepoCheck.verifyVersionFree("1.2.3", devConfig, "", Map("CI_JOB_TOKEN" -> "secret").get)
      assertEquals(requests().drop(before).size, 1)
      assert(requests().last.endsWith("-1.2.3.pom"), requests().last)

  /** The whole check for a project: the Artifactory repo of its DevConfig, the user/password
    * from the environment (as basic auth), the poms of its modules (the company as groupId,
    * `ProjectDef.org`), the suffix.
    */
  test("verifyVersionFree for a DevConfig - the URLs of its modules, the credentials, the result"):
    import orchescala.api.{ApiProjectConfig, ModuleType, VersionConfig}
    import orchescala.engine.config.{RepoConfig, ReposConfig}
    import orchescala.helper.util.{DevConfig, SbtConfig}
    val basic = java.util.Base64.getEncoder.encodeToString("me:secret".getBytes)
    withRepo(e => Option(e.getRequestHeaders.getFirst("Authorization")).contains(s"Basic $basic")): (base, requests) =>
      val devConfig = DevConfig(
        ApiProjectConfig("democompany-customer", VersionConfig("1.2.3"), Seq.empty, Seq.empty, Seq.empty, ModuleType.projectModules)
      ).withSbtConfig(SbtConfig(reposConfig = ReposConfig(repos = Seq(
        RepoConfig.Artifactory("release", base, "libs-release", "REPO_USER", "REPO_PWD")
      ))))
      val env       = Map("REPO_USER" -> "me", "REPO_PWD" -> "secret")
      RepoCheck.verifyVersionFree("1.2.3", devConfig, artifactSuffix = "", env.get)
      assertEquals(
        requests(),
        ModuleType.projectModules.map(m =>
          s"/libs-release/democompany/democompany-customer-$m/1.2.3/democompany-customer-$m-1.2.3.pom"
        )
      )
      // the company's suffix
      RepoCheck.verifyVersionFree("1.2.3", devConfig, artifactSuffix = "_3", env.get)
      assert(requests().last.endsWith("/democompany-customer-worker_3/1.2.3/democompany-customer-worker_3-1.2.3.pom"), requests().last)
      // wrong credentials stop it
      val refused = intercept[IllegalStateException]:
        RepoCheck.verifyVersionFree("1.2.3", devConfig, "", Map("REPO_USER" -> "me", "REPO_PWD" -> "wrong").get)
      assert(refused.getMessage.contains("refuses the credentials"), refused.getMessage)
      // missing environment variables stop it before any request
      val before  = requests().size
      intercept[IllegalStateException](RepoCheck.verifyVersionFree("1.2.3", devConfig, "", _ => None))
      assertEquals(requests().size, before)
      // a taken module
      val taken = intercept[IllegalStateException]:
        RepoCheck.verifyVersionFree("1.2.3-taken", devConfig, "", env.get)
      assert(taken.getMessage.contains("is in the repository already"), taken.getMessage)
      // after a failed upload: what is there
      val uploaded = RepoCheck.reportUploaded("1.2.3-taken", devConfig, "", env.get)
      assertEquals(uploaded.size, ModuleType.projectModules.size)
      assertEquals(RepoCheck.reportUploaded("1.2.3", devConfig, "", env.get), Seq.empty)
      assertEquals(RepoCheck.reportUploaded("1.2.3", devConfig, "", _ => None), Seq.empty) // never fails
    // an unreachable repository: one request, then it gives up
    locally:
      import orchescala.api.{ApiProjectConfig, ModuleType, VersionConfig}
      import orchescala.engine.config.{RepoConfig, ReposConfig}
      import orchescala.helper.util.{DevConfig, SbtConfig}
      val down    = DevConfig(
        ApiProjectConfig("democompany-customer", VersionConfig("1.2.3"), Seq.empty, Seq.empty, Seq.empty, ModuleType.projectModules)
      ).withSbtConfig(SbtConfig(reposConfig = ReposConfig(repos = Seq(RepoConfig.Gitlab("release", "http://127.0.0.1:1/repo")))))
      val started = System.nanoTime()
      assertEquals(RepoCheck.reportUploaded("1.2.3", down, "", _ => None), Seq.empty)
      assert((System.nanoTime() - started) / 1e6 < 3000, "gave up after the first unreachable pom")

end PublishHelperVersionFreeTest
