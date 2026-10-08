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
    val error = intercept[IllegalStateException](PublishHelper.verifyCleanWorkingTree(dir))
    assert(error.getMessage.contains("build.sbt"), error.getMessage)

  test("the edited CHANGELOG and untracked files are fine"):
    val dir = repo()
    os.write.over(dir / "CHANGELOG.md", "# Changelog\n## 1.1.0")
    os.write(dir / "notes.txt", "not tracked")
    PublishHelper.verifyCleanWorkingTree(dir)

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
    val runs = PublishHelper.sbtRuns(dockerProject = Some("worker"), build = Seq("api/run"))
    assertEquals(
      runs.build,
      Seq("sbt", "package", "packageSrc", "makePom", "worker / Docker / publishLocal", "api/run")
    )
    // the image first - its tag can be overwritten, the artifacts of a release can not
    assertEquals(runs.publish, Seq("sbt", "worker / Docker / publish", "publish"))

  test("without a docker image - and with sbt options"):
    val runs = PublishHelper.sbtRuns(dockerProject = None, sbtOptions = Seq("-J-Xmx3G"))
    assertEquals(runs.build, Seq("sbt", "-J-Xmx3G", "package", "packageSrc", "makePom"))
    assertEquals(runs.publish, Seq("sbt", "-J-Xmx3G", "publish"))

  test("the steps of a release: build, the docs, the upload, git - a snapshot only builds and uploads"):
    import PublishHelper.ReleaseStep.*
    assertEquals(
      PublishHelper.releaseSteps(isSnapshot = false, hasDocs = true),
      Seq(Build, UploadDocs, Upload, Git)
    )
    assertEquals(
      PublishHelper.releaseSteps(isSnapshot = false, hasDocs = false),
      Seq(Build, Upload, Git)
    )
    assertEquals(PublishHelper.releaseSteps(isSnapshot = true, hasDocs = true), Seq(Build, Upload))

  /** A release whose processes are recorded instead of run - `failing` throws; a failure is
    * recorded as `failed <step>`.
    */
  private def release(failing: Set[String] = Set.empty): (PublishHelper.ReleaseRun, () => Seq[String]) =
    val log  = collection.mutable.ListBuffer.empty[String]
    def step(name: String): Unit =
      log += name
      if failing(name) then throw IllegalStateException(s"$name failed")
    val runs = PublishHelper.sbtRuns(Some("worker"))
    val rel  = PublishHelper.ReleaseRun(
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
    rel.run(PublishHelper.releaseSteps(isSnapshot = false, hasDocs = true))
    assertEquals(log(), Seq("build", "docs", "upload", "git"))
    val (snapshot, snapshotLog) = release()
    snapshot.run(PublishHelper.releaseSteps(isSnapshot = true, hasDocs = true))
    assertEquals(snapshotLog(), Seq("build", "upload"))

  test("a failing build stops the release - nothing is uploaded"):
    val (rel, log) = release(failing = Set("build"))
    intercept[IllegalStateException]:
      rel.run(PublishHelper.releaseSteps(isSnapshot = false, hasDocs = true))
    assertEquals(log(), Seq("build", "failed Build"))

  test("failing docs stop the release - nothing is uploaded"):
    val (rel, log) = release(failing = Set("docs"))
    intercept[IllegalStateException]:
      rel.run(PublishHelper.releaseSteps(isSnapshot = false, hasDocs = true))
    assertEquals(log(), Seq("build", "docs", "failed UploadDocs"))

  test("a failing upload: the docs are on the webserver already, git does not run - what went out is reported"):
    val (rel, log) = release(failing = Set("upload"))
    intercept[IllegalStateException]:
      rel.run(PublishHelper.releaseSteps(isSnapshot = false, hasDocs = true))
    assertEquals(log(), Seq("build", "docs", "upload", "reported", "failed Upload"))

  test("the runs of a project and of the company project"):
    assertEquals(
      PublishHelper.projectRuns(hasWorkerApp = true).build,
      Seq("sbt", "-J-Xmx3G", "package", "packageSrc", "makePom", "worker / Docker / publishLocal", "api/run")
    )
    assertEquals(
      PublishHelper.projectRuns(hasWorkerApp = false).publish,
      Seq("sbt", "-J-Xmx3G", "publish")
    )
    assertEquals(
      PublishHelper.companyRuns(hasGateway = true).publish,
      Seq("sbt", "-J-Xmx3G", "gateway / Docker / publish", "publish")
    )
    assertEquals(
      PublishHelper.companyRuns(hasGateway = false).build,
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
    PublishHelper.verifyCleanWorkingTree(dir)
    // as publish does: armed with the clean tree, then the release rewrites the files
    val restore = PublishHelper.restoreForRetry(isSnapshot = false, dir)
    os.write.over(dir / "docs" / "Prozess Ü (1).md", "# v2 generated")
    os.remove(dir / "build.sbt") // a generator removed a file
    os.write(dir / "new.md", "added during the release")
    PublishHelper.replaceVersion("1.1.0", dir / "ProjectDef.scala")
    os.proc("git", "add", "ProjectDef.scala", "new.md").call(cwd = dir) // staged or not, even a new file
    intercept[IllegalStateException](PublishHelper.verifyCleanWorkingTree(dir))

    val runs = PublishHelper.sbtRuns(None)
    val rel  = PublishHelper.ReleaseRun(
      runs,
      uploadDocs = () => (),
      git = () => (),
      exec = _ => throw IllegalStateException("sbt failed"),
      onFailure = restore
    )
    intercept[IllegalStateException](rel.run(PublishHelper.releaseSteps(isSnapshot = false, hasDocs = true)))

    PublishHelper.verifyCleanWorkingTree(dir) // the next try starts clean
    assertEquals(os.read(dir / "ProjectDef.scala"), "version = \"1.0.0\"")
    assertEquals(os.read(dir / "docs" / "Prozess Ü (1).md"), "# v1")
    assertEquals(os.read(dir / "build.sbt"), "version := \"1.0.0\"")
    assert(os.exists(dir / "new.md")) // unstaged, kept as untracked
    assertEquals(os.read(dir / "CHANGELOG.md"), "# Changelog\n## 1.1.0")
    assert(os.exists(dir / "notes.txt"))

  test("a failing rewrite before the release restores too"):
    val dir     = repo()
    val restore = PublishHelper.restoreForRetry(isSnapshot = false, dir)
    val error   = intercept[IllegalStateException]:
      PublishHelper.restoring(restore):
        PublishHelper.replaceVersion("1.1.0", dir / "ProjectDef.scala")
        throw IllegalStateException("the api file is broken")
    assertEquals(error.getMessage, "the api file is broken")
    PublishHelper.verifyCleanWorkingTree(dir)

  test("an interrupt or a fatal error goes through without a restore"):
    def interrupted(error: Throwable): Seq[String] =
      val log  = collection.mutable.ListBuffer.empty[String]
      val runs = PublishHelper.sbtRuns(None)
      val rel  = PublishHelper.ReleaseRun(
        runs,
        uploadDocs = () => (),
        git = () => (),
        exec = _ => throw error,
        onFailure = step => log += s"failed $step"
      )
      // munit's intercept lets a fatal error through (and interrupts the thread) - caught by hand
      try rel.run(PublishHelper.releaseSteps(isSnapshot = true, hasDocs = false))
      catch case e: Throwable => assertEquals(e, error)
      Thread.interrupted() // clears the flag, should one have been set
      log.toSeq
    assertEquals(interrupted(InterruptedException("Ctrl-C")), Seq.empty)
    assertEquals(interrupted(OutOfMemoryError("sbt")), Seq.empty)
    assertEquals(interrupted(IllegalStateException("sbt failed")), Seq("failed Build"))

  test("with changes of yours in the tree the restore is not armed - whatever the caller checked"):
    val dir = repo()
    os.write.over(dir / "ProjectDef.scala", "version = \"1.0.0\" // my unfinished work")
    val restore = PublishHelper.restoreForRetry(isSnapshot = false, dir) // armed with a dirty tree
    PublishHelper.replaceVersion("1.1.0", dir / "ProjectDef.scala")
    restore(PublishHelper.ReleaseStep.Build)
    // nothing discarded - neither the rewritten version nor the unfinished work
    assertEquals(os.read(dir / "ProjectDef.scala").trim, "version = \"1.1.0\" // my unfinished work")

  /** Ctrl-C ends the JVM: the shutdown hook of the running step restores - it is registered
    * while the step runs and gone afterwards (a hook of a finished step would restore the
    * next try's work).
    */
  test("the shutdown hook of the running step restores it - and is gone once the step is done"):
    val hooks   = collection.mutable.Set.empty[Thread]
    val log     = collection.mutable.ListBuffer.empty[String]
    val runs    = PublishHelper.sbtRuns(None)
    var during  = Seq.empty[Thread]
    val rel     = PublishHelper.ReleaseRun(
      runs,
      uploadDocs = () => (),
      git = () => (),
      exec = cmd => if cmd == runs.build then during = hooks.toSeq,
      onFailure = step => log += s"restored $step",
      awaitChild = () => log += "waited for sbt",
      addShutdownHook = hooks += _,
      removeShutdownHook = hooks -= _
    )
    rel.run(PublishHelper.releaseSteps(isSnapshot = true, hasDocs = false))
    assertEquals(during.size, 1) // the hook of Build, while it ran
    assert(hooks.isEmpty)        // gone afterwards
    during.head.run()            // as the JVM would on Ctrl-C
    assertEquals(log.toSeq, Seq("waited for sbt", "restored Build"))

  test("the sbt child: a failing process throws, a running one is waited for"):
    intercept[IllegalStateException](PublishHelper.SbtChild.run(Seq("false")))
    PublishHelper.SbtChild.run(Seq("true"))
    PublishHelper.SbtChild.awaitExit() // nothing running - returns at once
    val sleeper = Thread(() => PublishHelper.SbtChild.run(Seq("sleep", "1")))
    sleeper.start()
    Thread.sleep(200)
    val started = System.nanoTime()
    PublishHelper.SbtChild.awaitExit()
    assert((System.nanoTime() - started) / 1e6 > 500, "waited for the child")
    sleeper.join()

  test("a failing restore does not hide the failure of the release"):
    val runs = PublishHelper.sbtRuns(None)
    val rel  = PublishHelper.ReleaseRun(
      runs,
      uploadDocs = () => (),
      git = () => (),
      exec = _ => throw IllegalStateException("sbt failed"),
      onFailure = _ => throw IllegalArgumentException("restore failed")
    )
    val error = intercept[IllegalStateException](rel.run(PublishHelper.releaseSteps(isSnapshot = true, hasDocs = false)))
    assertEquals(error.getSuppressed.toSeq.map(_.getMessage), Seq("restore failed"))

  test("a snapshot keeps its changes; after the git step nothing is restored"):
    val dir = repo()
    PublishHelper.replaceVersion("1.1.0-SNAPSHOT", dir / "ProjectDef.scala")
    PublishHelper.restoreForRetry(isSnapshot = true, dir)(PublishHelper.ReleaseStep.Build)
    assertEquals(os.read(dir / "ProjectDef.scala").trim, "version = \"1.1.0-SNAPSHOT\"")
    PublishHelper.restoreForRetry(isSnapshot = false, dir)(PublishHelper.ReleaseStep.Git)
    assertEquals(os.read(dir / "ProjectDef.scala").trim, "version = \"1.1.0-SNAPSHOT\"")

end PublishHelperRetryTest

class PublishHelperVersionFreeTest extends FunSuite:

  private val urls = PublishHelper.releaseArtifactUrls(
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
    PublishHelper.verifyVersionFree("1.2.3", urls, _ => 404)

  test("a taken version - also when only one module of a half-finished release is there"):
    val error = intercept[IllegalStateException]:
      PublishHelper.verifyVersionFree("1.2.3", urls, url => if url.contains("worker") then 200 else 404)
    assert(error.getMessage.contains("is in the repository already"), error.getMessage)
    assert(error.getMessage.contains("example-customer-worker"), error.getMessage)

  test("the company's artifacts carry the Scala suffix, a project's do not"):
    val company = PublishHelper.releaseArtifactUrls(
      "https://repo", "valiant", Seq("valiant-orchescala-domain_3"), "1.2.3"
    )
    assertEquals(company, Seq("https://repo/valiant/valiant-orchescala-domain_3/1.2.3/valiant-orchescala-domain_3-1.2.3.pom"))

  test("wrong credentials, a redirect and an unreachable repository stop the release"):
    val refused  = intercept[IllegalStateException](PublishHelper.verifyVersionFree("1.2.3", urls, _ => 401))
    assert(refused.getMessage.contains("refuses the credentials"), refused.getMessage)
    val redirect = intercept[IllegalStateException](PublishHelper.verifyVersionFree("1.2.3", urls, _ => 302))
    assert(redirect.getMessage.contains("redirects"), redirect.getMessage)
    val down     = intercept[IllegalStateException](PublishHelper.verifyVersionFree("1.2.3", urls, _ => 0))
    assert(down.getMessage.contains("not reachable"), down.getMessage)

  test("the artifact suffix comes from the build's Settings.scala"):
    val project = Seq("""  val scalaV = "3.7.4"""", "    crossPaths := false").mkString("\n")
    val company = Seq("""  val scalaV = "3.7.4"""", "    // crossPaths := false,").mkString("\n")
    assertEquals(PublishHelper.artifactSuffix(project), "")
    assertEquals(PublishHelper.artifactSuffix(company), "_3")
    assertEquals(PublishHelper.artifactSuffix("""val scalaV = "2.13.16""""), "_2")
    val error = intercept[IllegalStateException](PublishHelper.artifactSuffix("object Settings {}"))
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
      assertEquals(PublishHelper.curlStatus(config)(s"$base/repo/taken"), 200)
      assertEquals(PublishHelper.curlStatus(config)(s"$base/repo/missing"), 404)
      assertEquals(PublishHelper.curlStatus(config)(s"$base/repo/redirect"), 302)
      assertEquals(PublishHelper.curlStatus(Seq.empty)(s"$base/repo/taken"), 401)
    // nobody listens there - `000` becomes 0
    assertEquals(PublishHelper.curlStatus(Seq.empty)("http://127.0.0.1:1/repo"), 0)

  test("without curl: a clear message, no stack trace of a missing program"):
    val error = intercept[IllegalStateException]:
      PublishHelper.curlStatus(Seq.empty, curl = "/no/such/curl")("http://127.0.0.1:1/repo")
    assert(error.getMessage.contains("`/no/such/curl` is needed"), error.getMessage)

  test("a GitLab project registry: the project tells whether the token reads it"):
    val registry = "https://gitlab.example.com/api/v4/projects/42/packages/maven"
    assertEquals(PublishHelper.gitlabProjectUrl(registry), Some("https://gitlab.example.com/api/v4/projects/42"))
    assertEquals(PublishHelper.gitlabProjectUrl("https://gitlab.example.com/api/v4/groups/7/-/packages/maven"), None)
    PublishHelper.verifyGitlabCredentials(registry, _ => 200)
    val refused = intercept[IllegalStateException](PublishHelper.verifyGitlabCredentials(registry, _ => 404))
    assert(refused.getMessage.contains("GitLab refuses the credentials (404)"), refused.getMessage)
    // a group registry: a warning only
    PublishHelper.verifyGitlabCredentials("https://gitlab.example.com/api/v4/groups/7/-/packages/maven", _ => 404)

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
      PublishHelper.verifyVersionFree("1.2.3", devConfig, "", Map("GITLAB_TOKEN" -> "secret").get)
      assertEquals(
        requests(),
        Seq(
          "/api/v4/projects/42",
          "/api/v4/projects/42/packages/maven/democompany/democompany-customer-domain/1.2.3/democompany-customer-domain-1.2.3.pom"
        )
      )
      val wrong = intercept[IllegalStateException]:
        PublishHelper.verifyVersionFree("1.2.3", devConfig, "", Map("GITLAB_TOKEN" -> "wrong").get)
      assert(wrong.getMessage.contains("GitLab refuses the credentials"), wrong.getMessage)
      // a pipeline: the job token is GitLab's own - the project is not probed
      val before = requests().size
      PublishHelper.verifyVersionFree("1.2.3", devConfig, "", Map("CI_JOB_TOKEN" -> "secret").get)
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
      PublishHelper.verifyVersionFree("1.2.3", devConfig, artifactSuffix = "", env.get)
      assertEquals(
        requests(),
        ModuleType.projectModules.map(m =>
          s"/libs-release/democompany/democompany-customer-$m/1.2.3/democompany-customer-$m-1.2.3.pom"
        )
      )
      // the company's suffix
      PublishHelper.verifyVersionFree("1.2.3", devConfig, artifactSuffix = "_3", env.get)
      assert(requests().last.endsWith("/democompany-customer-worker_3/1.2.3/democompany-customer-worker_3-1.2.3.pom"), requests().last)
      // wrong credentials stop it
      val refused = intercept[IllegalStateException]:
        PublishHelper.verifyVersionFree("1.2.3", devConfig, "", Map("REPO_USER" -> "me", "REPO_PWD" -> "wrong").get)
      assert(refused.getMessage.contains("refuses the credentials"), refused.getMessage)
      // missing environment variables stop it before any request
      val before  = requests().size
      intercept[IllegalArgumentException](PublishHelper.verifyVersionFree("1.2.3", devConfig, "", _ => None))
      assertEquals(requests().size, before)
      // a taken module
      val taken = intercept[IllegalStateException]:
        PublishHelper.verifyVersionFree("1.2.3-taken", devConfig, "", env.get)
      assert(taken.getMessage.contains("is in the repository already"), taken.getMessage)
      // after a failed upload: what is there
      val uploaded = PublishHelper.reportUploaded("1.2.3-taken", devConfig, "", env.get)
      assertEquals(uploaded.size, ModuleType.projectModules.size)
      assertEquals(PublishHelper.reportUploaded("1.2.3", devConfig, "", env.get), Seq.empty)
      assertEquals(PublishHelper.reportUploaded("1.2.3", devConfig, "", _ => None), Seq.empty) // never fails

end PublishHelperVersionFreeTest
