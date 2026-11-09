package orchescala.helper.dev.update

import munit.FunSuite
import orchescala.api.{ApiProjectConfig, ModuleType, VersionConfig}
import orchescala.engine.config.{RepoConfig, RepoCredentials, ReposConfig}
import orchescala.helper.util.{DevConfig, PipelineConfig, SbtConfig}

/** The generated `.gitlab-ci.yml` uses the same env names as the generated sbt build - and has
  * nothing company-specific of the update for the repos from the variables.
  */
class GitLabPipelineTest extends FunSuite:

  private val fromEnv = ReposConfig.artifactoryFromEnv(
    "acme.bank",
    Map(
      "ACME_BANK_MVN_RELEASE_REPOSITORY"    -> "https://bin.example.com/artifactory/releases",
      "ACME_BANK_MVN_DEPENDENCY_REPOSITORY" -> "https://deps.example.com/artifactory/virtual"
    ).get
  )

  private def pipeline(reposConfig: ReposConfig, projectName: String = "acme.bank-customer"): String =
    given DevConfig = DevConfig(
      ApiProjectConfig(projectName, VersionConfig("0.1.0-SNAPSHOT"), Seq.empty, Seq.empty, Seq.empty, ModuleType.projectModules)
    ).withSbtConfig(SbtConfig(reposConfig = reposConfig))
    GenericFileGenerator().gitLabPipeline(PipelineConfig(baseImage = "sbtscala/scala-sbt", baseProxy = ""))

  /** runs the shell lines with bash - as the job does - and gives COURSIER_CREDENTIALS */
  private def coursierCredentials(script: String, env: Map[String, String]): String =
    os.proc("bash", "-c", s"""$script
                             |printf '%s' "$$COURSIER_CREDENTIALS"""".stripMargin)
      .call(env = env, propagateEnv = false)
      .out.text()

  test("the env names of the credentials - as in the generated build (ACME_BANK_, not ACME.BANK_)"):
    val yml = pipeline(fromEnv)
    assert(yml.contains("ACME_BANK_MVN_REPOSITORY_USERNAME: $CI_REGISTRY_USER"), yml)
    assert(!yml.contains("ACME.BANK_"), yml)

  test("the repos from the variables - no url or host of the update in the pipeline"):
    val yml = pipeline(fromEnv)
    assert(
      yml.contains("COURSIER_REPOSITORIES: ivy2Local|$ACME_BANK_MVN_RELEASE_REPOSITORY|$ACME_BANK_MVN_DEPENDENCY_REPOSITORY|central"),
      yml
    )
    assert(!yml.contains("bin.example.com") && !yml.contains("deps.example.com"), yml)
    assert(!yml.contains("artifactory/releases") && !yml.contains("artifactory/virtual"), yml)

  test("the pipeline is valid YAML - the credentials script is one block of the job"):
    val yml    = pipeline(fromEnv)
    val parsed = org.yaml.snakeyaml.Yaml().load[java.util.Map[String, Any]](yml)
    val script = parsed.get("worker-test").asInstanceOf[java.util.Map[String, Any]]
      .get("script").asInstanceOf[java.util.List[String]]
    val block  = script.stream().filter(_.contains("export COURSIER_CREDENTIALS=")).findFirst().get
    // the block as GitLab runs it - after the YAML indentation is removed
    val env    = Map(
      "ACME_BANK_MVN_RELEASE_REPOSITORY"    -> "https://bin.example.com/artifactory/releases",
      "ACME_BANK_MVN_DEPENDENCY_REPOSITORY" -> "https://deps.example.com/artifactory/virtual",
      "ACME_BANK_MVN_REPOSITORY_USERNAME"   -> "me",
      "ACME_BANK_MVN_REPOSITORY_PASSWORD"   -> "secret"
    )
    assertEquals(coursierCredentials(block, env), "bin.example.com me:secret\ndeps.example.com me:secret")

  test("the credentials script: the host of each repo url - read in the job"):
    val script = GenericFileGenerator
      .coursierCredentialsScript(fromEnv, "ACME_BANK_MVN_REPOSITORY_USERNAME", "ACME_BANK_MVN_REPOSITORY_PASSWORD")
      .get
    assert(!script.contains("example.com"), script)
    val env    = Map(
      "ACME_BANK_MVN_RELEASE_REPOSITORY"    -> "https://bin.example.com:8443/artifactory/releases?x=1",
      "ACME_BANK_MVN_DEPENDENCY_REPOSITORY" -> "https://deps.example.com/artifactory/virtual/",
      "ACME_BANK_MVN_REPOSITORY_USERNAME"   -> "me",
      "ACME_BANK_MVN_REPOSITORY_PASSWORD"   -> "secret"
    )
    assertEquals(
      coursierCredentials(script, env),
      "bin.example.com me:secret\ndeps.example.com me:secret"
    )

  test("repo_host: without scheme, user info, port, path, query and fragment"):
    val script = GenericFileGenerator.coursierCredentialsScript(fromEnv, "U", "P").get
    val hostOf = script.linesIterator.next() // the function
    Seq(
      "https://bin.example.com/artifactory/releases" -> "bin.example.com",
      "https://me:pw@bin.example.com:8443/a/r"       -> "bin.example.com",
      "http://bin.example.com#top"                   -> "bin.example.com",
      "https://my_bin.example.com/a?b=c"             -> "my_bin.example.com"
    ).foreach: (url, host) =>
      val out = os.proc("bash", "-c", s"""$hostOf
                                         |repo_host "$$URL"""".stripMargin)
        .call(env = Map("URL" -> url), propagateEnv = false).out.text()
      assertEquals(out, host, url)

  test("configured repos without variables - their url and host as before"):
    val credentials = RepoCredentials.UserPassword("acme", "bin.example.com", "U", "P")
    val static      = ReposConfig(
      Seq(credentials),
      Seq(RepoConfig.Artifactory("release", "https://bin.example.com/artifactory", "releases", "U", "P"))
    )
    val yml         = pipeline(static)
    assert(yml.contains("COURSIER_REPOSITORIES: ivy2Local|https://bin.example.com/artifactory/releases|central"), yml)
    assert(
      yml.contains("""export COURSIER_CREDENTIALS="bin.example.com $ACME_BANK_MVN_REPOSITORY_USERNAME:$ACME_BANK_MVN_REPOSITORY_PASSWORD""""),
      yml
    )

end GitLabPipelineTest
