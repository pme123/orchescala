package orchescala.helper.dev.publish

import orchescala.engine.config.RepoConfig
import orchescala.helper.util.DevConfig

/** Before anything is built or uploaded: the version must be free in the release repository,
  * the credentials right - a release that fails at the upload has its docs and its docker
  * image out already.
  */
object RepoCheck:

  // what is read from the generated build files and the registry's address
  private val Org           = """val org\s*=\s*"([^"]+)"""".r
  private val Name          = """val name\s*=\s*"([^"]+)"""".r
  private val Module        = """(?:projectSettings|generalSettings)\(Some\("([^"]+)"\)""".r
  private val ScalaV        = """val scalaV\s*=\s*"(\d+\.\d+)\.[^"]*"""".r
  private val CrossPathsOff = """\bcrossPaths\s*:=\s*false\b""".r
  private val CrossPathsOn  = """\bcrossPaths\s*:=\s*true\b""".r
  private val Project       = """^(.*/api/v4/projects/[^/]+)/packages/maven/?$""".r

  /** What the build publishes: the `organization` and the `name` (`ProjectDef.org`/`.name`),
    * the modules of `build.sbt` and the suffix of the artifacts - all read from the build's own
    * files in `project/` and `build.sbt`, so the check looks where `publish` uploads. Fails
    * when any is missing: a guess made the check pass as "free" on the wrong URL.
    */
  final case class BuildNames(
      organization: String,
      name: String,
      modules: Seq[String],
      artifactSuffix: String
  )

  object BuildNames:
    def from(projectDir: os.Path): BuildNames =
      val projectDef = os.read(projectDir / "project" / "ProjectDef.scala")
      BuildNames(
        organization(projectDef, "project/ProjectDef.scala"),
        projectName(projectDef, "project/ProjectDef.scala"),
        modules(os.read(projectDir / "build.sbt"), "build.sbt"),
        artifactSuffixOf(projectDir / "project" / "Settings.scala")
      )

    /** The modules of the generated `build.sbt` - every `projectSettings(Some("<module>")...)`
      * (a project, the sub projects as `domain-base`, `domain-<sub>`) or
      * `generalSettings(Some("<module>"))` (the company); the root has none.
      */
    def modules(buildSbt: String, name: String = "build.sbt"): Seq[String] =
      val modules = Module.findAllMatchIn(ScalaSource.withoutComments(buildSbt)).map(_.group(1)).toSeq.distinct
      if modules.isEmpty then
        throw IllegalStateException(s"No module (`projectSettings(Some(\"...\"))`) in $name - the artifacts are unknown.")
      modules
  end BuildNames

  /** The `val name = "..."` of `project/ProjectDef.scala` - the first part of every artifact. */
  def projectName(projectDef: String, name: String = "project/ProjectDef.scala"): String =
    theOne(Name, ScalaSource.withoutComments(projectDef), "val name", name, "the artifacts are unknown")

  /** The one value `pattern` finds in `code` - none, or more than one, is said, not guessed. */
  private def theOne(pattern: scala.util.matching.Regex, code: String, what: String, name: String, consequence: String): String =
    pattern.findAllMatchIn(code).map(_.group(1)).toSeq.distinct match
      case Seq(one) => one
      case Seq()    => throw IllegalStateException(s"No `$what = \"...\"` in $name - $consequence.")
      case many     =>
        throw IllegalStateException(s"`$what` is set more than once in $name (${many.mkString(", ")}) - $consequence.")

  /** The `val org = "..."` of `project/ProjectDef.scala` - sbt's `organization`. */
  def organization(projectDef: String, name: String = "project/ProjectDef.scala"): String =
    theOne(Org, ScalaSource.withoutComments(projectDef), "val org", name, "the organization is unknown")

  /** The suffix of the artifacts of a build - from its `project/Settings.scala`: none with
    * `crossPaths := false` (a project), else the binary version of its `scalaV` (the company
    * project: `_3`; a Scala 2 build: `_2.13`). Fails without the `scalaV` - a guessed suffix
    * made the check pass as "free" on the wrong URL.
    */
  def artifactSuffixOf(settings: os.Path): String = artifactSuffix(os.read(settings), settings.toString)

  def artifactSuffix(settings: String, name: String = "project/Settings.scala"): String =
    val code          = ScalaSource.withoutComments(settings) // a commented-out `scalaV` or `crossPaths` is none
    val crossPathsOff = CrossPathsOff.findFirstIn(code).isDefined
    // the generated build sets it once, for every module - set both ways it is not one suffix
    if crossPathsOff && CrossPathsOn.findFirstIn(code).isDefined then
      throw IllegalStateException(s"`crossPaths` is set both ways in $name - the artifact suffix is not one.")
    if crossPathsOff then ""
    else
      // the binary version: `3` for Scala 3, `2.13` for Scala 2 - sbt's `scalaBinaryVersion`
      theOne(ScalaV, code, "val scalaV", name, "the artifact suffix is unknown") match
        case v if v.startsWith("3.") => "_3"
        case v if v.startsWith("2.") => s"_$v"
        case v                       => throw IllegalStateException(s"Scala $v in $name - the artifact suffix is unknown.")
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
            s"The repository redirects elsewhere ($code): $url - to another host, or down to http; the " +
              "credentials must not go there. Configure the final address of the repository."
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
      confirm: String => Boolean = PublishHelper.askToContinue,
      // the last release (the highest tag) - it must be found where the check looks, else the
      // URLs are wrong and every version would read as free
      lastRelease: Option[String] = None
  ): Unit =
    val repos = devConfig.sbtConfig.reposConfig
    repos.releaseRepo.foreach: repo =>
      val config = repos.releaseRepoCurlConfig(env).fold(msg => throw IllegalStateException(msg), identity)
      val status = curlStatus(config)
      // the GitLab token questions (and only these) a pipeline answers with ORCHESCALA_PUBLISH_YES=true
      val gitlabConfirm = pipelineYes(env).getOrElse(confirm)
      repo match
        // no credentials: a terminal may say yes, a pipeline not - its upload needs them anyway
        case _: RepoConfig.Gitlab if config.isEmpty                    =>
          val problem =
            s"no credentials for ${repo.repoUrl} - the check runs anonymously, a private package " +
              "reads as free"
          if !confirm(problem) then throw IllegalStateException(s"$problem - release stopped.")
        // the job token of a pipeline is GitLab's own - nothing to probe (and the project
        // endpoint is not meant for it); a token of a developer is probed
        case gitlab: RepoConfig.Gitlab if env("CI_JOB_TOKEN").isEmpty =>
          verifyGitlabCredentials(gitlab.repoUrl, status, gitlabConfirm)
        case _: RepoConfig.Gitlab                                       =>
          println(
            "NOTE: the job token is not probed - a package it may not read looks free here and fails at the upload."
          )
        case _                                                         => ()
      val status2 = retryingOnce(status)
      verifyLastRelease(lastRelease, names, repo, status2)
      println(s"Checking that $version is free in ${repo.repoUrl} ...")
      verifyUrlsFree(version, releaseUrls(version, names, repo), status2)
  end verifyVersionFree

  /** The positive control of the check: the last release must be where the check looks (its
    * first pom answers 200) - a 404 for it means the URLs are wrong (the organization, the
    * name, the modules, the suffix, or the repository), and every version would read as
    * free. Before the first release there is nothing to control - said.
    */
  def verifyLastRelease(lastRelease: Option[String], names: BuildNames, repo: RepoConfig, status: String => Int): Unit =
    lastRelease match
      case None       => println("No release yet - the URLs of the check can not be controlled against one.")
      case Some(last) =>
        val url  = releaseUrls(last, names, repo).head
        val code = status(url)
        println(s"  $code $url (the last release)")
        code match
          case 200       => ()
          case 404       =>
            throw IllegalStateException(
              s"The last release $last is not found where the check looks: $url - the URLs are wrong " +
                "(the organization, the name, the modules, the suffix of the build - or the repository), " +
                "every version would read as free."
            )
          case 401 | 403 =>
            throw IllegalStateException(
              s"The repository refuses the credentials ($code): $url - check the environment " +
                "variables of the repository."
            )
          case 0         => throw IllegalStateException(s"The repository is not reachable: $url")
          case other     => throw IllegalStateException(s"The repository answered an unexpected status ($other): $url")
  end verifyLastRelease

  /** The poms `publish` uploads for `version` - every module of the project (a module that
    * is never published is simply not there), named `<project>-<module><suffix>` under the
    * `organization` of the build.
    */
  def releaseUrls(version: String, names: BuildNames, repo: RepoConfig): Seq[String] =
    releaseArtifactUrls(repo.repoUrl, names.organization, releaseArtifacts(names), version)

  /** The artifacts the build publishes: `<name>-<module><suffix>` for every module of its
    * `build.sbt` (a module that is never published is simply not there).
    */
  def releaseArtifacts(names: BuildNames): Seq[String] =
    names.modules.map(m => s"${names.name}-$m${names.artifactSuffix}")

  /** After a failed upload: which poms of `version` are in the release repo now - so the
    * console names what went out. Never fails (it runs in a failure handler).
    */
  def reportUploaded(
      version: String,
      devConfig: DevConfig,
      names: BuildNames,
      env: String => Option[String] = sys.env.get,
      budgetMillis: Long = 30_000
  ): Seq[String] =
    val repos    = devConfig.sbtConfig.reposConfig
    val deadline = System.currentTimeMillis() + budgetMillis
    try
      repos.releaseRepo.toSeq.flatMap: repo =>
        val config = repos.releaseRepoCurlConfig(env).getOrElse(Seq.empty)
        // best effort, in a failure handler: 5 seconds per pom, half a minute in all, and no
        // more once the repo is unreachable
        val status = curlStatus(config, timeoutSeconds = 5)
        val urls   = releaseUrls(version, names, repo)
        val codes  = urls.iterator
          .takeWhile(_ => System.currentTimeMillis() < deadline)
          .map(url => url -> status(url))
          .span((_, code) => code != 0) match
          case (reachable, rest) => reachable.toSeq ++ rest.take(1).toSeq
        val uploaded = codes.collect { case (url, 200) => url }
        val cutShort = codes.exists(_._2 == 0) || codes.size < urls.size
        if codes.exists(_._2 == 0) then println(s"${repo.repoUrl} is not reachable.")
        else if codes.size < urls.size then println(s"Not every pom could be asked in ${budgetMillis / 1000} s.")
        if uploaded.nonEmpty then
          println(
            s"Uploaded already${if cutShort then " (and maybe more)" else ""} - remove the version there " +
              s"before the next try:\n - ${uploaded.mkString("\n - ")}"
          )
        else if cutShort then println(s"What of $version was uploaded is unknown.")
        else println(s"Nothing of $version is in ${repo.repoUrl}.")
        uploaded
    catch
      case scala.util.control.NonFatal(e) =>
        println(s"Could not look up what was uploaded: ${e.getMessage}")
        Seq.empty
  end reportUploaded

  /** A pipeline has no terminal to answer the GitLab token questions (a deploy token that may
    * not read the project, a group registry) - `ORCHESCALA_PUBLISH_YES=true` says yes to
    * these, and to nothing else (no credentials at all, the version check, the next version
    * stay).
    */
  def pipelineYes(env: String => Option[String]): Option[String => Boolean] =
    Option.when(env("ORCHESCALA_PUBLISH_YES").exists(_.trim.equalsIgnoreCase("true"))): problem =>
      println(s"$problem\nYes - ORCHESCALA_PUBLISH_YES is set.")
      true

  /** The project of a GitLab maven registry (`.../api/v4/projects/<id>/packages/maven`) - the
    * endpoint that tells whether the token may read it. None for another registry (a group's).
    */
  def gitlabProjectUrl(repoUrl: String): Option[String] =
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
    * within `timeoutSeconds`), or answers no status. A server without HEAD (405/501: some
    * proxies, registries) is asked with a GET of the first byte - 206 counts as 200. A redirect
    * is followed when it stays on the host (an Artifactory virtual repo, a CDN; an upgrade to
    * https too) - up to 3 hops; elsewhere it is not (curl would send the credentials, a custom
    * header like the GitLab token, there) and stays the status. `config` are the lines of a
    * curl config (the credentials). Fails with a clear message without `curl`.
    */
  def curlStatus(config: Seq[String], curl: String = "curl", timeoutSeconds: Int = 30): String => Int =
    def ask(url: String, hops: Int, get: Boolean): Int =
      val devNull = if scala.util.Properties.isWin then "NUL" else "/dev/null"
      val method  = if get then Seq("--range", "0-0") else Seq("--head")
      val result  =
        try
          os.proc(
            curl, "--silent", "--show-error", method, "--connect-timeout", (timeoutSeconds min 10).toString,
            "--max-time", timeoutSeconds.toString,
            "--output", devNull, "--write-out", "%{http_code} %{redirect_url}", "--config", "-", url
          ).call(check = false, stdin = config.mkString("", "\n", "\n"), stderr = os.Pipe)
        catch
          case e: java.io.IOException =>
            throw IllegalStateException(s"`$curl` is needed to check the repository - not found: ${e.getMessage}", e)
      val answer = result.out.text().trim
      // DNS, TLS, a proxy, a timeout: curl says why (status 000) - said here, the status stays 0
      if result.exitCode != 0 then
        println(s"  `$curl` failed (exit ${result.exitCode}) for ${withoutUserInfo(url)}: ${withoutUserInfo(result.err.text().trim)}")
      val (code, redirect) = answer.split(" ", 2) match
        case Array(c, r) => (c, r.trim)
        case Array(c)    => (c, "")
        case _           => ("", "")
      code.toIntOption match
        case None                                                            =>
          if code.nonEmpty then println(s"  `$curl` answered no HTTP status for ${withoutUserInfo(url)}: $answer")
          0 // failed before any status, or no status - like any failure of the transport
        case Some(status) if Set(301, 302, 307, 308).contains(status) && hops > 0 && sameHost(url, redirect) =>
          println(s"  $status $url -> $redirect")
          ask(redirect, hops - 1, get)
        case Some(405 | 501) if !get                                        =>
          println(s"  no HEAD for $url - asking for the first byte")
          ask(url, hops, get = true)
        case Some(206)                                                       => 200 // the first byte: it is there
        case Some(status)                                                    => status
    end ask
    url => ask(url, 3, get = false)
  end curlStatus

  /** `text` with the user info of its URLs (`user:secret@host`) taken out - for the console. */
  def withoutUserInfo(text: String): String = text.replaceAll("://[^@/\\s]+@", "://")

  /** `other` stays on the host of `url` - the same scheme and port, or an upgrade from http to
    * https (the credentials stay with the host, and go nowhere less safe).
    */
  def sameHost(url: String, other: String): Boolean =
    other.nonEmpty && scala.util.Try {
      val a = java.net.URI(url)
      val b = java.net.URI(other)
      a.getHost == b.getHost &&
      ((a.getScheme == b.getScheme && a.getPort == b.getPort) || (a.getScheme == "http" && b.getScheme == "https"))
    }.getOrElse(false)

end RepoCheck
