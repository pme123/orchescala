package orchescala.helper.dev.publish

import orchescala.api.ApiConfig
import orchescala.engine.config.RepoConfig
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
      projectRuns(hasWorkerApp = os.exists(workerAppFile)),
      uploadDocs = () => publishToWebserver(),
      git = () => git(version, replaceVersion),
      onFailure = restore,
      afterFailedUpload = () => reportUploaded(version, devConfig, artifactSuffix)
    ).run(releaseSteps(isSnapshot, hasDocs = devConfig.publishConfig.nonEmpty))
  end publish

  private lazy val artifactSuffix: String =
    PublishHelper.artifactSuffix(workDir / "project" / "Settings.scala")

  /** [[PublishHelper.verifyVersionFree]] for the modules of this project. */
  private def verifyVersionFree(version: String): Unit =
    PublishHelper.verifyVersionFree(version, devConfig, artifactSuffix)

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
    * `filter`: git's `--diff-filter`, e.g. `A` for the files added to the index only.
    */
  private def changedTrackedFiles(repo: os.Path, filter: Option[String] = None): Seq[String] =
    os.proc(
      "git", "diff", "--name-only", "-z", "--no-renames", filter.map(f => s"--diff-filter=$f"), "HEAD"
    ).call(cwd = repo)
      .out.text().split('\u0000').toSeq
      .filter(_.nonEmpty)
      .filterNot(_ == "CHANGELOG.md")

  /** A failed release leaves its changes in the tracked files (the versions, generated docs) -
    * the next try with the same version stopped at [[verifyCleanWorkingTree]]. So they are
    * restored from HEAD (the index too); a file added to the index only (not in HEAD) is
    * unstaged and stays as untracked; the CHANGELOG and untracked files stay as they are.
    */
  def restoreWorkingTree(repo: os.Path = workDir): Unit =
    val changed = changedTrackedFiles(repo)
    if changed.nonEmpty then
      println(s"Restoring the working tree for the next try:\n - ${changed.mkString("\n - ")}")
      val added  = changedTrackedFiles(repo, filter = Some("A"))
      val inHead = changed.diff(added)
      if added.nonEmpty then
        os.proc("git" +: "rm" +: "--quiet" +: "--force" +: "--cached" +: "--" +: added).call(cwd = repo)
      if inHead.nonEmpty then
        os.proc("git" +: "checkout" +: "HEAD" +: "--" +: inHead).call(cwd = repo)
  end restoreWorkingTree

  /** `body` with the restore of a failed release - for the changes made before the
    * [[ReleaseRun]] (the versions). A fatal error goes through without a restore.
    */
  def restoring[T](restore: ReleaseStep => Unit)(body: => T): T =
    try body
    catch
      case scala.util.control.NonFatal(e) =>
        try restore(ReleaseStep.Build)
        catch case scala.util.control.NonFatal(r) => e.addSuppressed(r)
        throw e

  /** [[restoreWorkingTree]] when a release fails before its git step - after it, the version is
    * uploaded and committed, nothing to retry. A snapshot keeps its changes as before.
    *
    * The restore discards changes - so it is armed only when the tree is clean NOW (as
    * [[verifyCleanWorkingTree]] guarantees for a release): with changes of yours in the tree,
    * nothing is restored, whatever the caller checked.
    */
  def restoreForRetry(
      isSnapshot: Boolean,
      repo: os.Path = workDir,
      restore: os.Path => Unit = restoreWorkingTree(_)
  ): ReleaseStep => Unit =
    val changesBefore = if isSnapshot then Seq.empty else changedTrackedFiles(repo)
    // once only: on Ctrl-C the failing sbt run AND the shutdown hook ask for it - the second
    // waits for the first (the JVM ends with the hook) and finds it done
    val lock          = Object()
    var done          = false
    step =>
      if !isSnapshot && step != ReleaseStep.Git then
        lock.synchronized:
          if done then ()
          else if changesBefore.nonEmpty then
            println(
              s"Not restoring the working tree - it had changes before the release:\n - ${changesBefore.mkString("\n - ")}"
            )
          else
            done = true
            restore(repo)
  end restoreForRetry

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
        warn(s"WARNING: could not fetch the tags - the version is checked against the local tags only: ${e.getMessage.linesIterator.next()}")
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
      env: String => Option[String] = sys.env.get,
      confirm: String => Boolean = askToContinue
  ): Unit =
    val repos = devConfig.sbtConfig.reposConfig
    repos.releaseRepo.foreach: repo =>
      val config = repos.releaseRepoCurlConfig(env).fold(msg => throw IllegalArgumentException(msg), identity)
      val status = curlStatus(config)
      repo match
        case _: RepoConfig.Gitlab if config.isEmpty                    =>
          println(
            "WARNING: no credentials for the GitLab repository - the check runs anonymously, " +
              "a private package reads as free."
          )
        // the job token of a pipeline is GitLab's own - nothing to probe (and the project
        // endpoint is not meant for it); a token of a developer is probed
        case gitlab: RepoConfig.Gitlab if env("CI_JOB_TOKEN").isEmpty =>
          verifyGitlabCredentials(gitlab.repoUrl, status, confirm)
        case _                                                         => ()
      println(s"Checking that $version is free in ${repo.repoUrl} ...")
      verifyVersionFree(version, releaseUrls(devConfig, version, artifactSuffix, repo), status)
  end verifyVersionFree

  /** The poms `publish` uploads for `version` - every module of the project (a module that
    * is never published is simply not there), named `<project>-<module><suffix>` under the
    * company (the `organization`).
    */
  def releaseUrls(devConfig: DevConfig, version: String, artifactSuffix: String, repo: RepoConfig)
      : Seq[String] =
    releaseArtifactUrls(
      repo.repoUrl,
      devConfig.companyName,
      devConfig.apiProjectConfig.modules.map(m => s"${devConfig.projectName}-$m$artifactSuffix"),
      version
    )

  /** After a failed upload: which poms of `version` are in the release repo now - so the
    * console names what went out. Never fails (it runs in a failure handler).
    */
  def reportUploaded(
      version: String,
      devConfig: DevConfig,
      artifactSuffix: String,
      env: String => Option[String] = sys.env.get
  ): Seq[String] =
    val repos = devConfig.sbtConfig.reposConfig
    try
      repos.releaseRepo.toSeq.flatMap: repo =>
        val config = repos.releaseRepoCurlConfig(env).getOrElse(Seq.empty)
        // best effort, in a failure handler: 5 seconds per pom, and no more once the repo is unreachable
        val status = curlStatus(config, timeoutSeconds = 5)
        val codes  = releaseUrls(devConfig, version, artifactSuffix, repo).iterator
          .map(url => url -> status(url))
          .span((_, code) => code != 0) match
          case (reachable, rest) => reachable.toSeq ++ rest.take(1).toSeq
        val uploaded = codes.collect { case (url, 200) => url }
        if codes.exists(_._2 == 0) then println(s"${repo.repoUrl} is not reachable - what was uploaded is unknown.")
        else if uploaded.isEmpty then println(s"Nothing of $version is in ${repo.repoUrl}.")
        else println(s"Uploaded already - remove them there before the next try:\n - ${uploaded.mkString("\n - ")}")
        uploaded
    catch
      case scala.util.control.NonFatal(e) =>
        println(s"Could not look up what was uploaded: ${e.getMessage}")
        Seq.empty
  end reportUploaded

  /** The project of a GitLab maven registry (`.../api/v4/projects/<id>/packages/maven`) - the
    * endpoint that tells whether the token may read it. None for another registry (a group's).
    */
  def gitlabProjectUrl(repoUrl: String): Option[String] =
    val Project = """^(.*/api/v4/projects/[^/]+)/packages/maven/?$""".r
    repoUrl match
      case Project(project) => Some(project)
      case _                => None

  /** GitLab answers 404 for a package the token may not read - so a wrong token looked like a
    * free version. The project itself answers 200 with a token that reads it - checked first.
    * A registry that is not a project's (a group's) can not be checked: the release goes on
    * only when confirmed - a wrong token fails at the upload, after the docs and the image.
    */
  def verifyGitlabCredentials(
      repoUrl: String,
      status: String => Int,
      confirm: String => Boolean = askToContinue
  ): Unit =
    gitlabProjectUrl(repoUrl) match
      case Some(project) =>
        val code = status(project)
        println(s"  $code $project")
        if code != 200 then
          throw IllegalStateException(
            s"GitLab refuses the credentials ($code): $project - check the token of the repository."
          )
      case None          =>
        val problem =
          s"$repoUrl is no project registry - the credentials can not be checked, a wrong token fails at the upload (after the docs and the docker image)"
        if !confirm(problem) then throw IllegalStateException(s"$problem - release stopped.")
  end verifyGitlabCredentials

  /** The HTTP status of a HEAD request - 0 if the server is not reachable (or not within 30
    * seconds). No redirect is followed: curl keeps a custom header (the GitLab token) on a
    * redirect to another host. `config` are the lines of a curl config (the credentials).
    * Fails with a clear message without `curl`.
    */
  def curlStatus(config: Seq[String], curl: String = "curl", timeoutSeconds: Int = 30)(url: String): Int =
    val devNull = if scala.util.Properties.isWin then "NUL" else "/dev/null"
    val result  =
      try
        os.proc(
          curl, "--silent", "--head", "--connect-timeout", (timeoutSeconds min 10).toString,
          "--max-time", timeoutSeconds.toString,
          "--output", devNull, "--write-out", "%{http_code}", "--config", "-", url
        ).call(check = false, stdin = config.mkString("", "\n", "\n"))
      catch
        case e: java.io.IOException =>
          throw IllegalStateException(s"`$curl` is needed to check the repository - not found: ${e.getMessage}", e)
    val answer = result.out.text().trim
    answer.toIntOption.getOrElse(throw IllegalStateException(s"`$curl` answered no HTTP status for $url: $answer"))
  end curlStatus

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
      exec: Seq[String] => Unit = SbtChild.run,
      // called with the failed step before the failure is rethrown - see restoreForRetry
      onFailure: ReleaseStep => Unit = _ => (),
      // after a failed upload, before the restore - names what went out
      afterFailedUpload: () => Unit = () => (),
      // Ctrl-C: the sbt child gets it too and may still write - waited for before the restore
      awaitChild: () => Unit = () => SbtChild.awaitExit(),
      // the JVM's shutdown hooks - replaced in the tests
      addShutdownHook: Thread => Unit = Runtime.getRuntime.addShutdownHook,
      removeShutdownHook: Thread => Unit = Runtime.getRuntime.removeShutdownHook(_)
  ):
    /** Ctrl-C ends the JVM, no exception reaches the release - this hook restores the running
      * step's changes (registered while the step runs), once the sbt child ended.
      */
    def abortedAt(step: ReleaseStep): Thread =
      Thread: () =>
        println(s"Aborted at $step")
        try
          awaitChild()
          if step == ReleaseStep.Upload then afterFailedUpload()
          onFailure(step)
        catch case scala.util.control.NonFatal(restore) => restore.printStackTrace()

    def run(steps: Seq[ReleaseStep]): Unit =
      steps.foreach: step =>
        val aborted = abortedAt(step)
        addShutdownHook(aborted)
        try run(step)
        catch
          // a fatal error goes through without a restore
          case scala.util.control.NonFatal(e) =>
            if step == ReleaseStep.Upload then
              println(
                "The upload failed: the docker image (if any) is pushed already, and the modules `publish` " +
                  "uploaded before it failed are in the repository. The next try fails the check of the version " +
                  "until you remove the version there - then it overwrites the image's tag."
              )
              try afterFailedUpload()
              catch case scala.util.control.NonFatal(report) => e.addSuppressed(report)
            // the failure of the release stays the error - a failing restore is added to it
            try onFailure(step)
            catch case scala.util.control.NonFatal(restore) => e.addSuppressed(restore)
            throw e
        finally
          // refused while the JVM shuts down - then the hook runs anyway
          try removeShutdownHook(aborted)
          catch case _: IllegalStateException => ()

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

  /** The sbt child of a release - run on the console; a shutdown hook waits for it to end
    * before it restores the working tree (the child got the Ctrl-C too and may still write).
    */
  object SbtChild:
    // spawned and registered under the lock - a hook never misses a child just spawned; a
    // child gone from here has exited (`waitFor` returned), its output went to the console directly
    private var running: Option[os.SubProcess] = None

    def run(cmd: Seq[String]): Unit =
      println(cmd.mkString(" "))
      val child = synchronized:
        val c = os.proc(cmd).spawn(stdout = os.Inherit, stderr = os.Inherit)
        running = Some(c)
        c
      try
        child.waitFor()
        if child.exitCode() != 0 then
          throw IllegalStateException(s"`${cmd.mkString(" ")}` failed with exit code ${child.exitCode()}")
      catch
        // the thread was interrupted - the child must not go on writing while the tree is restored
        case e: InterruptedException =>
          child.destroy()
          child.waitFor(5000)
          throw e
      finally synchronized { running = None }
    end run

    /** Waits for the running child - at most `timeout`. */
    def awaitExit(timeout: scala.concurrent.duration.FiniteDuration = scala.concurrent.duration.Duration(30, "seconds")): Unit =
      synchronized(running).foreach: child =>
        println("Waiting for sbt to end ...")
        if !child.waitFor(timeout.toMillis) then println(s"sbt did not end within $timeout - restoring anyway.")
  end SbtChild

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
