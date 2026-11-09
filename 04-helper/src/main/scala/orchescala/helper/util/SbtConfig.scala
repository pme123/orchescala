package orchescala.helper.util

import orchescala.engine.config.{ReposConfig, SbtCode}

case class SbtConfig(
    // sbt settings for publishing
    reposConfig: ReposConfig = ReposConfig.dummyRepos,
    // sbt settings for docker
    dockerSettings: Option[String] = None,
    dockerGatewaySettings: Option[String] = None,
    // options of `docker build` (sbt-native-packager's `dockerBuildOptions`), generated as
    // `dockerBuildSettings` in `project/Settings.scala`. OpenShift runs amd64 images only,
    // while an Apple Silicon machine builds arm64 by default - so the platform is fixed.
    // Seq.empty builds for the platform of the machine.
    dockerBuildOptions: Seq[String] = SbtConfig.amd64,
    // the options of the sbt runs of `./helper.scala publish` (e.g. the heap) - a runner with
    // less memory sets its own
    publishSbtOptions: Seq[String] = Seq("-J-Xmx3G")
)

object SbtConfig:
  /** `docker build --platform linux/amd64` - the image OpenShift runs, built on any machine. */
  val amd64: Seq[String] = Seq("--platform", "linux/amd64")

  /** The docker settings (`dockerSettings` / `dockerGatewaySettings`) from the env variables of
    * the company - the generated build reads them, so the images follow them:
    *   - `{COMPANY}_DOCKER_REPOSITORY`: the registry the images are pushed to
    *   - `{COMPANY}_DOCKER_BASE_IMAGE`: the base image
    *
    * Without a variable the default here is taken, without that the one of sbt-native-packager.
    * `otherSettings` are added as they are, e.g. a `dockerEntrypoint := Seq(...)`.
    */
  def dockerSettingsFromEnv(
      companyName: String,
      defaultRepository: Option[String] = None,
      defaultBaseImage: Option[String] = None,
      otherSettings: Seq[String] = Seq.empty
  ): String =
    val repositoryEnv = SbtCode.companyEnvName(companyName, "DOCKER_REPOSITORY")
    val baseImageEnv  = SbtCode.companyEnvName(companyName, "DOCKER_BASE_IMAGE")
    // `key := f(key.value)` takes the value before this setting (the one of sbt-native-packager) -
    // checked with `show worker/dockerRepository` / `dockerBaseImage`, with and without variables
    val repository    =
      s"""dockerRepository := sys.env.get(${scalaString(repositoryEnv)})${
          defaultRepository.map(r => s".orElse(Some(${scalaString(r)}))").getOrElse(".orElse(dockerRepository.value)")
        }"""
    val baseImage     =
      s"""dockerBaseImage := sys.env.getOrElse(${scalaString(baseImageEnv)}, ${
          defaultBaseImage.map(scalaString).getOrElse("dockerBaseImage.value")
        })"""
    (Seq(repository, baseImage) ++ otherSettings)
      .mkString("Seq(\n    ", ",\n    ", "\n  )")
  end dockerSettingsFromEnv

  /** The sbt setting of the docker build options - its own `dockerBuildSettings` in
    * `Settings.scala`, next to the `dockerSettings` of the company (which stay as they are).
    * `build.sbt` adds both to the docker modules, so `./helper.scala update` keeps the options.
    */
  def dockerBuildSettings(options: Seq[String]): String =
    val setting =
      if options.isEmpty then ""
      else s"\n    dockerBuildOptions ++= Seq(${options.map(scalaString).mkString(", ")})\n  "
    // `Setting[_]`: sbt's build definition is Scala 2.12 - it has no `?`
    s"""  // the options of `docker build` (SbtConfig.dockerBuildOptions in CompanyDevConfig)
       |  lazy val dockerBuildSettings: Seq[Setting[_]] = Seq($setting)""".stripMargin
  end dockerBuildSettings

  /** A Scala string literal of `value` - quotes and backslashes escaped. */
  private def scalaString(value: String): String = SbtCode.literal(value)

end SbtConfig
