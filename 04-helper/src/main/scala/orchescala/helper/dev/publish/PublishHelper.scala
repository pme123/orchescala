package orchescala.helper.dev.publish

import orchescala.api.ApiConfig
import orchescala.helper.util.{DevConfig, Helpers, PublishConfig}

case class PublishHelper()(using
    devConfig: DevConfig,
    apiConfig: ApiConfig
) extends Helpers:

  import PublishHelper.*
  import RepoCheck.{artifactSuffix as settingsSuffix, reportUploaded, verifyVersionFree as versionFree}
  import WorkingTree.*

  def publish(version: String): Unit =
    println(s"Publishing ${apiConfig.companyName} Package: $version")
    val isSnapshot = version.contains("-")
    if !isSnapshot then
      verifyCleanWorkingTree()
      verifyNextVersion(version)
    verify(version)
    if !isSnapshot then verifyVersionFree(version)
    pushDevelop()
    // armed now, with the clean tree - right before the versions are rewritten
    val restore    = restoreForRetry(isSnapshot)
    restoring(restore):
      setApiVersion(version)
      replaceVersion(version)

    lazy val workerAppFile: os.Path =
      workDir / "03-worker" / "src" / "main" / "scala" /
        devConfig.projectPath / "worker" / "WorkerApp.scala"
    println(s"workerAppFile ${os.exists(workerAppFile)}: $workerAppFile")
    ReleaseRun(
      SbtRuns.project(hasWorkerApp = os.exists(workerAppFile)),
      uploadDocs = () => publishToWebserver(),
      git = () => git(version, replaceVersion),
      onFailure = restore,
      afterFailedUpload = () => reportUploaded(version, devConfig, artifactSuffix)
    ).run(ReleaseRun.steps(isSnapshot, hasDocs = devConfig.publishConfig.nonEmpty))
  end publish

  private lazy val artifactSuffix: String =
    settingsSuffix(workDir / "project" / "Settings.scala")

  /** [[RepoCheck.verifyVersionFree]] for the modules of this project. */
  private def verifyVersionFree(version: String): Unit =
    versionFree(version, devConfig, artifactSuffix)

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
      confirm: String => Boolean = askToContinue,
      warn: String => Unit = println
  ): Unit =
    // offline, or without access: the local tags may be behind the releases
    scala.util.Try(os.proc("git", "fetch", "--tags", "--quiet").call(cwd = repo, stderr = os.Pipe))
      .failed.foreach: e =>
        val reason = Option(e.getMessage).flatMap(_.linesIterator.nextOption()).getOrElse(e.toString)
        warn(s"WARNING: could not fetch the tags - the version is checked against the local tags only: $reason")
    val tags = os.proc("git", "tag", "--list").call(cwd = repo).out.lines()
    nextVersionProblem(newVersion, tags).foreach: problem =>
      if !confirm(problem) then
        throw IllegalArgumentException(s"$problem - release stopped.")
  end verifyNextVersion

  def askToContinue(problem: String): Boolean =
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
