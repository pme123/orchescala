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
    * a pipeline). Left with the missing environment variables, or without credentials for the
    * host.
    */
  def releaseRepoCurlConfig(env: String => Option[String] = sys.env.get): Either[String, Seq[String]] =
    // a line break in a secret (read from a file) would start another config line - an option
    def line(option: String, value: String, envName: String): Either[String, Seq[String]] =
      if value.exists(c => c == '\n' || c == '\r') then
        Left(s"System Environment Variable $envName contains a line break.")
      else Right(Seq(s"""$option = "${value.replace("\\", "\\\\").replace("\"", "\\\"")}""""))
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
            env("CI_JOB_TOKEN").map(token => line("header", s"Job-Token: $token", "CI_JOB_TOKEN"))
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
      realm: String = "gitlab"
  ) extends RepoConfig:
    lazy val repoUrl: String = repo
    lazy val sbtContent =
      s"""  // $descr
         |  lazy val ${name}RepoStr =
         |    "$repo"
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
      realm: String = "Artifactory Realm"
  ) extends RepoConfig:
    lazy val repoUrl: String = s"$artifactoryApiUrl/$repo"

    lazy val sbtContent =
      s""" // $descr
         |  lazy val ${name}RepoStr = "$artifactoryApiUrl/$repo"
         |  lazy val ${name}Repo: MavenRepository = "$realm" at ${name}RepoStr
         |""".stripMargin

    lazy val ammoniteRepo: String =
      s"""  MavenRepository
         |    .of("$artifactoryApiUrl/$repo")
         |    .withCredentials(Credentials.of(sys.env("$usernameEnv"),
         |      sys.env("$passwordEnv")))""".stripMargin

    /** looks up a package's latest version via Artifactory's search API - None if not found there
      * (e.g. a third-party dependency that only exists on Maven Central), so callers can fall
      * back. None (rather than throwing) if the credentials env vars are not set.
      */
    lazy val versionLookup: (String, String) => Option[String] =
      (project: String, org: String) =>
        for
          username <- sys.env.get(usernameEnv)
          password <- sys.env.get(passwordEnv)
          result    = os.proc(
                        "curl",
                        "--silent",
                        s"$artifactoryApiUrl/api/search/latestVersion?g=$org&a=$project&repos=$repo",
                        "-u",
                        s"$username:$password"
                      ).call()
          version   = result.out.text().trim
          if version.matches("""\d+\.\d+\.\d+(-.+)?""")
        yield version
    end versionLookup
  end Artifactory

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
      realm: String = "Artifactory Realm"
  ) extends RepoCredentials:
    lazy val sbtContent: String =
      s"""  lazy val ${name}Credentials: Credentials = (for {
         |    user <- sys.env.get("$usernameEnv")
         |    pwd <- sys.env.get("$passwordEnv")
         |  } yield Credentials("$realm", "$repoHost", user, pwd))
         |    .getOrElse(throw new IllegalArgumentException(
         |      "System Environment Variables $usernameEnv and/ or $passwordEnv are not set."
         |    ))
         |""".stripMargin
  end UserPassword
end RepoCredentials
