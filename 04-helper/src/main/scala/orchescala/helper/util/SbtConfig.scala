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

  /** The base image of the docker images, if the company sets none. The default of
    * sbt-native-packager (`openjdk:8`) is no longer on Docker Hub - and Scala 3 needs Java 17+.
    */
  val defaultBaseImage: String = "eclipse-temurin:21-jre"

  /** The docker settings of a project, if the company sets none. */
  lazy val defaultDockerSettings: String =
    s"Seq(dockerBaseImage := ${scalaString(defaultBaseImage)})"

  /** The docker settings (`dockerSettings` / `dockerGatewaySettings`) from the env variables of
    * the company - the generated build reads them, so the images follow them:
    *   - `{COMPANY}_DOCKER_REPOSITORY`: the registry the images are pushed to
    *   - `{COMPANY}_DOCKER_BASE_IMAGE`: the base image
    *
    * Without a variable the default here is taken (repository: without one, the one of
    * sbt-native-packager). `otherSettings` are added as they are, e.g. a
    * `dockerEntrypoint := Seq(...)` of a base image with its own entrypoint script.
    */
  def dockerSettingsFromEnv(
      companyName: String,
      defaultRepository: Option[String] = None,
      defaultBaseImage: String = SbtConfig.defaultBaseImage,
      otherSettings: Seq[String] = Seq.empty
  ): String =
    val repositoryEnv      = SbtCode.companyEnvName(companyName, "DOCKER_REPOSITORY")
    val baseImageEnv       = SbtCode.companyEnvName(companyName, "DOCKER_BASE_IMAGE")
    // without variable and default: the repository of sbt-native-packager - `key := f(key.value)`
    // takes the value before this setting; checked with `show worker/dockerRepository`, with and
    // without the variable (the generated build is not compiled by the tests)
    val repositoryFallback =
      defaultRepository.map(r => s"Some(${scalaString(r)})").getOrElse("dockerRepository.value")
    val repository         =
      s"dockerRepository := ${SbtCode.envValue(repositoryEnv)}.orElse($repositoryFallback)"
    val baseImage          =
      s"dockerBaseImage := ${SbtCode.envOrElse(Some(baseImageEnv), defaultBaseImage)}"
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
