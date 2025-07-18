package orchescala.helper.dev.update

import orchescala.BuildInfo

case class SbtSettingsGenerator()(using config: DevConfig):

  lazy val generate: Unit =
    createOrUpdate(config.sbtProjectDir / "Settings.scala", settingsSbt)
  end generate

  private lazy val versionConfig = config.versionConfig
  private lazy val repoConfig    = config.sbtConfig.reposConfig
  private lazy val settingsSbt   =
    s"""$helperDoNotAdjustText
       |
       |import com.typesafe.sbt.SbtNativePackager.Docker
       |import com.typesafe.sbt.packager.Keys.*
       |import sbt.*
       |import sbt.Keys.*
       |
       |object Settings {
       |
       |  val scalaV = "${BuildInfo.scalaVersion}"
       |  val customer = ProjectDef.org
       |  val customerOrchescalaV = "${versionConfig.companyOrchescalaVersion}"
       |  // to override the version defined in customerOrchescala
       |  val orchescalaV = "${versionConfig.orchescalaVersion}"
       |
       |  // other dependencies
       |  // run worker
       |  val mUnitVersion = "${config.versionConfig.munitVersion}"
       |  val mUnit = "org.scalameta" %% "munit" % mUnitVersion % Test
       |  val zioVersion = "${config.versionConfig.zioVersion}"
       |  val logbackVersion = "${config.versionConfig.logbackVersion}"
       |  val jaxbApiVersion = "${config.versionConfig.jaxbXmlVersion}"
       |  
       |$projectSettings
       |$sbtDependencies
       |$sbtPublish
       |$sbtRepos
       |$sbtDocker
       |$testSettings
       |
       |  lazy val loadingMessage = s\"\"\"Successfully started
       |- Dependencies:
       |  - Orchescala: $$orchescalaV
       |  - Camunda: ${versionConfig.camundaVersion}
       |  - Customer-Orchescala: $$customerOrchescalaV
       |  - Scala: $$scalaV
       |${versionConfig.otherVersions.map { case k -> v => s"  - $k: $v" }.mkString("\n")}
       |- Package Config:
       |  - org: $${ProjectDef.org}
       |  - name: $${ProjectDef.name}
       |  - version: $${ProjectDef.version}
       |  - dependencies: $${ProjectDef.domainDependencies.map(_.toString()).sorted.mkString("\\n    - ", "\\n    - ", "")}
       |  \"\"\"
       |$sbtAutoImportSetting
       |}""".stripMargin

  lazy val projectSettings =
    s"""  def projectSettings(
       |                       module: Option[String] = None,
       |                       postfix: Option[String] = None
       |                     ) = Seq(
       |    name := s"$${ProjectDef.name}$${module.map(p => s"-$$p").getOrElse("")}",
       |    organization := ProjectDef.org,
       |    version := ProjectDef.version,
       |    scalaVersion := scalaV,
       |    scalacOptions ++= Seq(
       |      // "-deprecation", // Emit warning and location for usages of deprecated APIs.
       |      // "-feature", // Emit warning and location for usages of features that should be imported explicitly.
       |      // "-rewrite", "-source", "3.4-migration", // migrate automatically to scala 3.4
       |      "-Xmax-inlines:200" // is declared as erased, but is in fact used
       |      // "-Vprofile",
       |    ),
       |    javaOptions ++= Seq(
       |      "-Xmx3g",
       |      "-Xss2m",
       |      "-XX:+UseG1GC",
       |      "-XX:InitialCodeCacheSize=512m",
       |      "-XX:ReservedCodeCacheSize=512m",
       |      "-Dfile.encoding=UTF8"
       |    ),
       |    credentials ++= Seq(${repoConfig.sbtCredentials}),
       |    resolvers ++= Seq(${repoConfig.sbtRepos}),
       |    autoImportSetting(
       |      (postfix orElse module).toSeq.flatMap(x =>
       |         Seq(s"orchescala.$$x", s"$$customer.orchescala.$$x")
       |      )
       |    )
       |  )
       |""".stripMargin
  lazy val sbtPublish      =
    s"""  lazy val preventPublication = Seq(
       |    publish / skip := true,
       |    publish := {},
       |    publishArtifact := false,
       |    publishLocal := {}
       |  )
       |
       |  lazy val publicationSettings = Seq(
       |    publishTo := Some(${repoConfig.repos.head.name}Repo),
       |    // Enables publishing to maven repo
       |    publishMavenStyle := true,
       |    packageDoc / publishArtifact := false,
       |    // logLevel := Level.Debug,
       |    // disable using the Scala version in output paths and artifacts
       |    crossPaths := false
       |  )""".stripMargin

  lazy val sbtDependencies =
    config.modules
      .map: moduleConfig =>
        val name         = moduleConfig.name
        val dependencies = moduleConfig.sbtDependencies
        s"""
           |  lazy val ${name}Deps = ${
            if moduleConfig.hasProjectDependencies then s"ProjectDef.${name}Dependencies ++" else ""
          }
           |    Seq(${
            if dependencies.nonEmpty then dependencies.mkString("\n      ", ",\n      ", ",")
            else ""
          }
           |      customer %% s"$$customer-orchescala-$name" % customerOrchescalaV${
            if name == "worker" then
              ",\n//      \"io.github.pme123\" %% \"orchescala-worker-c7\" % orchescalaV"
            else ""
          }
           |    )
           |""".stripMargin
      .mkString

  lazy val sbtRepos =
    s"""// Credentials
       |${
        repoConfig.credentials
          .map:
            _.sbtContent
          .mkString
      }
       |// Repos
       |${
        repoConfig.repos
          .map:
            _.sbtContent
          .mkString
      }""".stripMargin

  lazy val sbtDocker =
    s"  lazy val dockerSettings = " +
      config.sbtConfig.dockerSettings
        .getOrElse("Seq()")

  lazy val testSettings =
    s"""  lazy val testSettings = Seq(
       |    libraryDependencies += mUnit,
       |    Test / parallelExecution := true,
       |    testFrameworks += new TestFramework("munit.Framework")
       |  )
       |  lazy val simulationSettings = Seq(
       |    Test / parallelExecution := false,
       |    testFrameworks += new TestFramework("orchescala.simulation.SimulationTestFramework")
       |  )
       |  lazy val zioTestSettings = Seq(
       |    libraryDependencies ++= zioTestDependencies,
       |    Test / parallelExecution := true,
       |    testFrameworks += new TestFramework("zio.test.sbt.ZTestFramework")
       |  )
       |  lazy val zioTestDependencies =
       |    Seq(
       |      "dev.zio" %% "zio-test" % zioVersion % Test,
       |      "dev.zio" %% "zio-test-sbt" % zioVersion % Test,
       |    )
       |  
       |""".stripMargin

  lazy val sbtAutoImportSetting =
    """  def autoImportSetting(customAutoSettings: Seq[String]) =
      |    scalacOptions +=
      |      (customAutoSettings ++
      |        Seq(
      |          "java.lang",
      |          "java.time", 
      |          "scala",
      |          "scala.Predef",
      |          "orchescala.domain",
      |          s"$customer.orchescala.domain",
      |          "io.circe.syntax", 
      |          "sttp.tapir.json.circe",
      |          "io.scalaland.chimney.dsl",
      |          "io.github.iltotore.iron",
      |          "io.github.iltotore.iron.constraint",
      |          "io.github.iltotore.iron.circe",
      |          "sttp.tapir.codec.iron"
      |        )).mkString(start = "-Yimports:", sep = ",", end = "")
      |""".stripMargin

end SbtSettingsGenerator
