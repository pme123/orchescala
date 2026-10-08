package orchescala.helper.util

import orchescala.engine.config.{ReposConfig}

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
    dockerBuildOptions: Seq[String] = SbtConfig.amd64
)

object SbtConfig:
  /** `docker build --platform linux/amd64` - the image OpenShift runs, built on any machine. */
  val amd64: Seq[String] = Seq("--platform", "linux/amd64")

  /** The sbt setting that fixes the docker build options - `Settings.scala` adds it to the
    * `dockerSettings` of the company, so `./helper.scala update` keeps it.
    */
  def dockerBuildSettings(options: Seq[String]): String =
    val setting =
      if options.isEmpty then ""
      else s"\n    dockerBuildOptions ++= Seq(${options.map(o => s"\"$o\"").mkString(", ")})\n  "
    s"""  // the options of `docker build` (SbtConfig.dockerBuildOptions in CompanyDevConfig)
       |  lazy val dockerBuildSettings: Seq[Setting[_]] = Seq($setting)""".stripMargin
end SbtConfig
