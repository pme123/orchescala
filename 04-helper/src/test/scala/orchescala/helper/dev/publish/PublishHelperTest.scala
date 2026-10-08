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
      Seq("sbt", "publishLocal", "worker / Docker / publishLocal", "api/run")
    )
    // the image first - its tag can be overwritten, the artifacts of a release can not
    assertEquals(runs.publish, Seq("sbt", "worker / Docker / publish", "publish"))

  test("without a docker image - and with sbt options"):
    val runs = PublishHelper.sbtRuns(dockerProject = None, sbtOptions = Seq("-J-Xmx3G"))
    assertEquals(runs.build, Seq("sbt", "-J-Xmx3G", "publishLocal"))
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

end PublishHelperSbtRunsTest
