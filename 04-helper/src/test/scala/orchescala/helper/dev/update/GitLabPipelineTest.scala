package orchescala.helper.dev.update

import munit.FunSuite
import orchescala.api.{ApiProjectConfig, ModuleType, VersionConfig}
import orchescala.engine.config.ReposConfig
import orchescala.helper.util.{DevConfig, PipelineConfig, SbtConfig}

/** The generated `.gitlab-ci.yml` uses the same env names as the generated sbt build. */
class GitLabPipelineTest extends FunSuite:

  private def pipeline(projectName: String): String =
    given DevConfig = DevConfig(
      ApiProjectConfig(projectName, VersionConfig("0.1.0-SNAPSHOT"), Seq.empty, Seq.empty, Seq.empty, ModuleType.projectModules)
    ).withSbtConfig(
      SbtConfig(reposConfig =
        ReposConfig.artifactoryFromEnv(
          "acme.bank",
          Map("ACME_BANK_MVN_RELEASE_REPOSITORY" -> "https://bin.example.com/artifactory/releases").get
        )
      )
    )
    GenericFileGenerator().gitLabPipeline(PipelineConfig(baseImage = "sbtscala/scala-sbt", baseProxy = ""))

  test("the env names of the credentials - as in the generated build (ACME_BANK_, not ACME.BANK_)"):
    val yml = pipeline("acme.bank-customer")
    assert(yml.contains("ACME_BANK_MVN_REPOSITORY_USERNAME: $CI_REGISTRY_USER"), yml)
    assert(yml.contains("COURSIER_CREDENTIALS: bin.example.com $ACME_BANK_MVN_REPOSITORY_USERNAME:$ACME_BANK_MVN_REPOSITORY_PASSWORD"), yml)
    assert(!yml.contains("ACME.BANK_"), yml)

end GitLabPipelineTest
