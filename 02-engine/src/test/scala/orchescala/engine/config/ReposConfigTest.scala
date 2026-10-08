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
    assertEquals(ReposConfig.dummyRepos.releaseRepoCurlAuth(_ => None), Right(Seq.empty))

  test("an Artifactory repo authenticates with its user and password"):
    val repos = ReposConfig(repos = Seq(artifactory))
    val env   = Map("REPO_USER" -> "me", "REPO_PWD" -> "secret")
    assertEquals(repos.releaseRepoCurlAuth(env.get), Right(Seq("-u", "me:secret")))
    assertEquals(
      repos.releaseRepoCurlAuth(_ => None),
      Left("System Environment Variables REPO_USER and/ or REPO_PWD are not set.")
    )

  test("a GitLab repo authenticates with the token - the job token on a pipeline"):
    val repos = ReposConfig(
      credentials = Seq(RepoCredentials.PrivateToken("gitlab", "gitlab.example.com", "GITLAB_TOKEN")),
      repos = Seq(RepoConfig.Gitlab("release", "https://gitlab.example.com/api/v4/projects/1/packages/maven"))
    )
    assertEquals(
      repos.releaseRepoCurlAuth(Map("GITLAB_TOKEN" -> "t").get),
      Right(Seq("--header", "Private-Token: t"))
    )
    assertEquals(
      repos.releaseRepoCurlAuth(Map("GITLAB_TOKEN" -> "t", "CI_JOB_TOKEN" -> "j").get),
      Right(Seq("--header", "Job-Token: j"))
    )
    assert(repos.releaseRepoCurlAuth(_ => None).isLeft)

end ReposConfigTest
