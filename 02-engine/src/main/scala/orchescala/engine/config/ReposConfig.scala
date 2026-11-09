package orchescala.engine.config

import java.net.URI

case class ReposConfig(
    credentials: Seq[RepoCredentials] = Seq.empty,
    // first repo is the release Repo!
    repos: Seq[RepoConfig] = Seq.empty,
):

  def sbtCredentials: String =
    credentials.map(c => s"${c.name}Credentials").mkString(", ")

  def sbtRepos: String =
    repos.map(r => s"${r.name}Repo").mkString(", ")

  /** Repositories that can be used to resolve deployment artifacts. */
  def deploymentRepositories: Seq[URI] =
    repos.map(_.repoUrl).filterNot(_ == "???").map(URI.create)

  /** Maven-style pattern to locate the deployment artifact inside a repository. */
  def deploymentArtifactPattern: String =
    "<repo>/<company>/<project>/<version>/<project>-<version>.jar"

  /** The release repo (the first one) - None for the dummy (`???`). */
  def releaseRepo: Option[RepoConfig] =
    repos.headOption.filterNot(_.repoUrl == "???")

  /** The lines of a curl config (`curl -K -`, fed through stdin - so the secret is not in
    * `ps`) that authenticate at the release repo, as the sbt build does: an Artifactory repo
    * with its user/password, another repo with the credentials of its host (the job token on
    * a pipeline of that GitLab - `CI_SERVER_HOST`). Left with the missing environment
    * variables, or without credentials for the host.
    */
  def releaseRepoCurlConfig(env: String => Option[String] = sys.env.get): Either[String, Seq[String]] =
    // a line break in a secret (read from a file) would start another config line - an option
    def line(option: String, value: String, envName: String): Either[String, Seq[String]] =
      RepoConfig.curlLine(option, value)
        .map(Seq(_))
        .toRight(s"System Environment Variable $envName contains a line break.")
    def userPassword(usernameEnv: String, passwordEnv: String) =
      (for
        user <- env(usernameEnv)
        pwd  <- env(passwordEnv)
      yield line("user", s"$user:$pwd", s"$usernameEnv/$passwordEnv"))
        .getOrElse(Left(s"System Environment Variables $usernameEnv and/ or $passwordEnv are not set."))
    releaseRepo match
      case Some(a: RepoConfig.Artifactory) => userPassword(a.usernameEnv, a.passwordEnv)
      case Some(repo)                      =>
        // as sbt: the credentials of the repo's host
        val host = scala.util.Try(java.net.URI(repo.repoUrl).getHost).toOption.getOrElse("")
        credentials.find(_.repoHost == host) match
          case Some(t: RepoCredentials.PrivateToken) =>
            // the job token is the pipeline's GitLab's (CI_SERVER_HOST) - not for another host
            val jobToken = env("CI_JOB_TOKEN").filter(_ => env("CI_SERVER_HOST").contains(host))
            jobToken.map(token => line("header", s"Job-Token: $token", "CI_JOB_TOKEN"))
              .orElse(env(t.tokenEnv).map(token => line("header", s"Private-Token: $token", t.tokenEnv)))
              .getOrElse(Left(s"System Environment Variable ${t.tokenEnv} is not set."))
          case Some(u: RepoCredentials.UserPassword) => userPassword(u.usernameEnv, u.passwordEnv)
          case None if credentials.isEmpty           => Right(Seq.empty)
          case None                                  =>
            Left(s"No credentials for $host - configured for: ${credentials.map(_.repoHost).mkString(", ")}")
      case None                            => Right(Seq.empty)
  end releaseRepoCurlConfig

end ReposConfig
object ReposConfig:
  lazy val dummyRepos = ReposConfig(
    repos = Seq(RepoConfig.Gitlab(
      "release",
      "???"
    ))
  )

  /** The Artifactory repos of a company from its env variables - the same as the build of the
    * `company-orchescala` project uses:
    *   - `{COMPANY}_MVN_RELEASE_REPOSITORY`: `https://<host>/artifactory/<repo>` (the release repo)
    *   - `{COMPANY}_MVN_DEPENDENCY_REPOSITORY`: optional, the repo for the dependencies
    *   - `{COMPANY}_MVN_REPOSITORY_USERNAME` / `_PASSWORD`: the credentials - for both repos
    *
    * The generated `project/Settings.scala` reads these variables as well - so a project's build
    * follows them, the values of the generation are only the fallback.
    *
    * Without `{COMPANY}_MVN_RELEASE_REPOSITORY` (or empty) it is the dummy repo - with
    * `{COMPANY}_MVN_DEPENDENCY_REPOSITORY` set, an error (no silent dummy repo). A url that is set
    * but no `http(s)://<host>/.../<repo>` fails with an `IllegalArgumentException` naming the
    * variable - deliberately: it is read when the company config is built, so every command of
    * the helper stops, instead of publishing to or resolving from the dummy repo.
    */
  def artifactoryFromEnv(
      companyName: String,
      env: String => Option[String] = sys.env.get
  ): ReposConfig =
    def envName(suffix: String) = SbtCode.companyEnvName(companyName, suffix)
    // an empty variable counts as not set - as in the generated build
    def read(name: String)      = env(name).map(_.trim).filter(_.nonEmpty)
    val releaseEnv              = envName("MVN_RELEASE_REPOSITORY")
    val dependencyEnv           = envName("MVN_DEPENDENCY_REPOSITORY")
    val credentialsName         = SbtCode.identifier(companyName)

    def artifactory(name: String, url: String, urlEnv: String, credentialsName: String, realm: String) =
      val credentials = RepoCredentials.UserPassword(
        credentialsName,
        RepoConfig.hostOf(RepoConfig.repoUri(urlEnv, url)).get, // repoUri checks the host
        envName("MVN_REPOSITORY_USERNAME"),
        envName("MVN_REPOSITORY_PASSWORD"),
        repoUrlEnv = Some(urlEnv)
      )
      RepoConfig.Artifactory.fromUrl(name, url, credentials, urlEnv, realm) -> credentials

    read(releaseEnv) match
      case None if read(dependencyEnv).nonEmpty =>
        // not silently the dummy repo - as for an invalid url
        throw IllegalArgumentException(
          s"$dependencyEnv is set, but $releaseEnv is not - set both (or none for the dummy repo)."
        )
      case None             => dummyRepos
      case Some(releaseUrl) =>
        val release    = artifactory("release", releaseUrl, releaseEnv, credentialsName, "Artifactory Realm")
        // its own credentials: the generated build takes their host from the variable, so the repo
        // may move to another host without a new `./helper.scala update`. On the same host sbt
        // keeps one of the two (same host and auth realm) - the same user and password.
        // "Artifactory Realm 2" is the name of the resolver (not the auth realm): sbt needs another
        // name for a second repo of the same host - with the same name the artifacts are not
        // loaded (unauthorized / forbidden).
        val dependency = read(dependencyEnv).map: url =>
          artifactory("maven", url, dependencyEnv, s"${credentialsName}Dependency", "Artifactory Realm 2")
        val repos      = release +: dependency.toSeq
        ReposConfig(repos.map(_._2), repos.map(_._1))
    end match
  end artifactoryFromEnv
end ReposConfig

sealed trait RepoConfig:
  def name: String
  def repoUrl: String
  def sbtContent: String
  def ammoniteRepo: String
end RepoConfig

object RepoConfig:
  case class Gitlab(
      name: String,
      repo: String,
      descr: String = "",
      realm: String = "gitlab",
      // the env variable with the url - only the generated build reads it (`repo` is the
      // fallback); the helper itself (release check) uses `repo`
      urlEnv: Option[String] = None
  ) extends RepoConfig:
    lazy val repoUrl: String = repo
    lazy val sbtContent =
      s"""  // $descr
         |  lazy val ${name}RepoStr =
         |    ${SbtCode.envUrlOrElseWarn(urlEnv, repo, "    ")}
         |  lazy val ${name}Repo: MavenRepository = "$realm" at ${name}RepoStr
         |""".stripMargin
    lazy val ammoniteRepo = "/*NOT SUPPORTED*/"
  end Gitlab

  case class Artifactory(
      name: String,
      artifactoryApiUrl: String,
      repo: String,
      usernameEnv: String,
      passwordEnv: String,
      descr: String = "",
      // the name of the sbt resolver - a second repo of the same host needs another one
      realm: String = "Artifactory Realm",
      // the env variable with the url - only the generated build reads it (the url is the
      // fallback); the helper itself (release check, version lookup) uses the url - with
      // `ReposConfig.artifactoryFromEnv` both come from the same variable
      urlEnv: Option[String] = None
  ) extends RepoConfig:
    lazy val repoUrl: String = s"$artifactoryApiUrl/$repo"

    lazy val sbtContent =
      s""" // $descr
         |  lazy val ${name}RepoStr = ${SbtCode.envUrlOrElseWarn(urlEnv, repoUrl, "  ")}
         |  lazy val ${name}Repo: MavenRepository = "$realm" at ${name}RepoStr
         |""".stripMargin

    lazy val ammoniteRepo: String =
      s"""  MavenRepository
         |    .of(${SbtCode.envUrlOrElse(urlEnv, repoUrl)})
         |    .withCredentials(Credentials.of(sys.env("$usernameEnv"),
         |      sys.env("$passwordEnv")))""".stripMargin

    /** looks up a package's latest version via Artifactory's search API - None if not found there
      * (e.g. a third-party dependency that only exists on Maven Central), so callers can fall
      * back. None (rather than throwing) if the credentials env vars are not set, or the lookup
      * fails - then with a warning (no network, timeout, an HTTP error other than 404). The
      * credentials go through stdin (`curl -K -`) - not visible in `ps`. Blocking (up to 15 s) -
      * for the helper; in a ZIO fiber wrap it in `ZIO.attemptBlocking`.
      */
    lazy val versionLookup: (String, String) => Option[String] =
      (project: String, org: String) =>
        def enc(value: String)          = java.net.URLEncoder.encode(value, java.nio.charset.StandardCharsets.UTF_8)
        val url                         =
          s"$artifactoryApiUrl/api/search/latestVersion?g=${enc(org)}&a=${enc(project)}&repos=${enc(repo)}"
        def failed(reason: String)      =
          println(s"[warn] The version of $org:$project could not be looked up in $repoUrl - $reason")
          None
        def lookup(config: String)      =
          scala.util.Try(
            os.proc("curl", "--silent", "--show-error", "--max-time", "10", "--write-out", "\n%{http_code}", "-K", "-", url)
              .call(stdin = config + "\n", check = false, stderr = os.Pipe, timeout = 15000)
          ) match
            case scala.util.Failure(e)                      => failed(s"curl: ${e.getMessage}")
            case scala.util.Success(r) if r.exitCode != 0   => failed(s"curl ${r.exitCode}: ${r.err.text().trim}")
            case scala.util.Success(r)                      =>
              val lines = r.out.text().trim.linesIterator.toSeq
              lines.lastOption match
                case Some("200") =>
                  Some(lines.init.mkString.trim).filter(_.matches("""\d+\.\d+\.\d+(-.+)?"""))
                case Some("404") => None // not in this repo - e.g. only on Maven Central
                case status      => failed(s"HTTP ${status.getOrElse("?")}")
        for
          username <- sys.env.get(usernameEnv)
          password <- sys.env.get(passwordEnv)
          config   <- RepoConfig.curlLine("user", s"$username:$password")
          version  <- lookup(config)
        yield version
    end versionLookup
  end Artifactory

  object Artifactory:
    /** An Artifactory repo from its url `https://<host>/artifactory/<repo>` - the last segment of
      * the path is the repo. An invalid url fails with an `IllegalArgumentException`.
      */
    def fromUrl(
        name: String,
        url: String,
        credentials: RepoCredentials.UserPassword,
        urlEnv: String,
        realm: String = "Artifactory Realm"
    ): Artifactory =
      // repoUri guarantees a segment in the path and no query or fragment - the last one is the repo
      val uri  = repoUri(urlEnv, url)
      val repo = uri.getRawPath.split('/').last
      Artifactory(
        name,
        SbtCode.trimUrl(url).stripSuffix(s"/$repo"),
        repo,
        credentials.usernameEnv,
        credentials.passwordEnv,
        realm = realm,
        urlEnv = Some(urlEnv)
      )
    end fromUrl
  end Artifactory

  /** The url of a repo (`urlEnv`): `http(s)://<host>/<path>` with at least one segment in the
    * path (the repo) and no query or fragment - otherwise an `IllegalArgumentException` that
    * names the variable. No user info (`user:password@` - no `@` at all): the url is written into the generated
    * `project/Settings.scala`. Spaces around and slashes at the end are removed (`SbtCode.trimUrl`).
    */
  def repoUri(urlEnv: String, url: String): URI =
    // the url in a message: everything up to the last `@` masked (after the scheme, if there is
    // one) - user info may have a password, also one with a `/` that java.net.URI takes as the
    // start of the path, or a url without `//`
    val shownUrl = url.replaceAll("^([a-zA-Z][a-zA-Z0-9+.-]*://)?.*@", "$1***@")
    def invalid(reason: String) =
      throw IllegalArgumentException(s"$urlEnv $reason: $shownUrl")
    val uri = scala.util.Try(URI.create(SbtCode.trimUrl(url)))
      .getOrElse(invalid("is no valid url"))
    // the url is written into the generated project/Settings.scala - which is committed; an `@`
    // anywhere (not only in the user info URI finds) as `https://user:pa/ss@host/...` is one too
    if uri.getRawUserInfo != null || url.contains('@') then
      invalid(
        "must have no user info - the credentials are in the ..._MVN_REPOSITORY_USERNAME / _PASSWORD variables"
      )
    if !Option(uri.getScheme).exists(s => s == "http" || s == "https") then
      invalid("is no http(s) url")
    if hostOf(uri).isEmpty then invalid("has no host")
    if Option(uri.getPath).forall(_.stripPrefix("/").isEmpty) then
      invalid("has no repo in its path (https://<host>/artifactory/<repo>)")
    if uri.getRawQuery != null || uri.getRawFragment != null then
      invalid("must have no query or fragment")
    uri
  end repoUri

  /** The host of a url - also one that `java.net.URI` does not accept as host (e.g. with `_`,
    * then `getHost` is null): taken from the authority then.
    */
  def hostOf(uri: URI): Option[String] =
    Option(uri.getHost)
      .orElse(Option(uri.getRawAuthority).map(_.replaceAll(SbtCode.authorityToHost, "")))
      .filter(_.nonEmpty)

  /** A line of a curl config (`curl -K -`) - None for a value with a line break (it would start
    * another option).
    */
  private[config] def curlLine(option: String, value: String): Option[String] =
    Option.unless(value.exists(c => c == '\n' || c == '\r')):
      s"""$option = "${value.replace("\\", "\\\\").replace("\"", "\\\"")}""""

end RepoConfig

sealed trait RepoCredentials:
  def name: String
  // the host these credentials are for - sbt (and the release check) pick them by it
  def repoHost: String
  def sbtContent: String

object RepoCredentials:
  case class PrivateToken(
      name: String,
      repoHost: String,
      tokenEnv: String,
      realm: String = "GitLab Packages Registry"
  ) extends RepoCredentials:
    lazy val sbtContent: String =
      s"""  lazy val tokenName = sys.env.get("CI_JOB_TOKEN").map(_ => "Job-Token").getOrElse("Private-Token")
         |  lazy val ${name}Credentials: Credentials = (for {
         |    value <- sys.env.get("CI_JOB_TOKEN").orElse(sys.env.get("$tokenEnv"))
         |  } yield Credentials("$realm", "$repoHost", tokenName, value))
         |    .getOrElse(
         |      throw new IllegalArgumentException(
         |        "System Environment Variable $tokenEnv is not set."
         |      )
         |    )
         |""".stripMargin
  end PrivateToken

  case class UserPassword(
      name: String,
      repoHost: String,
      usernameEnv: String,
      passwordEnv: String,
      realm: String = "Artifactory Realm",
      // the env variable with the url of the repo - the generated build takes the host from it,
      // `repoHost` is the fallback
      repoUrlEnv: Option[String] = None
  ) extends RepoCredentials:
    private lazy val hostVal = s"${name}RepoHost"

    /** With `repoUrlEnv`: a `lazy val` with the host - of the url in the variable, the host of the
      * generation without it; a malformed url gives a warning (no load error of sbt).
      */
    private lazy val sbtHostVal: String =
      repoUrlEnv
        .map: env =>
          val host    = SbtCode.literal(repoHost)
          val url     = SbtCode.envUrlOrElse(Some(env), s"https://$repoHost")
          val warning = SbtCode.literal(s"[warn] $env has no host - the credentials are for $repoHost: ")
          s"""  // the host of the credentials - from $env
             |  lazy val $hostVal: String = {
             |    val url = $url
             |    ${SbtCode.hostOf("url")}.getOrElse {
             |      println($warning + url)
             |      $host
             |    }
             |  }
             |""".stripMargin
        .getOrElse("")

    private lazy val sbtHost: String =
      if repoUrlEnv.nonEmpty then hostVal else SbtCode.literal(repoHost)

    lazy val sbtContent: String =
      s"""$sbtHostVal  lazy val ${name}Credentials: Credentials = (for {
         |    user <- sys.env.get("$usernameEnv")
         |    pwd <- sys.env.get("$passwordEnv")
         |  } yield Credentials("$realm", $sbtHost, user, pwd))
         |    .getOrElse(throw new IllegalArgumentException(
         |      "System Environment Variables $usernameEnv and/ or $passwordEnv are not set."
         |    ))
         |""".stripMargin
  end UserPassword
end RepoCredentials
