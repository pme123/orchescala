package orchescala.helper.dev.update

import munit.FunSuite
import orchescala.api.{ApiProjectConfig, ModuleType, VersionConfig}
import orchescala.helper.util.{DevConfig, SbtConfig}

/** The generated sbt build of a project (`project/Settings.scala`, `build.sbt`) - the compiler
  * never sees it, it is written as strings.
  */
class SbtSettingsGeneratorTest extends FunSuite:

  private def inProject(sbtConfig: SbtConfig)(body: DevConfig ?=> os.Path => Unit): Unit =
    val dir = os.temp.dir(prefix = "project-sbt-")
    try
      os.dynamicPwd.withValue(dir):
        given DevConfig = DevConfig(
          ApiProjectConfig(
            "democompany-customer",
            VersionConfig("0.1.0-SNAPSHOT"),
            Seq.empty,
            Seq.empty,
            Seq.empty,
            ModuleType.projectModules
          )
        ).withSbtConfig(sbtConfig)
        body(dir / "democompany-customer")
    finally os.remove.all(dir)

  private val companyDocker = """Seq(
    dockerBaseImage := "eclipse-temurin:21-jre" // the company's image
  )"""

  test("Settings.scala: dockerBuildSettings next to the company's dockerSettings - as they are"):
    inProject(SbtConfig(dockerSettings = Some(companyDocker))): projectDir =>
      SbtSettingsGenerator(isGateway = false).generate
      val settings = os.read(projectDir / "project" / "Settings.scala")
      assert(settings.contains("import sbt.*"), settings)
      assert(settings.contains("import com.typesafe.sbt.packager.Keys.*"), settings)
      assert(
        settings.contains("""dockerBuildOptions ++= Seq("--platform", "linux/amd64")"""),
        settings
      )
      assert(settings.contains(s"lazy val dockerSettings = $companyDocker"), settings)

  test("Settings.scala: without docker settings and without build options"):
    inProject(SbtConfig(dockerBuildOptions = Seq.empty)): projectDir =>
      SbtSettingsGenerator(isGateway = false).generate
      val settings = os.read(projectDir / "project" / "Settings.scala")
      assert(settings.contains("lazy val dockerBuildSettings: Seq[Setting[_]] = Seq()"), settings)
      // not the default of sbt-native-packager (`openjdk:8`) - it is no longer on Docker Hub
      assert(
        settings.contains("""lazy val dockerSettings = Seq(dockerBaseImage := "eclipse-temurin:21-jre")"""),
        settings
      )

  test("Settings.scala: the docker settings from the env variables of the company"):
    val docker = SbtConfig.dockerSettingsFromEnv(
      "democompany",
      otherSettings = Seq("""dockerEntrypoint := Seq("/opt/sbin/entrypoint.sh")""")
    )
    inProject(SbtConfig(dockerSettings = Some(docker))): projectDir =>
      SbtSettingsGenerator(isGateway = false).generate
      val settings = os.read(projectDir / "project" / "Settings.scala")
      assert(
        settings.contains(
          """lazy val dockerSettings = Seq(
            |    dockerRepository := sys.env.get("DEMOCOMPANY_DOCKER_REPOSITORY").map(_.trim).filter(_.nonEmpty).orElse(dockerRepository.value),
            |    dockerBaseImage := sys.env.get("DEMOCOMPANY_DOCKER_BASE_IMAGE").map(_.trim).filter(_.nonEmpty).getOrElse("eclipse-temurin:21-jre"),
            |    dockerEntrypoint := Seq("/opt/sbin/entrypoint.sh")
            |  )""".stripMargin
        ),
        settings
      )

  test("the docker default: eclipse-temurin:21-jre - not openjdk:8 of sbt-native-packager"):
    // a change for every project without company docker settings - see the PR / CHANGELOG
    assertEquals(SbtConfig.defaultBaseImage, "eclipse-temurin:21-jre")
    assertEquals(SbtConfig.defaultDockerSettings, """Seq(dockerBaseImage := "eclipse-temurin:21-jre")""")
    assert(
      SbtConfig.dockerSettingsFromEnv("democompany").contains(
        """dockerBaseImage := sys.env.get("DEMOCOMPANY_DOCKER_BASE_IMAGE").map(_.trim).filter(_.nonEmpty).getOrElse("eclipse-temurin:21-jre")"""
      )
    )

  test("Settings.scala: the docker repository with a default of the company"):
    val docker = SbtConfig.dockerSettingsFromEnv("democompany", defaultRepository = Some("registry.example.com"))
    assert(
      docker.contains(
        """dockerRepository := sys.env.get("DEMOCOMPANY_DOCKER_REPOSITORY").map(_.trim).filter(_.nonEmpty).orElse(Some("registry.example.com"))"""
      ),
      docker
    )

  test("Settings.scala: the repos from the env variables of the company"):
    val repos = orchescala.engine.config.ReposConfig.artifactoryFromEnv(
      "democompany",
      Map(
        "DEMOCOMPANY_MVN_RELEASE_REPOSITORY"    -> "https://bin.example.com/artifactory/releases",
        "DEMOCOMPANY_MVN_DEPENDENCY_REPOSITORY" -> "https://bin.example.com/artifactory/virtual"
      ).get
    )
    inProject(SbtConfig(reposConfig = repos)): projectDir =>
      SbtSettingsGenerator(isGateway = false).generate
      val settings = os.read(projectDir / "project" / "Settings.scala")
      assert(
        settings.contains("credentials ++= Seq(democompanyCredentials, democompanyDependencyCredentials)"),
        settings
      )
      assert(settings.contains("resolvers ++= Seq(releaseRepo, mavenRepo)"), settings)
      assert(
        settings.contains(
          """lazy val releaseRepoStr = sys.env.get("DEMOCOMPANY_MVN_RELEASE_REPOSITORY").map(_.trim.replaceAll("/+$", "")).filter(_.nonEmpty) match {"""
        ),
        settings
      )
      assert(
        settings.contains(
          """lazy val mavenRepoStr = sys.env.get("DEMOCOMPANY_MVN_DEPENDENCY_REPOSITORY").map(_.trim.replaceAll("/+$", "")).filter(_.nonEmpty) match {"""
        ),
        settings
      )

  test("build.sbt: the worker gets both settings - the build options after the company's"):
    inProject(SbtConfig()): projectDir =>
      SbtGenerator().generate
      val buildSbt = os.read(projectDir / "build.sbt")
      assert(buildSbt.contains("dockerSettings,\n    dockerBuildSettings,"), buildSbt)
      assert(buildSbt.contains("enablePlugins(DockerPlugin, JavaAppPackaging)"), buildSbt)

  /** The release check builds the pom URLs from the company name and `<project>-<module>` without
    * a suffix - what the generated build publishes: `organization := ProjectDef.org`, the name,
    * `crossPaths := false`.
    */
  test("the generated build publishes what the release check looks for"):
    inProject(SbtConfig()): projectDir =>
      SbtGenerator().generate
      SbtSettingsGenerator(isGateway = false).generate
      val projectDef = os.read(projectDir / "project" / "ProjectDef.scala")
      val settings   = os.read(projectDir / "project" / "Settings.scala")
      assert(projectDef.contains("""val org = "democompany""""), projectDef)
      assert(projectDef.contains("""val name = "democompany-customer""""), projectDef)
      assert(settings.contains("organization := ProjectDef.org"), settings)
      // the check uses the first repo of the config - the one the generated build publishes to
      val first = summon[DevConfig].sbtConfig.reposConfig.repos.head.name
      assert(settings.contains(s"publishTo := Some(${first}Repo)"), settings)
      assert(settings.contains("""name := s"${ProjectDef.name}${module.map(p => s"-$p").getOrElse("")}""""), settings)
      assertEquals(orchescala.helper.dev.publish.RepoCheck.artifactSuffix(settings), "")
      // the poms the check looks for, derived from the generated build: ProjectDef.org/name and
      // the modules of build.sbt (`projectSettings(Some("<module>"))`)
      import orchescala.helper.dev.publish.RepoCheck
      val Org     = """val org = "([^"]+)"""".r
      val Name    = """val name = "([^"]+)"""".r
      val Modules = """projectSettings\(Some\("([^"]+)"\)\)""".r
      val org     = Org.findFirstMatchIn(projectDef).get.group(1)
      val name    = Name.findFirstMatchIn(projectDef).get.group(1)
      val modules = Modules.findAllMatchIn(os.read(projectDir / "build.sbt")).map(_.group(1)).toSeq
      val repo    = orchescala.engine.config.RepoConfig.Gitlab("release", "https://repo")
      // the names read from the generated project/ files are the ones the check uses
      val names = RepoCheck.BuildNames.from(projectDir)
      assertEquals(names, RepoCheck.BuildNames(org, name, modules, ""))
      assertEquals(
        RepoCheck.releaseUrls("1.2.3", names, repo).sorted,
        RepoCheck.releaseArtifactUrls("https://repo", org, modules.map(m => s"$name-$m"), "1.2.3").sorted
      )

  /** Parses the generated sbt code with the dialect of sbt (Scala 2.12) - a syntax error in a
    * template shows up here, not only in the build of a project.
    *
    * The semantics are not checked here (the sbt API is not on the test classpath) - after a
    * change of a template, check them on a company project:
    *   1. `./helper.scala update` in a project of the company (with the new helper)
    *   2. `sbt "show worker/resolvers" "show worker/credentials" "show worker/dockerRepository"
    *      "show worker/dockerBaseImage" worker/update` - with the `{COMPANY}_MVN_*` and
    *      `{COMPANY}_DOCKER_*` variables set, unset, empty and with an `@`: the resolvers, the
    *      host of the credentials and the warnings follow them, `update` loads from the repos.
    */
  private def assertParses(code: String, file: String): Unit =
    import scala.meta.*
    dialects.Sbt1(code).parse[Source] match
      case Parsed.Success(_)   => ()
      case error: Parsed.Error => fail(s"$file does not parse: $error\n$code")

  test("the parse check finds a syntax error"):
    import scala.meta.*
    assert(dialects.Sbt1("object Settings { lazy val x = { }").parse[Source].isInstanceOf[Parsed.Error])

  test("the generated build parses - the repos and the docker settings from the env variables"):
    import orchescala.engine.config.{RepoConfig, RepoCredentials, ReposConfig}
    val fromEnv = ReposConfig.artifactoryFromEnv(
      "democompany",
      Map(
        "DEMOCOMPANY_MVN_RELEASE_REPOSITORY"    -> "https://bin.example.com/artifactory/releases",
        "DEMOCOMPANY_MVN_DEPENDENCY_REPOSITORY" -> "https://deps.example.com/artifactory/virtual"
      ).get
    )
    // and a GitLab repo with its token - the other templates
    val repos   = fromEnv.copy(
      credentials = fromEnv.credentials :+ RepoCredentials.PrivateToken("gitlab", "gitlab.example.com", "GITLAB_TOKEN"),
      repos = fromEnv.repos :+ RepoConfig.Gitlab("gitlab", "https://gitlab.example.com/api/v4/projects/1/packages/maven", urlEnv = Some("GITLAB_REPO"))
    )
    val docker  = SbtConfig.dockerSettingsFromEnv(
      "democompany",
      defaultRepository = Some("registry.example.com"),
      otherSettings = Seq(
        """dockerEntrypoint := Seq(
          |      "/opt/sbin/entrypoint.sh",
          |      s"${(Docker / defaultLinuxInstallLocation).value}/bin/${ProjectDef.name}-worker"
          |    )""".stripMargin
      )
    )
    inProject(SbtConfig(reposConfig = repos, dockerSettings = Some(docker))): projectDir =>
      SbtGenerator().generate
      SbtSettingsGenerator(isGateway = false).generate
      assertParses(os.read(projectDir / "project" / "Settings.scala"), "project/Settings.scala")
      assertParses(os.read(projectDir / "build.sbt"), "build.sbt")
      SbtSettingsGenerator(isGateway = true).generate
      assertParses(os.read(projectDir / "project" / "Settings.scala"), "project/Settings.scala (gateway)")

  test("the generated build parses - the defaults"):
    inProject(SbtConfig()): projectDir =>
      SbtGenerator().generate
      SbtSettingsGenerator(isGateway = false).generate
      assertParses(os.read(projectDir / "project" / "Settings.scala"), "project/Settings.scala")
      assertParses(os.read(projectDir / "build.sbt"), "build.sbt")

end SbtSettingsGeneratorTest
