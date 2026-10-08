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
      assert(settings.contains("lazy val dockerSettings = Seq()"), settings)

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

end SbtSettingsGeneratorTest
