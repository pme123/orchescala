package orchescala.helper.dev.publish

import orchescala.api.ApiConfig
import orchescala.helper.util.{DevConfig, Helpers, PublishConfig}

case class PublishHelper()(using
    devConfig: DevConfig,
    apiConfig: ApiConfig
) extends Helpers:

  import PublishHelper.*

  def publish(version: String): Unit =
    println(s"Publishing ${apiConfig.companyName} Package: $version")
    val isSnapshot = version.contains("-")
    if !isSnapshot then
      verifyCleanWorkingTree()
      verifyNextVersion(version)
    verify(version)
    if !isSnapshot then verifyVersionFree(version)
    pushDevelop()
    setApiVersion(version)
    replaceVersion(version)

    lazy val workerAppFile: os.Path =
      workDir / "03-worker" / "src" / "main" / "scala" /
        devConfig.projectPath / "worker" / "WorkerApp.scala"
    println(s"workerAppFile ${os.exists(workerAppFile)}: $workerAppFile")
    ReleaseRun(
      projectRuns(hasWorkerApp = os.exists(workerAppFile)),
      uploadDocs = () => publishToWebserver(),
      git = () => git(version, replaceVersion),
      onFailure = restoreForRetry(isSnapshot)
    ).run(releaseSteps(isSnapshot, hasDocs = devConfig.publishConfig.nonEmpty))
  end publish

  /** [[PublishHelper.verifyVersionFree]] for the modules of this project. */
  private def verifyVersionFree(version: String): Unit =
    PublishHelper.verifyVersionFree(version, devConfig, artifactSuffix(workDir / "project" / "Settings.scala"))

  private lazy val apiFile: os.Path =
    workDir / "03-api" / "src" / "main" / "scala" / devConfig.projectPath / "api" / "ApiProjectCreator.scala"

  private def setApiVersion(newVersion: String): Unit =
    if apiFile.toIO.exists() then
      val apiFileStr = os.read(apiFile)

      val pattern     = """ version\s*=\s*"(\d+\..*\d+(-.+)?)""""
      val updatedFile =
        apiFileStr.replaceFirst(pattern, s""" version = "$newVersion"""")

      os.write.over(apiFile, updatedFile)

  private def replaceVersion(newVersion: String): Unit =
    PublishHelper.replaceVersion(newVersion, projectFile)
    PublishHelper.replaceVersion(newVersion, apiConfig.projectConfPath)
  end replaceVersion

  private def publishToWebserver(): Unit =
    // push it to Documentation Webserver
    // the site itself (index, catalogs, …) is the company's publishDocs - a project only
    // publishes its own folder (/site/<company>/<project>/)
    devConfig.publishConfig.foreach: config =>
      ProjectWebDAV(devConfig.projectName, apiConfig, config).upload()

end PublishHelper

object PublishHelper extends Helpers:
  val projectFile: os.Path = workDir / "project" / "ProjectDef.scala"

  /** A release commits all changes (`git commit -a`): its own (versions, generated docs) - and any
    * other change of the working tree, e.g. unfinished work. So it must be clean before - only the
    * CHANGELOG may be edited (untracked files are not committed).
    */
  def verifyCleanWorkingTree(repo: os.Path = workDir): Unit =
    val changed = changedTrackedFiles(repo)
    if changed.nonEmpty then
      throw IllegalStateException(
        s"Uncommitted changes - commit or stash them before a release:\n - ${changed.mkString("\n - ")}"
      )
  end verifyCleanWorkingTree

  /** The tracked files that differ from HEAD (staged or not) - without the CHANGELOG, the one
    * file a release edits. NUL-separated, so a path with spaces or special characters comes
    * as it is (`--porcelain` quotes them); no rename detection, so a path is always a path.
    */
  private def changedTrackedFiles(repo: os.Path): Seq[String] =
    os.proc("git", "diff", "--name-only", "-z", "--no-renames", "HEAD").call(cwd = repo)
      .out.text().split('\u0000').toSeq
      .filter(_.nonEmpty)
      .filterNot(_ == "CHANGELOG.md")

  /** A failed release leaves its changes in the tracked files (the versions, generated docs) -
    * the next try with the same version stopped at [[verifyCleanWorkingTree]]. So they are
    * restored from HEAD (the index too); the CHANGELOG and untracked files stay as they are.
    */
  def restoreWorkingTree(repo: os.Path = workDir): Unit =
    val changed = changedTrackedFiles(repo)
    if changed.nonEmpty then
      println(s"Restoring the working tree for the next try:\n - ${changed.mkString("\n - ")}")
      os.proc("git" +: "checkout" +: "HEAD" +: "--" +: changed).call(cwd = repo)
  end restoreWorkingTree

  /** [[restoreWorkingTree]] when a release fails before its git step - after it, the version is
    * uploaded and committed, nothing to retry. A snapshot keeps its changes as before.
    */
  def restoreForRetry(isSnapshot: Boolean, repo: os.Path = workDir): ReleaseStep => Unit =
    step => if !isSnapshot && step != ReleaseStep.Git then restoreWorkingTree(repo)

  private val Release = """^v?(\d+)\.(\d+)\.(\d+)$""".r

  /** Why `newVersion` does not follow the releases (`tags`, e.g. `v1.9.19`) - None if it does: the
    * next patch of its `Major.Minor` line, else the next minor (`.0`) or major (`.0.0`) after the
    * highest release. A typo (1.19.20 for 1.9.20) was released, its docker image deployed as missing.
    */
  def nextVersionProblem(newVersion: String, tags: Seq[String]): Option[String] =
    val releases = tags.collect { case Release(ma, mi, pa) => (ma.toInt, mi.toInt, pa.toInt) }
    val show     = (v: (Int, Int, Int)) => s"${v._1}.${v._2}.${v._3}"
    newVersion match
      case Release(ma, mi, pa) if releases.nonEmpty =>
        val version   = (ma.toInt, mi.toInt, pa.toInt)
        val highest   = releases.max
        val nextMinor = (highest._1, highest._2 + 1, 0)
        val nextMajor = (highest._1 + 1, 0, 0)
        // a patch of an existing line (also an older one, e.g. 1.9.20 after 1.10.0)
        val nextPatch = releases
          .filter(r => r._1 == version._1 && r._2 == version._2)
          .maxOption
          .map(r => r.copy(_3 = r._3 + 1))
        val accepted  = nextPatch.map(Seq(_)).getOrElse(Seq(nextMinor, nextMajor))
        Option.unless(accepted.contains(version)):
          val suggestions =
            (nextPatch.toSeq ++ Seq(highest.copy(_3 = highest._3 + 1), nextMinor, nextMajor)).distinct
          s"Version $newVersion does not follow the releases (last: ${show(highest)}) - " +
            s"expected ${suggestions.map(show).mkString(", ")}"
      case _                                       => None
  end nextVersionProblem

  /** Checks [[nextVersionProblem]] against the release tags (fetched first) - asks before going on. */
  def verifyNextVersion(
      newVersion: String,
      repo: os.Path = workDir,
      confirm: String => Boolean = askToContinue
  ): Unit =
    scala.util.Try(os.proc("git", "fetch", "--tags", "--quiet").call(cwd = repo))
    val tags = os.proc("git", "tag", "--list").call(cwd = repo).out.lines()
    nextVersionProblem(newVersion, tags).foreach: problem =>
      if !confirm(problem) then
        throw IllegalArgumentException(s"$problem - release stopped.")
  end verifyNextVersion

  private def askToContinue(problem: String): Boolean =
    println(s"$problem\nContinue anyway? [y/N]")
    Option(scala.io.StdIn.readLine()).exists(_.trim.equalsIgnoreCase("y"))

  /** All checks that need no configuration - run them BEFORE the `DevConfig`/`ApiConfig` are
    * evaluated, as these look up the dependency versions in the repositories (`cs complete-dep`).
    */
  def verify(newVersion: String): Unit =
    verifySnapshots()
    verifyChangelog(newVersion)
    verifyVersion(newVersion)
  end verify

  /** The steps of a release, in their order - see [[releaseSteps]]. */
  enum ReleaseStep:
    case Build, UploadDocs, Upload, Git

  /** A release version is immutable in the repository (Artifactory): when the docker build or
    * the docs failed after `sbt publish`, the version was taken and the next try needed a new
    * one. So everything that can fail at build time runs first ([[SbtRuns]]), the upload
    * comes last - a failed release is run again with the same version.
    *
    * The docs go to the webserver BEFORE the upload: the webserver takes a version again, the
    * repository does not. So a release that fails at the upload is repeated with the same
    * version - its docs are simply uploaded again, while a release that failed at the docs
    * after the upload could never be repeated.
    */
  def releaseSteps(isSnapshot: Boolean, hasDocs: Boolean): Seq[ReleaseStep] =
    import ReleaseStep.*
    if isSnapshot then Seq(Build, Upload)
    else Seq(Build) ++ Option.when(hasDocs)(UploadDocs) ++ Seq(Upload, Git)
  end releaseSteps

  /** The suffix of the artifacts of a build - from its `project/Settings.scala`: none with
    * `crossPaths := false` (a project), else `_<Scala major>` of its `scalaV` (the company
    * project: `_3`). Fails without the `scalaV` - a guessed suffix made the check pass as
    * "free" on the wrong URL.
    */
  def artifactSuffix(settings: os.Path): String = artifactSuffix(os.read(settings), settings.toString)

  def artifactSuffix(settings: String, name: String = "project/Settings.scala"): String =
    val crossPathsOff = settings.linesIterator.map(_.trim).exists(_.startsWith("crossPaths := false"))
    val ScalaV        = """val scalaV\s*=\s*"(\d+)\.[^"]*"""".r
    if crossPathsOff then ""
    else
      ScalaV.findFirstMatchIn(settings).map(m => s"_${m.group(1)}")
        .getOrElse(throw IllegalStateException(s"No `val scalaV = \"...\"` in $name - the artifact suffix is unknown."))
  end artifactSuffix

  /** The pom of each module in the release repo - what `publish` uploads: `publishMavenStyle`,
    * the `organization` (ProjectDef.org) as path, the module's `name` plus `artifactSuffix`
    * (`_3` unless `crossPaths := false`).
    */
  def releaseArtifactUrls(repoUrl: String, org: String, artifacts: Seq[String], version: String)
      : Seq[String] =
    artifacts.map(a => s"$repoUrl/${org.replace('.', '/')}/$a/$version/$a-$version.pom")

  /** Before anything is built or uploaded: is `version` free in the release repo - and are the
    * credentials right? A taken release version fails at the upload, after the docs and the
    * docker image went out (the image tag of the existing release overwritten); wrong
    * credentials failed there too. `status` is the HTTP status of a HEAD request - 404 is
    * free, 200 taken, 401/403 the credentials (Artifactory - GitLab answers 404 for a project
    * the token may not read, so a wrong token passes here and fails at the upload, as
    * before), a redirect is not followed (the token would go to the other host).
    */
  def verifyVersionFree(version: String, urls: Seq[String], status: String => Int): Unit =
    urls.foreach: url =>
      val code = status(url)
      println(s"  $code $url")
      code match
        case 404                     => ()
        case 200                     =>
          throw IllegalStateException(
            s"Version $version is in the repository already: $url - remove it there, or release the next version."
          )
        case 401 | 403               =>
          throw IllegalStateException(
            s"The repository refuses the credentials ($code): $url - check the environment variables of the repository."
          )
        case 301 | 302 | 307 | 308   =>
          throw IllegalStateException(
            s"The repository redirects ($code): $url - configure the final address of the repository."
          )
        case other                   =>
          throw IllegalStateException(s"The repository is not reachable ($other): $url")
  end verifyVersionFree

  /** [[verifyVersionFree]] against the release repo of `devConfig` for every module of the
    * project (a module that is never published is simply not there). Nothing to check with
    * the dummy repo.
    */
  def verifyVersionFree(
      version: String,
      devConfig: DevConfig,
      artifactSuffix: String,
      env: String => Option[String] = sys.env.get
  ): Unit =
    val repos = devConfig.sbtConfig.reposConfig
    repos.releaseRepo.foreach: repo =>
      val config = repos.releaseRepoCurlConfig(env).fold(msg => throw IllegalArgumentException(msg), identity)
      val urls   = releaseArtifactUrls(
        repo.repoUrl,
        devConfig.companyName,
        devConfig.apiProjectConfig.modules.map(m => s"${devConfig.projectName}-$m$artifactSuffix"),
        version
      )
      println(s"Checking that $version is free in ${repo.repoUrl} ...")
      verifyVersionFree(version, urls, curlStatus(config))
  end verifyVersionFree

  /** The HTTP status of a HEAD request - 0 if the server is not reachable (or not within 30
    * seconds). No redirect is followed: curl keeps a custom header (the GitLab token) on a
    * redirect to another host. `config` are the lines of a curl config (the credentials).
    */
  def curlStatus(config: Seq[String])(url: String): Int =
    os.proc(
      "curl", "--silent", "--head", "--connect-timeout", "10", "--max-time", "30",
      "--output", "/dev/null", "--write-out", "%{http_code}", "--config", "-", url
    ).call(check = false, stdin = config.mkString("", "\n", "\n"))
      .out.text().trim.toIntOption.getOrElse(0)

  /** The sbt runs of a project - the docs (`api/run`) come with the build. */
  def projectRuns(hasWorkerApp: Boolean): SbtRuns =
    sbtRuns(Option.when(hasWorkerApp)("worker"), build = Seq("api/run"), sbtOptions = Seq("-J-Xmx3G"))

  /** The sbt runs of the company project - the gateway is its docker image. */
  def companyRuns(hasGateway: Boolean): SbtRuns =
    sbtRuns(Option.when(hasGateway)("gateway"), sbtOptions = Seq("-J-Xmx3G"))

  /** The two sbt runs of a release.
    *
    * `build` is where the build may fail: every module is compiled and packaged as `publish`
    * packages it (the jar, the sources, the pom - `publishLocal` would do the same, but it
    * writes the release version to `~/.ivy2/local`, where it shadows the repository), the
    * docker image is built (`Docker / publishLocal`), the docs are generated. `publish`
    * repeats the packaging (the compiler and docker reuse their caches) and uploads - what is
    * left to fail there is the upload itself (credentials, network, a taken version). The
    * docker image is pushed before the artifacts - its tag can be overwritten, the artifacts
    * can not.
    */
  case class SbtRuns(build: Seq[String], publish: Seq[String])

  def sbtRuns(
      dockerProject: Option[String],
      build: Seq[String] = Seq.empty,
      sbtOptions: Seq[String] = Seq.empty
  ): SbtRuns =
    val sbt = "sbt" +: sbtOptions
    SbtRuns(
      build = sbt ++ Seq("package", "packageSrc", "makePom") ++
        dockerProject.map(p => s"$p / Docker / publishLocal") ++ build,
      publish = sbt ++ dockerProject.map(p => s"$p / Docker / publish") :+ "publish"
    )
  end sbtRuns

  /** Runs the steps of a release - a failing step throws and stops the release there. The
    * sbt processes (`exec`) are replaced in the tests.
    */
  case class ReleaseRun(
      runs: SbtRuns,
      uploadDocs: () => Unit,
      git: () => Unit,
      exec: Seq[String] => Unit = cmd => os.proc(cmd).callOnConsole(),
      // called with the failed step before the failure is rethrown - see restoreForRetry
      onFailure: ReleaseStep => Unit = _ => ()
  ):
    def run(steps: Seq[ReleaseStep]): Unit =
      steps.foreach: step =>
        try run(step)
        catch
          case e: Throwable =>
            if step == ReleaseStep.Upload then
              println(
                "The upload failed: the docker image (if any) is pushed already - the next try overwrites " +
                  "its tag; the modules `publish` uploaded before it failed are in the repository - remove " +
                  "the version there before the next try."
              )
            // the failure of the release stays the error - a failing restore is added to it
            try onFailure(step)
            catch case restore: Throwable => e.addSuppressed(restore)
            throw e

    private def run(step: ReleaseStep): Unit =
      step match
        case ReleaseStep.Build      =>
          println(s"SBT build: ${runs.build.mkString(" ")}")
          exec(runs.build)
        case ReleaseStep.UploadDocs => uploadDocs()
        case ReleaseStep.Upload     =>
          println(s"SBT publish: ${runs.publish.mkString(" ")}")
          exec(runs.publish)
        case ReleaseStep.Git        => git()
  end ReleaseRun

  def verifyVersion(newVersion: String): Unit =
    val releaseVersion = """^(\d+)\.(\d+)\.(\d+)(-.*)?$"""
    if !newVersion.matches(releaseVersion) then
      throw new IllegalArgumentException(
        "Your Version has not the expected format (2.1.2(-SNAPSHOT))"
      )
  end verifyVersion

  def verifyChangelog(newVersion: String): Unit =
    // ssh remotes are turned into https ones by ChangeLogUpdater.repositoryWebAddress
    ChangeLogUpdater.verifyChangelog(newVersion)

  def verifySnapshots(): Unit =
    hasSnapshots("Settings")
    hasSnapshots("ProjectDef")

  private def hasSnapshots(fileName: String): Unit =
    if os.read.lines(os.pwd / "project" / s"$fileName.scala")
        .exists(l => l.contains("-SNAPSHOT") && !l.contains("val version ="))
    then
      throw new IllegalArgumentException(
        s"There are SNAPSHOT dependencies in `project/$fileName.scala`"
      )

    // as projectUpdate for reference creation gets the newest changes from remote
  def pushDevelop(): Unit                          =
    os.proc("git", "push").callOnConsole()

  def replaceVersion(newVersion: String, versionFile: os.Path): Unit =
    val versionFileStr = os.read(versionFile)

    val regexPattern = """version = "(\d+\.\d+\.\d+(-.+)?)""""
    val updatedFile  = versionFileStr
      .replaceAll(regexPattern, s"""version = "$newVersion"""") + "\n"

    os.write.over(versionFile, updatedFile)
  end replaceVersion

  def git(version: String, replaceVersion: String => Unit): Unit =
    val branch  = "develop"
    os.proc("git", "fetch", "--all").callOnConsole()
    os.proc("git", "commit", "-a", "-m", s"Released Version $version")
      .callOnConsole()
    os.proc("git", "tag", "-a", "--no-sign", s"v$version", "-m", s"Version $version")
      .callOnConsole()
    os.proc("git", "checkout", "master").callOnConsole()
    os.proc("git", "merge", branch).callOnConsole()
    // the new tag only - `--tags` pushed every local tag
    os.proc("git", "push", "origin", s"v$version").callOnConsole()
    os.proc("git", "checkout", branch).callOnConsole()
    val Pattern = """^(\d+)\.(\d+)\.(\d+)$""".r

    val newVersion = version match
      case Pattern(major, minor, _) =>
        s"$major.${minor.toInt + 1}.0-SNAPSHOT"
    replaceVersion(newVersion)

    os.proc("git", "commit", "-a", "-m", s"Init new Version $newVersion")
      .callOnConsole()
    // the two branches of the release - `--all` pushed every local branch (unfinished work too)
    os.proc("git", "push", "origin", "master", branch).callOnConsole()
    println(s"Published Version: $version")
  end git

end PublishHelper
