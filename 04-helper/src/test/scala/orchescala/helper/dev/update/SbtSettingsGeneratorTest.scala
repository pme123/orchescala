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

end SbtSettingsGeneratorTest
