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
      onFailure = failed => log += s"failed $failed"
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

  test("a failing upload: the docs are on the webserver already, git does not run"):
    val (rel, log) = release(failing = Set("upload"))
    intercept[IllegalStateException]:
      rel.run(PublishHelper.releaseSteps(isSnapshot = false, hasDocs = true))
    assertEquals(log(), Seq("build", "docs", "upload", "failed Upload"))

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
    os.write.over(dir / "docs" / "Prozess Ü (1).md", "# v2 generated")
    PublishHelper.replaceVersion("1.1.0", dir / "ProjectDef.scala")
    os.proc("git", "add", "ProjectDef.scala").call(cwd = dir) // staged or not
    intercept[IllegalStateException](PublishHelper.verifyCleanWorkingTree(dir))

    val runs = PublishHelper.sbtRuns(None)
    val rel  = PublishHelper.ReleaseRun(
      runs,
      uploadDocs = () => (),
      git = () => (),
      exec = _ => throw IllegalStateException("sbt failed"),
      onFailure = PublishHelper.restoreForRetry(isSnapshot = false, dir)
    )
    intercept[IllegalStateException](rel.run(PublishHelper.releaseSteps(isSnapshot = false, hasDocs = true)))

    PublishHelper.verifyCleanWorkingTree(dir) // the next try starts clean
    assertEquals(os.read(dir / "ProjectDef.scala"), "version = \"1.0.0\"")
    assertEquals(os.read(dir / "docs" / "Prozess Ü (1).md"), "# v1")
    assertEquals(os.read(dir / "CHANGELOG.md"), "# Changelog\n## 1.1.0")
    assert(os.exists(dir / "notes.txt"))

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
          else if path.contains("taken") then 200
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

end PublishHelperVersionFreeTest
