package orchescala.engine.config

import munit.FunSuite

class ReposConfigTest extends FunSuite:

  private val artifactory = RepoConfig.Artifactory(
    "release",
    "https://repo.example.com/artifactory",
    "libs-release",
    usernameEnv = "REPO_USER",
    passwordEnv = "REPO_PWD"
  )

  test("the dummy repo is no release repo - nothing to check"):
    assertEquals(ReposConfig.dummyRepos.releaseRepo, None)
    assertEquals(ReposConfig.dummyRepos.releaseRepoCurlConfig(_ => None), Right(Seq.empty))

  test("an Artifactory repo authenticates with its user and password"):
    val repos = ReposConfig(repos = Seq(artifactory))
    val env   = Map("REPO_USER" -> "me", "REPO_PWD" -> "secret")
    assertEquals(repos.releaseRepoCurlConfig(env.get), Right(Seq("""user = "me:secret"""")))
    assertEquals(
      repos.releaseRepoCurlConfig(_ => None),
      Left("System Environment Variables REPO_USER and/ or REPO_PWD are not set.")
    )

  test("a quote or backslash in the secret stays a valid config line"):
    val repos = ReposConfig(repos = Seq(artifactory))
    val env   = Map("REPO_USER" -> "me", "REPO_PWD" -> """p"w\d""")
    assertEquals(repos.releaseRepoCurlConfig(env.get), Right(Seq("""user = "me:p\"w\\d"""")))

  test("a line break in a secret is refused - it would start another curl option"):
    val repos = ReposConfig(repos = Seq(artifactory))
    val env   = Map("REPO_USER" -> "me", "REPO_PWD" -> "secret\n")
    assertEquals(
      repos.releaseRepoCurlConfig(env.get),
      Left("System Environment Variable REPO_USER/REPO_PWD contains a line break.")
    )

  test("the credentials of the repo's host - as sbt picks them"):
    val repos = ReposConfig(
      credentials = Seq(
        RepoCredentials.PrivateToken("other", "gitlab.other.com", "OTHER_TOKEN"),
        RepoCredentials.UserPassword("mine", "gitlab.example.com", "MY_USER", "MY_PWD")
      ),
      repos = Seq(RepoConfig.Gitlab("release", "https://gitlab.example.com/api/v4/projects/1/packages/maven"))
    )
    val env   = Map("OTHER_TOKEN" -> "t", "MY_USER" -> "me", "MY_PWD" -> "secret")
    assertEquals(repos.releaseRepoCurlConfig(env.get), Right(Seq("""user = "me:secret"""")))
    // credentials, but none for the host: the upload would fail the same way
    val elsewhere = repos.copy(repos = Seq(RepoConfig.Gitlab("release", "https://gitlab.third.com/api/v4/projects/1/packages/maven")))
    assertEquals(
      elsewhere.releaseRepoCurlConfig(env.get),
      Left("No credentials for gitlab.third.com - configured for: gitlab.other.com, gitlab.example.com")
    )

  test("a GitLab repo authenticates with the token - the job token on a pipeline"):
    val repos = ReposConfig(
      credentials = Seq(RepoCredentials.PrivateToken("gitlab", "gitlab.example.com", "GITLAB_TOKEN")),
      repos = Seq(RepoConfig.Gitlab("release", "https://gitlab.example.com/api/v4/projects/1/packages/maven"))
    )
    assertEquals(
      repos.releaseRepoCurlConfig(Map("GITLAB_TOKEN" -> "t").get),
      Right(Seq("""header = "Private-Token: t""""))
    )
    assertEquals(
      repos.releaseRepoCurlConfig(Map("GITLAB_TOKEN" -> "t", "CI_JOB_TOKEN" -> "j", "CI_SERVER_HOST" -> "gitlab.example.com").get),
      Right(Seq("""header = "Job-Token: j""""))
    )
    // a pipeline of another GitLab: its job token is not for this host - the private token
    assertEquals(
      repos.releaseRepoCurlConfig(Map("GITLAB_TOKEN" -> "t", "CI_JOB_TOKEN" -> "j", "CI_SERVER_HOST" -> "gitlab.other.com").get),
      Right(Seq("""header = "Private-Token: t""""))
    )
    assertEquals(
      repos.releaseRepoCurlConfig(Map("GITLAB_TOKEN" -> "t", "CI_JOB_TOKEN" -> "j").get),
      Right(Seq("""header = "Private-Token: t""""))
    )
    assert(repos.releaseRepoCurlConfig(_ => None).isLeft)

  private val companyEnv = Map(
    "MYCOMPANY_MVN_RELEASE_REPOSITORY"    -> "https://bin.example.com/artifactory/my-releases/",
    "MYCOMPANY_MVN_DEPENDENCY_REPOSITORY" -> "https://bin.example.com/artifactory/my-virtual"
  )

  test("artifactoryFromEnv: the repos and credentials from the env variables of the company"):
    val repos = ReposConfig.artifactoryFromEnv("myCompany", companyEnv.get)
    assertEquals(
      repos.repos,
      Seq(
        RepoConfig.Artifactory(
          "release",
          "https://bin.example.com/artifactory",
          "my-releases",
          "MYCOMPANY_MVN_REPOSITORY_USERNAME",
          "MYCOMPANY_MVN_REPOSITORY_PASSWORD",
          urlEnv = Some("MYCOMPANY_MVN_RELEASE_REPOSITORY")
        ),
        RepoConfig.Artifactory(
          "maven",
          "https://bin.example.com/artifactory",
          "my-virtual",
          "MYCOMPANY_MVN_REPOSITORY_USERNAME",
          "MYCOMPANY_MVN_REPOSITORY_PASSWORD",
          realm = "Artifactory Realm 2",
          urlEnv = Some("MYCOMPANY_MVN_DEPENDENCY_REPOSITORY")
        )
      )
    )
    // own credentials for the dependency repo - also on the same host, so it may move
    assertEquals(
      repos.credentials,
      Seq(
        RepoCredentials.UserPassword(
          "mycompany",
          "bin.example.com",
          "MYCOMPANY_MVN_REPOSITORY_USERNAME",
          "MYCOMPANY_MVN_REPOSITORY_PASSWORD",
          repoUrlEnv = Some("MYCOMPANY_MVN_RELEASE_REPOSITORY")
        ),
        RepoCredentials.UserPassword(
          "mycompanyDependency",
          "bin.example.com",
          "MYCOMPANY_MVN_REPOSITORY_USERNAME",
          "MYCOMPANY_MVN_REPOSITORY_PASSWORD",
          repoUrlEnv = Some("MYCOMPANY_MVN_DEPENDENCY_REPOSITORY")
        )
      )
    )
    assertEquals(repos.releaseRepo.map(_.repoUrl), Some("https://bin.example.com/artifactory/my-releases"))

  test("artifactoryFromEnv: the dependency repo is optional, without release repo it is the dummy"):
    val onlyRelease = ReposConfig.artifactoryFromEnv(
      "myCompany",
      companyEnv.removed("MYCOMPANY_MVN_DEPENDENCY_REPOSITORY").get
    )
    assertEquals(onlyRelease.repos.map(_.name), Seq("release"))
    assertEquals(ReposConfig.artifactoryFromEnv("myCompany", _ => None), ReposConfig.dummyRepos)

  test("the generated build reads the env variables - the values are the fallback"):
    val repos = ReposConfig.artifactoryFromEnv("myCompany", companyEnv.get)
    // the exact snippet: the regex in `replaceAll`, the warning when the variable is not set
    assertEquals(
      repos.repos.head.sbtContent.linesIterator.slice(1, 5).mkString("\n"),
      """  lazy val releaseRepoStr = sys.env.get("MYCOMPANY_MVN_RELEASE_REPOSITORY").map(_.trim.replaceAll("/+$", "")).filter(_.nonEmpty).getOrElse {
        |    println("[warn] MYCOMPANY_MVN_RELEASE_REPOSITORY is not set - the repo of the last ./helper.scala update: https://bin.example.com/artifactory/my-releases")
        |    "https://bin.example.com/artifactory/my-releases"
        |  }""".stripMargin
    )
    assert(
      repos.repos(1).sbtContent.contains(
        """lazy val mavenRepo: MavenRepository = "Artifactory Realm 2" at mavenRepoStr"""
      ),
      repos.repos(1).sbtContent
    )
    assertEquals(
      repos.credentials.head.sbtContent.linesIterator.take(9).mkString("\n"),
      """  // the host of the credentials - from MYCOMPANY_MVN_RELEASE_REPOSITORY
        |  lazy val mycompanyRepoHost: String = {
        |    val url = sys.env.get("MYCOMPANY_MVN_RELEASE_REPOSITORY").map(_.trim.replaceAll("/+$", "")).filter(_.nonEmpty).getOrElse("https://bin.example.com")
        |    scala.util.Try(java.net.URI.create(url).getHost).toOption.flatMap(Option(_)).getOrElse {
        |      println("[warn] MYCOMPANY_MVN_RELEASE_REPOSITORY has no host - the credentials are for bin.example.com: " + url)
        |      "bin.example.com"
        |    }
        |  }
        |  lazy val mycompanyCredentials: Credentials = (for {""".stripMargin
    )
    assert(
      repos.credentials.head.sbtContent.contains("""Credentials("Artifactory Realm", mycompanyRepoHost, user, pwd)"""),
      repos.credentials.head.sbtContent
    )

  test("without env variable the generated build has the values - as before"):
    assert(artifactory.sbtContent.contains(
      """lazy val releaseRepoStr = "https://repo.example.com/artifactory/libs-release""""
    ))
    val credentials = RepoCredentials.UserPassword("mine", "repo.example.com", "MY_USER", "MY_PWD")
    assert(credentials.sbtContent.contains(
      """Credentials("Artifactory Realm", "repo.example.com", user, pwd)"""
    ))

  test("artifactoryFromEnv: a dependency repo on another host gets its own credentials"):
    val repos = ReposConfig.artifactoryFromEnv(
      "myCompany",
      companyEnv.updated("MYCOMPANY_MVN_DEPENDENCY_REPOSITORY", "https://deps.example.com/artifactory/virtual").get
    )
    assertEquals(
      repos.credentials.map(c => c.name -> c.repoHost),
      Seq("mycompany" -> "bin.example.com", "mycompanyDependency" -> "deps.example.com")
    )
    assertEquals(
      repos.credentials.collect { case u: RepoCredentials.UserPassword => u.repoUrlEnv },
      Seq(Some("MYCOMPANY_MVN_RELEASE_REPOSITORY"), Some("MYCOMPANY_MVN_DEPENDENCY_REPOSITORY"))
    )
    assertEquals(repos.sbtCredentials, "mycompanyCredentials, mycompanyDependencyCredentials")
    assertEquals(repos.repos(1).repoUrl, "https://deps.example.com/artifactory/virtual")

  test("artifactoryFromEnv: an invalid url fails early - naming the variable"):
    def failure(release: String, dependency: String = "https://bin.example.com/artifactory/virtual") =
      intercept[IllegalArgumentException](
        ReposConfig.artifactoryFromEnv(
          "myCompany",
          Map(
            "MYCOMPANY_MVN_RELEASE_REPOSITORY"    -> release,
            "MYCOMPANY_MVN_DEPENDENCY_REPOSITORY" -> dependency
          ).get
        )
      ).getMessage
    assertEquals(
      failure("https://bin.example.com"),
      "MYCOMPANY_MVN_RELEASE_REPOSITORY has no repo in its path (https://<host>/artifactory/<repo>): https://bin.example.com"
    )
    assertEquals(
      failure("https://bin.example.com/"),
      "MYCOMPANY_MVN_RELEASE_REPOSITORY has no repo in its path (https://<host>/artifactory/<repo>): https://bin.example.com/"
    )
    assertEquals(
      failure("bin.example.com/artifactory/releases"),
      "MYCOMPANY_MVN_RELEASE_REPOSITORY is no http(s) url: bin.example.com/artifactory/releases"
    )
    assertEquals(failure("https:///artifactory/releases"), "MYCOMPANY_MVN_RELEASE_REPOSITORY has no host: https:///artifactory/releases")
    assertEquals(failure("not a url"), "MYCOMPANY_MVN_RELEASE_REPOSITORY is no valid url: not a url")
    // the dependency repo is checked as well
    assertEquals(
      failure("https://bin.example.com/artifactory/releases", "https://bin.example.com"),
      "MYCOMPANY_MVN_DEPENDENCY_REPOSITORY has no repo in its path (https://<host>/artifactory/<repo>): https://bin.example.com"
    )

  test("a repo directly below the host"):
    val repos = ReposConfig.artifactoryFromEnv(
      "myCompany",
      Map("MYCOMPANY_MVN_RELEASE_REPOSITORY" -> "https://bin.example.com/releases").get
    )
    val release = repos.repos.head.asInstanceOf[RepoConfig.Artifactory]
    assertEquals(release.artifactoryApiUrl -> release.repo, "https://bin.example.com" -> "releases")

  test("the generated code escapes quotes and backslashes of the values"):
    val repo = artifactory.copy(repo = """libs"release""", urlEnv = Some("REPO_URL"))
    assert(
      repo.sbtContent.contains(
        """    "https://repo.example.com/artifactory/libs\"release""""
      ),
      repo.sbtContent
    )
    val credentials =
      RepoCredentials.UserPassword("mine", """repo"host""", "MY_USER", "MY_PWD", repoUrlEnv = Some("REPO_URL"))
    assert(
      credentials.sbtContent.contains(
        """val url = sys.env.get("REPO_URL").map(_.trim.replaceAll("/+$", "")).filter(_.nonEmpty).getOrElse("https://repo\"host")"""
      ),
      credentials.sbtContent
    )
    assert(credentials.sbtContent.contains("""      "repo\"host""""), credentials.sbtContent)
    assert(
      credentials.sbtContent.contains("""println("[warn] REPO_URL has no host - the credentials are for repo\"host: " + url)"""),
      credentials.sbtContent
    )

  test("a GitLab repo with an env variable"):
    val gitlab = RepoConfig.Gitlab("release", "https://gitlab.example.com/api/v4/projects/1/packages/maven", urlEnv = Some("GITLAB_REPO"))
    assert(
      gitlab.sbtContent.contains(
        """sys.env.get("GITLAB_REPO").map(_.trim.replaceAll("/+$", "")).filter(_.nonEmpty).getOrElse {
          |      println("[warn] GITLAB_REPO is not set - the repo of the last ./helper.scala update: https://gitlab.example.com/api/v4/projects/1/packages/maven")
          |      "https://gitlab.example.com/api/v4/projects/1/packages/maven"
          |    }""".stripMargin
      ),
      gitlab.sbtContent
    )
    assert(RepoConfig.Gitlab("release", "https://x").sbtContent.contains("""    "https://x""""))

  test("artifactoryFromEnv: an empty variable counts as not set"):
    assertEquals(
      ReposConfig.artifactoryFromEnv("myCompany", Map("MYCOMPANY_MVN_RELEASE_REPOSITORY" -> "  ").get),
      ReposConfig.dummyRepos
    )
    val noDependency = ReposConfig.artifactoryFromEnv(
      "myCompany",
      companyEnv.updated("MYCOMPANY_MVN_DEPENDENCY_REPOSITORY", "").get
    )
    assertEquals(noDependency.repos.map(_.name), Seq("release"))
    assertEquals(noDependency.credentials.map(_.name), Seq("mycompany"))

  test("artifactoryFromEnv: all slashes at the end are removed"):
    val repos   = ReposConfig.artifactoryFromEnv(
      "myCompany",
      Map("MYCOMPANY_MVN_RELEASE_REPOSITORY" -> "https://bin.example.com/artifactory/releases//").get
    )
    val release = repos.repos.head.asInstanceOf[RepoConfig.Artifactory]
    assertEquals(release.artifactoryApiUrl -> release.repo, "https://bin.example.com/artifactory" -> "releases")

  test("artifactoryFromEnv: a company name that is no identifier"):
    val repos = ReposConfig.artifactoryFromEnv(
      "3m-bank",
      Map("3M_BANK_MVN_RELEASE_REPOSITORY" -> "https://bin.example.com/artifactory/releases").get
    )
    assertEquals(repos.sbtCredentials, "repo3mbankCredentials")

  test("artifactoryFromEnv: spaces around the url are removed - as in the generated build"):
    val repos   = ReposConfig.artifactoryFromEnv(
      "myCompany",
      Map("MYCOMPANY_MVN_RELEASE_REPOSITORY" -> "  https://bin.example.com/artifactory/releases/  ").get
    )
    val release = repos.repos.head.asInstanceOf[RepoConfig.Artifactory]
    assertEquals(release.artifactoryApiUrl -> release.repo, "https://bin.example.com/artifactory" -> "releases")
    assertEquals(repos.credentials.head.repoHost, "bin.example.com")
    assertEquals(
      SbtCode.trimUrl("  https://bin.example.com/artifactory/releases/  "),
      "https://bin.example.com/artifactory/releases"
    )

  test("repoUri: a url with a query or fragment is refused - also with a slash before it"):
    def failure(url: String) =
      intercept[IllegalArgumentException](RepoConfig.repoUri("REPO_URL", url)).getMessage
    assertEquals(
      failure("https://bin.example.com/artifactory/releases/?x=1"),
      "REPO_URL must have no query or fragment: https://bin.example.com/artifactory/releases/?x=1"
    )
    assertEquals(
      failure("https://bin.example.com/artifactory/releases#top"),
      "REPO_URL must have no query or fragment: https://bin.example.com/artifactory/releases#top"
    )

  test("repoUri: a url with user info is refused - the password is not in the message"):
    val message = intercept[IllegalArgumentException](
      ReposConfig.artifactoryFromEnv(
        "myCompany",
        Map("MYCOMPANY_MVN_RELEASE_REPOSITORY" -> "https://me:secret@bin.example.com/artifactory/releases").get
      )
    ).getMessage
    assert(message.startsWith("MYCOMPANY_MVN_RELEASE_REPOSITORY must have no user info"), message)
    assert(message.endsWith("https://***@bin.example.com/artifactory/releases"), message)
    assert(!message.contains("secret"), message)
    // also an invalid url with user info
    val invalid = intercept[IllegalArgumentException](
      RepoConfig.repoUri("REPO_URL", "https://me:secret@bin.example.com/a b")
    ).getMessage
    assertEquals(invalid, "REPO_URL is no valid url: https://***@bin.example.com/a b")

  test("curlLine: escaped - none with a line break"):
    assertEquals(RepoConfig.curlLine("user", """me:p"w\d"""), Some("""user = "me:p\"w\\d""""))
    assertEquals(RepoConfig.curlLine("user", "me:secret\n"), None)

end ReposConfigTest
