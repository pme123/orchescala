package orchescala.helper.dev.company

import orchescala.BuildInfo
import orchescala.helper.dev.update.*

case class CompanySbtGenerator()(using
    config: DevConfig
):
  lazy val companyName = config.companyName

  lazy val sbtGenerator   = SbtGenerator()
  lazy val generate: Unit =
    println("Generate Company Sbt")
    createOrUpdate(buildSbtDir, buildSbt)
    sbtGenerator.generateBuildProperties(helperCompanyDoNotAdjustText)
    createOrUpdate(config.sbtProjectDir / "plugins.sbt", pluginsSbt)
    createIfNotExists(config.sbtProjectDir / "ProjectDef.scala", projectDev)
    createOrUpdate(config.sbtProjectDir / "Settings.scala", settings)
  end generate

  private lazy val projectConf      = config.apiProjectConfig
  private lazy val buildSbtDir      = config.projectDir / "build.sbt"
  private lazy val companyNameUpper = companyName.toUpperCase()

  private lazy val projectDev =
    s"""import sbtbuildinfo.BuildInfoPlugin.autoImport.BuildInfoKey
       |
       |object ProjectDef {
       |  val org = "$companyName"
       |  val name = "$companyName-orchescala"
       |  val version = "0.1.0-SNAPSHOT"
       |
       |  // val myLibraryVersion = 1.2.3
       |
       |  def additionalBuildInfoKeys = Seq(
       |     // BuildInfoKey("MyLibraryVersion", myLibraryVersion)
       |  )
       |
       |  def additionalLoadingMessage = "" // "- MyLibraryVersion: $$myLibraryVersion"
       |
       |  def defaultReleaseRepo =
       |    None // Some("https://artifactory.mycompany.com/releases")
       |
       |  def defaultDependencyRepo =
       |    None // Some("https://artifactory.mycompany.com/dependencies")
       |}
       |""".stripMargin

  private lazy val settings =
    s"""$helperCompanyDoNotAdjustText
       |
       |import com.typesafe.sbt.SbtNativePackager.Docker
       |import com.typesafe.sbt.packager.Keys.*
       |import sbt.*
       |import sbt.Keys.*
       |import sbtbuildinfo.BuildInfoPlugin.autoImport.{BuildInfoKey, buildInfoKeys, buildInfoPackage}
       |
       |object Settings {
       |
       |  val scalaV = "${BuildInfo.scalaVersion}"
       |  val orchescalaV = "${BuildInfo.version}"
       |  val camundaV = "${BuildInfo.camundaVersion}"
       |  val mUnitVersion = "${BuildInfo.mUnitVersion}"
       |  val zioVersion = "${BuildInfo.zioVersion}"
       |  val zioLoggingVersion = "${BuildInfo.zioLoggingVersion}"
       |  val logbackVersion = "${BuildInfo.logbackVersion}"
       |  val jaxbApiVersion = "${BuildInfo.jaxbApiVersion}"
       |
       |  // project
       |  val projectOrg = ProjectDef.org
       |  val projectV = ProjectDef.version
       |  val projectName = ProjectDef.name
       |
       |  def buildInfoSettings() = Seq(
       |    buildInfoKeys := Seq[BuildInfoKey](
       |      BuildInfoKey("name", s"$$projectOrg-orchescala"),
       |      version,
       |      scalaVersion,
       |      sbtVersion,
       |      BuildInfoKey("orchescalaV", orchescalaV),
       |    ) ++ ProjectDef.additionalBuildInfoKeys,
       |    buildInfoPackage := s"$$projectOrg.orchescala"
       |  )
       |
       |  def generalSettings(module: Option[String] = None) = Seq(
       |    scalaVersion := scalaV,
       |    autoImportSetting(module),
       |    scalacOptions ++= Seq(
       |      "-Xmax-inlines:200" // is declared as erased, but is in fact used
       |      // "-Vprofile",
       |    ),
       |    resolvers ++= Seq(releaseRepo),
       |
       |  ) ++ module.map(m => name := s"$$projectName-$$m").toSeq
       |
       |  def autoImportSetting(module: Option[String] = None) =
       |    scalacOptions +=
       |      (module.toSeq.map(m => s"orchescala.$$m") ++
       |        Seq(
       |          "java.lang", "java.time", "scala", "scala.Predef", "orchescala.domain",
       |          "io.circe",
       |          "io.circe.generic.semiauto", "io.circe.derivation", "io.circe.syntax", "sttp.tapir",
       |          "sttp.tapir.json.circe"
       |        )).mkString(start = "-Yimports:", sep = ",", end = "")
       |
       |  def loadingMessage = s\"\"\"Successfully started.
       |                          |- Project: $$projectOrg : $$projectName : $$projectV
       |                          |- Orchescala: $$orchescalaV
       |                          |- Scala: $$scalaV
       |                          |- Camunda: $$camundaV
       |                          |$${ProjectDef.additionalLoadingMessage}
       |                          |\"\"\".stripMargin
       |
       |  // dependencies
       |  val typesafeConfigDep = "com.typesafe" % "config" % "1.4.3"
       |
       |  lazy val domainDeps = Seq(
       |    "io.github.pme123" %% "orchescala-domain" % orchescalaV
       |  )
       |  lazy val engineDeps = Seq(
       |    "io.github.pme123" %% "orchescala-engine-gateway" % orchescalaV,
       |  )
       |  lazy val apiDeps = Seq(
       |    "io.github.pme123" %% "orchescala-api" % orchescalaV,
       |    typesafeConfigDep
       |  )
       |  lazy val dmnDeps = Seq(
       |    // The DMN Tester - brings orchescala-dmn (the DSL) and
       |    // orchescala-dmntester (the model) with it.
       |    // The DMN engine is a Scala 2.13 jar whose FEEL parser drags in
       |    // geny_2.13, while os-lib brings geny_3 - the same library in two
       |    // cross versions, which sbt refuses. The engine works fine with
       |    // geny_3, so the 2.13 one is excluded here as well as upstream.
       |    ("io.github.pme123" %% "orchescala-dmntester-server" % orchescalaV)
       |      .exclude("com.lihaoyi", "geny_2.13")
       |  )
       |  lazy val simulationDeps = Seq(
       |    "io.github.pme123" %% "orchescala-simulation" % orchescalaV,
       |  )
       |  lazy val workerDeps = Seq(
       |    "io.github.pme123" %% "orchescala-worker-c7" % orchescalaV,
       |    //"io.github.pme123" %% "orchescala-worker-c8" % orchescalaV,
       |  )
       |
       |  lazy val gatewayDeps = Seq(
       |      "ch.qos.logback" % "logback-classic" % logbackVersion % Runtime,
       |      "dev.zio" %% "zio-logging-slf4j2" % zioLoggingVersion,
       |      "jakarta.xml.bind" % "jakarta.xml.bind-api" % jaxbApiVersion,
       |      "io.github.pme123" %% "orchescala-gateway" % orchescalaV
       |    )
       |
       |  lazy val helperDeps = apiDeps ++ Seq(
       |    "io.github.pme123" %% "orchescala-helper" % orchescalaV
       |  )
       |
       |  lazy val unitTestSettings = Seq(
       |    libraryDependencies += "org.scalameta" %% "munit" % mUnitVersion % Test,
       |    testFrameworks += new TestFramework("munit.Framework")
       |  )
       |
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
       |  // REPOS
       |  lazy val releaseRepoStr: String = sys.env.getOrElse(
       |    "${companyNameUpper}_MVN_RELEASE_REPOSITORY",
       |    ProjectDef.defaultReleaseRepo
       |      .getOrElse(
       |        throw new IllegalArgumentException(
       |          "System Environment Variable ${companyNameUpper}_MVN_RELEASE_REPOSITORY is not set."
       |        )
       |      )
       |  )
       |  lazy val mavenRepoStr           = sys.env.getOrElse(
       |    "${companyNameUpper}_MVN_DEPENDENCY_REPOSITORY",
       |    ProjectDef.defaultDependencyRepo
       |      .getOrElse(
       |        throw new IllegalArgumentException(
       |          "System Environment Variable ${companyNameUpper}_MVN_DEPENDENCY_REPOSITORY is not set."
       |        )
       |      )
       |  )
       |
       |  lazy val artifactoryRealm             = "Artifactory Realm"
       |  lazy val releaseRepo: MavenRepository = artifactoryRealm at releaseRepoStr
       |  // not in use
       |  // lazy val mavenRepo: MavenRepository   = artifactoryRealm at mavenRepoStr
       |  lazy val repoCredentials: Credentials = (for {
       |    user <- sys.env.get("${companyNameUpper}_MVN_REPOSITORY_USERNAME")
       |    pwd  <- sys.env.get("${companyNameUpper}_MVN_REPOSITORY_PASSWORD")
       |  } yield Credentials(artifactoryRealm, "bin.swisscom.com", user, pwd))
       |    .getOrElse(
       |      throw new IllegalArgumentException(
       |        "System Environment Variables ${companyNameUpper}_MVN_REPOSITORY_USERNAME and/ or ${companyNameUpper}_MVN_REPOSITORY_PASSWORD are not set."
       |      )
       |    )
       |  // publish
       |
       |  lazy val publicationSettings = Seq(
       |    credentials ++= Seq(repoCredentials),
       |    isSnapshot                   := false,
       |    publishTo                    := Some(releaseRepo),
       |    // Enables publishing to maven repo
       |    publishMavenStyle            := true,
       |    packageDoc / publishArtifact := false,
       |    // disable using the Scala version in output paths and artifacts
       |    // crossPaths := false,
       |    // logLevel := Level.Debug,
       |  )
       |
       |  lazy val preventPublication = Seq(
       |    publish := {},
       |    publishArtifact := false,
       |    publishLocal := {}
       |  )
       |
       |  // gateway
       |  lazy val dockerSettings = ${config.sbtConfig.dockerGatewaySettings.getOrElse("preventPublication")}
       |}
       |""".stripMargin

  private lazy val buildSbt =
    s"""// $helperCompanyDoNotAdjustText
       |import sbt.*
       |import sbt.Keys.*
       |import Settings.*
       |
       |ThisBuild / version := projectV
       |ThisBuild / organization := projectOrg
       |ThisBuild / versionScheme := Some("early-semver")
       |ThisBuild / onLoadMessage := loadingMessage
       |
       |lazy val root = (project in file("."))
       |  .settings(name := projectName, sourcesInBase := false)
       |  .settings(preventPublication)
       |  .aggregate(
       |    domain,
       |    engine,
       |    api,
       |    dmn,
       |    simulation,
       |    worker,
       |    gateway,
       |    helper
       |  )
       |
       |lazy val domain = project
       |  .in(file("./01-domain"))
       |  .settings(generalSettings(Some("domain")))
       |  .settings(publicationSettings)
       |  .settings(libraryDependencies ++= domainDeps)
       |  .settings(buildInfoSettings())
       |  .enablePlugins(BuildInfoPlugin)
       |
       |lazy val engine = project
       |  .in(file("./02-engine"))
       |  .settings(generalSettings(Some("engine")))
       |  .settings(publicationSettings)
       |  .settings(libraryDependencies ++= engineDeps)
       |  .dependsOn(domain)
       |
       |lazy val api = project
       |  .in(file("./03-api"))
       |  .settings(generalSettings(Some("api")))
       |  .settings(publicationSettings)
       |  .settings(unitTestSettings)
       |  .settings(libraryDependencies ++= apiDeps)
       |  .dependsOn(engine)
       |
       |lazy val dmn = project
       |  .in(file("./03-dmn"))
       |  .settings(generalSettings(Some("dmn")))
       |  .settings(publicationSettings)
       |  .settings(libraryDependencies ++= dmnDeps)
       |  .dependsOn(domain)
       |
       |lazy val simulation = project
       |  .in(file("./03-simulation"))
       |  .settings(generalSettings(Some("simulation")))
       |  .settings(publicationSettings)
       |  .settings(libraryDependencies ++= simulationDeps)
       |  .dependsOn(engine)
       |
       |lazy val worker = project
       |  .in(file("./03-worker"))
       |  .settings(generalSettings(Some("worker")))
       |  .settings(publicationSettings)
       |  .settings(unitTestSettings)
       |  .settings(zioTestSettings)
       |  .settings(libraryDependencies ++= workerDeps)
       |  .dependsOn(engine)
       |
       |lazy val gateway = project
       |  .in(file("./04-gateway"))
       |  .settings(generalSettings(Some("gateway")))
       |  .settings(publicationSettings)
       |  .settings(libraryDependencies ++= gatewayDeps)
       |  .settings(
       |    dockerSettings,
       |    unitTestSettings,
       |    zioTestSettings
       |  )
       |  .dependsOn(worker)
       |  .enablePlugins(${config.sbtConfig.dockerGatewaySettings.map(_ => "DockerPlugin, ").mkString}JavaAppPackaging)
       |
       |lazy val helper = project
       |  .in(file("./04-helper"))
       |  .settings(generalSettings(Some("helper")))
       |  .settings(publicationSettings)
       |  .settings(libraryDependencies ++= helperDeps)
       |  .dependsOn(api, simulation)
       |
       |""".stripMargin
  end buildSbt

  private lazy val pluginsSbt =
    s"""$helperCompanyDoNotAdjustText
       |addSbtPlugin("com.github.sbt" % "sbt-native-packager" % "${BuildInfo.sbtNativePackager}")
       |
       |addSbtPlugin("com.github.sbt" % "sbt-ci-release" % "${BuildInfo.sbtCiRelease}")
       |
       |addSbtPlugin("com.eed3si9n" % "sbt-buildinfo" % "${BuildInfo.sbtBuildInfo}")
       |
       |addDependencyTreePlugin // sbt dependencyBrowseTreeHTML -> target/tree.html
       |""".stripMargin

end CompanySbtGenerator
