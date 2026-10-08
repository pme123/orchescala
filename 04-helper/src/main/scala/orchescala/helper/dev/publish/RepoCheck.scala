package orchescala.helper.dev.publish

import orchescala.engine.config.RepoConfig
import orchescala.helper.util.DevConfig

/** Before anything is built or uploaded: the version must be free in the release repository,
  * the credentials right - a release that fails at the upload has its docs and its docker
  * image out already.
  */
object RepoCheck:

  /** What the build publishes under: the `organization` (`ProjectDef.org`) and the suffix of
    * the artifacts - both read from the build's own files in `project/`, so the check looks
    * where `publish` uploads. Fails when either is missing: a guess made the check pass as
    * "free" on the wrong URL.
    */
  final case class BuildNames(organization: String, artifactSuffix: String)

  object BuildNames:
    def from(projectDir: os.Path): BuildNames =
      BuildNames(
        organization(projectDir / "project" / "ProjectDef.scala"),
        artifactSuffix(projectDir / "project" / "Settings.scala")
      )

  /** The `val org = "..."` of `project/ProjectDef.scala` - sbt's `organization`. */
  def organization(projectDef: os.Path): String = organization(os.read(projectDef), projectDef.toString)

  def organization(projectDef: String, name: String = "project/ProjectDef.scala"): String =
    val Org = """val org\s*=\s*"([^"]+)"""".r
    Org.findFirstMatchIn(withoutComments(projectDef)).map(_.group(1))
      .getOrElse(throw IllegalStateException(s"No `val org = \"...\"` in $name - the organization is unknown."))

  /** The suffix of the artifacts of a build - from its `project/Settings.scala`: none with
    * `crossPaths := false` (a project), else `_<Scala major>` of its `scalaV` (the company
    * project: `_3`). Fails without the `scalaV` - a guessed suffix made the check pass as
    * "free" on the wrong URL.
    */
  def artifactSuffix(settings: os.Path): String = artifactSuffix(os.read(settings), settings.toString)

  def artifactSuffix(settings: String, name: String = "project/Settings.scala"): String =
    val CrossPathsOff = """\bcrossPaths\s*:=\s*false\b""".r
    val code          = withoutComments(settings) // a commented-out `scalaV` or `crossPaths` is none
    val crossPathsOff = CrossPathsOff.findFirstIn(code).isDefined
    val ScalaV        = """val scalaV\s*=\s*"(\d+)\.[^"]*"""".r
    if crossPathsOff then ""
    else
      ScalaV.findFirstMatchIn(code).map(m => s"_${m.group(1)}")
        .getOrElse(throw IllegalStateException(s"No `val scalaV = \"...\"` in $name - the artifact suffix is unknown."))
  end artifactSuffix

  /** `scala` without its comments - the line comments (two slashes to the end of the line) and
    * the block comments (nested, as Scala has them); a comment marker inside a string or char
    * literal is no comment.
    */
  def withoutComments(scala: String): String =
    val out     = StringBuilder()
    var i       = 0
    var inStr   = false
    var inTri   = false // a triple-quoted string
    var inBlock = 0 // the depth - Scala nests block comments
    def at(j: Int): Char   = if j < scala.length then scala(j) else ' '
    def starts(t: String)  = scala.startsWith(t, i)
    while i < scala.length do
      val c = scala(i)
      if inBlock > 0 then
        if starts("*/") then
          inBlock -= 1
          i += 1
        else if starts("/*") then
          inBlock += 1
          i += 1
      else if inTri then
        out += c
        if starts("\"\"\"") && !starts("\"\"\"\"") then
          out ++= "\"\""
          i += 2
          inTri = false
      else if inStr then
        out += c
        if c == '\\' then
          out += at(i + 1)
          i += 1
        else if c == '"' then inStr = false
      else if starts("\"\"\"") then
        inTri = true
        out ++= "\"\"\""
        i += 2
      else if c == '"' then
        inStr = true
        out += c
      else if c == '\'' && (at(i + 2) == '\'' || (at(i + 1) == '\\' && at(i + 3) == '\'')) then
        // a char literal - `'"'`, `'/'`, `'\''` are no string, no comment
        val len = if at(i + 1) == '\\' then 4 else 3
        out ++= scala.substring(i, i + len)
        i += len - 1
      else if starts("//") then
        while i < scala.length && scala(i) != '\n' do i += 1
        i -= 1
      else if starts("/*") then
        inBlock = 1
        i += 1
      else out += c
      i += 1
    out.toString
  end withoutComments

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
  def verifyUrlsFree(version: String, urls: Seq[String], status: String => Int): Unit =
    urls.foreach: url =>
      val code = status(url)
      println(s"  $code $url")
      code match
        case 404                     => ()
        case 200                     =>
          throw IllegalStateException(
            s"Version $version is in the repository already: $url - remove it there, or release " +
              "the next version."
          )
        case 401 | 403               =>
          throw IllegalStateException(
            s"The repository refuses the credentials ($code): $url - check the environment " +
              "variables of the repository."
          )
        case 301 | 302 | 307 | 308   =>
          throw IllegalStateException(
            s"The repository redirects ($code): $url - configure the final address of the repository."
          )
        case 0                       =>
          throw IllegalStateException(s"The repository is not reachable: $url")
        case other                   =>
          throw IllegalStateException(s"The repository answered an unexpected status ($other): $url")
  end verifyUrlsFree

  /** [[verifyUrlsFree]] against the release repo of `devConfig` for every module of the
    * project (a module that is never published is simply not there). Nothing to check with
    * the dummy repo.
    */
  def verifyVersionFree(
      version: String,
      devConfig: DevConfig,
      names: BuildNames,
      env: String => Option[String] = sys.env.get,
      confirm: String => Boolean = PublishHelper.askToContinue
  ): Unit =
    val repos = devConfig.sbtConfig.reposConfig
    repos.releaseRepo.foreach: repo =>
      val config = repos.releaseRepoCurlConfig(env).fold(msg => throw IllegalStateException(msg), identity)
      val status = curlStatus(config)
      repo match
        case _: RepoConfig.Gitlab if config.isEmpty                    =>
          val problem =
            s"no credentials for ${repo.repoUrl} - the check runs anonymously, a private package " +
              "reads as free"
          if !confirm(problem) then throw IllegalStateException(s"$problem - release stopped.")
        // the job token of a pipeline is GitLab's own - nothing to probe (and the project
        // endpoint is not meant for it); a token of a developer is probed
        case gitlab: RepoConfig.Gitlab if env("CI_JOB_TOKEN").isEmpty =>
          verifyGitlabCredentials(gitlab.repoUrl, status, confirm)
        case _: RepoConfig.Gitlab                                       =>
          println(
            "NOTE: the job token is not probed - a package it may not read looks free here and fails at the upload."
          )
        case _                                                         => ()
      println(s"Checking that $version is free in ${repo.repoUrl} ...")
      verifyUrlsFree(version, releaseUrls(devConfig, version, names, repo), retryingOnce(status))
  end verifyVersionFree

  /** The poms `publish` uploads for `version` - every module of the project (a module that
    * is never published is simply not there), named `<project>-<module><suffix>` under the
    * `organization` of the build.
    */
  def releaseUrls(devConfig: DevConfig, version: String, names: BuildNames, repo: RepoConfig)
      : Seq[String] =
    releaseArtifactUrls(repo.repoUrl, names.organization, releaseArtifacts(devConfig, names), version)

  /** The artifacts the generated build publishes: `<project>-<module>` for every module - and
    * for a module with sub projects (the domain) `<project>-<module>-base` and
    * `<project>-<module>-<sub project>` as well.
    */
  def releaseArtifacts(devConfig: DevConfig, names: BuildNames): Seq[String] =
    devConfig.apiProjectConfig.modules.flatMap: m =>
      val module = s"${devConfig.projectName}-$m"
      val subs   =
        if devConfig.subProjects.nonEmpty &&
          devConfig.modules.exists(c => c.moduleType == m && c.generateSubModule)
        then s"$module-base" +: devConfig.subProjects.map(sp => s"$module-$sp")
        else Seq.empty
      (module +: subs).map(_ + names.artifactSuffix)

  /** After a failed upload: which poms of `version` are in the release repo now - so the
    * console names what went out. Never fails (it runs in a failure handler).
    */
  def reportUploaded(
      version: String,
      devConfig: DevConfig,
      names: BuildNames,
      env: String => Option[String] = sys.env.get
  ): Seq[String] =
    val repos = devConfig.sbtConfig.reposConfig
    try
      repos.releaseRepo.toSeq.flatMap: repo =>
        val config = repos.releaseRepoCurlConfig(env).getOrElse(Seq.empty)
        // best effort, in a failure handler: 5 seconds per pom, and no more once the repo is unreachable
        val status = curlStatus(config, timeoutSeconds = 5)
        val codes  = releaseUrls(devConfig, version, names, repo).iterator
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
    * free version. The project itself answers 200 with a token that reads it - checked first;
    * any other answer (a wrong token - or a deploy token, which may not read the project) and
    * a registry that is not a project's (a group's) can not be told apart from here: the
    * release goes on only when confirmed - a wrong token fails at the upload, after the docs
    * and the image.
    */
  def verifyGitlabCredentials(
      repoUrl: String,
      status: String => Int,
      confirm: String => Boolean = PublishHelper.askToContinue
  ): Unit =
    gitlabProjectUrl(repoUrl) match
      case Some(project) =>
        val code = status(project)
        println(s"  $code $project")
        // 401/404: a wrong token - or one that may publish but not read the project (a deploy
        // token, a token with the registry scope only): asked
        if code != 200 then
          val problem =
            s"GitLab does not show $project to this token ($code) - a wrong token, or one that may " +
              "not read the project (a deploy token); a wrong token fails at the upload (after the " +
              "docs and the docker image)"
          if !confirm(problem) then throw IllegalStateException(s"$problem - release stopped.")
      case None          =>
        val problem =
          s"$repoUrl is no project registry - the credentials can not be checked, a wrong token " +
            "fails at the upload (after the docs and the docker image)"
        if !confirm(problem) then throw IllegalStateException(s"$problem - release stopped.")
  end verifyGitlabCredentials

  /** `status` tried once more after a pause when the repository was not reachable (0) - a
    * transient failure (DNS, TLS, a proxy) must not stop a release.
    */
  def retryingOnce(status: String => Int, pause: Long = 3000): String => Int = url =>
    val first = status(url)
    if first != 0 then first
    else
      println(s"  not reachable - once more in ${pause / 1000} s ...")
      Thread.sleep(pause)
      status(url)

  /** The HTTP status of a HEAD request for a URL - 0 if the server is not reachable (or not
    * within `timeoutSeconds`). No redirect is followed: curl keeps a custom header (the GitLab token) on a
    * redirect to another host. `config` are the lines of a curl config (the credentials).
    * Fails with a clear message without `curl`.
    */
  def curlStatus(config: Seq[String], curl: String = "curl", timeoutSeconds: Int = 30): String => Int = url =>
    val devNull = if scala.util.Properties.isWin then "NUL" else "/dev/null"
    val result  =
      try
        os.proc(
          curl, "--silent", "--show-error", "--head", "--connect-timeout", (timeoutSeconds min 10).toString,
          "--max-time", timeoutSeconds.toString,
          "--output", devNull, "--write-out", "%{http_code}", "--config", "-", url
        ).call(check = false, stdin = config.mkString("", "\n", "\n"), stderr = os.Pipe)
      catch
        case e: java.io.IOException =>
          throw IllegalStateException(s"`$curl` is needed to check the repository - not found: ${e.getMessage}", e)
    val answer = result.out.text().trim
    // DNS, TLS, a proxy, a timeout: curl says why (status 000) - said here, the status stays 0
    if result.exitCode != 0 then
      println(s"  `$curl` failed (exit ${result.exitCode}) for $url: ${result.err.text().trim}")
    if answer.isEmpty then 0 // failed before any status
    else answer.toIntOption.getOrElse(throw IllegalStateException(s"`$curl` answered no HTTP status for $url: $answer"))
  end curlStatus

end RepoCheck
