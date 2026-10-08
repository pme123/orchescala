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
      repos.releaseRepoCurlConfig(Map("GITLAB_TOKEN" -> "t", "CI_JOB_TOKEN" -> "j").get),
      Right(Seq("""header = "Job-Token: j""""))
    )
    assert(repos.releaseRepoCurlConfig(_ => None).isLeft)

end ReposConfigTest
