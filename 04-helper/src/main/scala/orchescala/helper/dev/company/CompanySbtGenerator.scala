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
    createIfNotExists(buildSbtDir, buildSbt)
    sbtGenerator.generateBuildProperties(helperCompanyDoNotAdjustText)
    createOrUpdate(config.sbtProjectDir / "plugins.sbt", pluginsSbt)
    createOrUpdate(config.sbtProjectDir / "ProjectDef.scala", projectDev)
    createOrUpdate(config.sbtProjectDir / "Settings.scala", settings)
  end generate

  private lazy val projectConf = config.apiProjectConfig
  private lazy val buildSbtDir = config.projectDir / "build.sbt"
  private lazy val companyNameUpper = companyName.toUpperCase()

  private lazy val projectDev =
    s"""// $helperCompanyDoNotAdjustText
       |
       |object ProjectDef {
       |  val org = "$companyName"
       |  val name = "$companyName-orchescala"
       |  val version = "0.1.0-SNAPSHOT"
       |}
       |""".stripMargin

  private lazy val settings =
    s"""$helperCompanyDoNotAdjustText
       |
       |import com.typesafe.config.ConfigFactory
       |import laika.ast.Path.Root
       |import laika.config.{LinkValidation, SyntaxHighlighting, Version, Versions}
       |import laika.format.Markdown.GitHubFlavor
       |import laika.helium.Helium
       |import laika.helium.config.{Favicon, HeliumIcon, IconLink}
       |import laika.sbt.LaikaPlugin.autoImport.*
       |import sbt.*
       |import sbt.Keys.*
       |import sbtbuildinfo.BuildInfoPlugin.autoImport.{BuildInfoKey, buildInfoKeys, buildInfoPackage}
       |
       |import scala.jdk.CollectionConverters.asScalaBufferConverter
       |
       |object Settings {
       |
       |  val scalaV = "${BuildInfo.scalaVersion}"
       |  val orchescalaV = "${BuildInfo.version}"
       |  val camundaV = "${BuildInfo.camundaVersion}"
       |  val mUnitVersion = "${BuildInfo.mUnitVersion}"
       |  val zioVersion = "${BuildInfo.zioVersion}"
       |  // project
       |  val projectOrg = ProjectDef.org
       |  val projectV = ProjectDef.version
       |  val projectName = ProjectDef.name
       |
       |  def buildInfoSettings(additionalKeys: BuildInfoKey*) = Seq(
       |    buildInfoKeys := Seq[BuildInfoKey](
       |      BuildInfoKey("name", s"$$projectOrg-orchescala"),
       |      version,
       |      scalaVersion,
       |      sbtVersion,
       |      BuildInfoKey("orchescalaV", orchescalaV),
       |    ) ++ additionalKeys,
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
       |  // docs
       |  lazy val laikaSettings = Seq(
       |    sourcesInBase := false,
       |    laikaConfig := LaikaConfig.defaults
       |      .withConfigValue(LinkValidation.Local)
       |      .withConfigValue("orchescala.docs", "https://pme123.github.io/orchescala/")
       |      .withRawContent,
       |    Laika / sourceDirectories := Seq(baseDirectory.value / "src" / "docs")
       |    //  .failOnMessages(MessageFilter.None)
       |    //  .renderMessages(MessageFilter.None)
       |    ,
       |    laikaExtensions := Seq(GitHubFlavor, SyntaxHighlighting),
       |    laikaTheme := Helium.defaults.site
       |      .topNavigationBar(
       |        homeLink = IconLink.internal(Root / "index.md", HeliumIcon.home)
       |      )
       |      .site
       |      .favIcons(
       |        Favicon.internal(Root / "favicon.ico", sizes = "32x32")
       |      )
       |      .site
       |      .versions(versions)
       |      .build
       |  )
       |
       |  lazy val config = ConfigFactory.parseFile(new File("00-docs/CONFIG.conf"))
       |  lazy val currentVersion = config.getString("release.tag")
       |  lazy val released = config.getBoolean("released")
       |  lazy val olderVersions = config.getList("releases.older").asScala
       |  lazy val versions = Versions
       |    .forCurrentVersion(Version(currentVersion, currentVersion).withLabel(if (released)
       |      "Stable"
       |    else "Dev"))
       |    .withOlderVersions(
       |      olderVersions.map(_.unwrapped().toString).map(v => Version(v, v)) *
       |    )
       |
       |  def loadingMessage = s\"\"\"Successfully started.
       |                          |- Project: $$projectOrg : $$projectName : $$projectV
       |                          |- Orchescala: $$orchescalaV
       |                          |- Scala: $$scalaV
       |                          |- Camunda: $$camundaV
       |                          |\"\"\".stripMargin
       |
       |  // dependencies
       |  val typesafeConfigDep = "com.typesafe" % "config" % "1.4.3"
       |
       |  lazy val domainDeps = Seq(
       |    "io.github.pme123" %% "orchescala-domain" % orchescalaV
       |  )
       |  lazy val engineDeps = Seq(
       |    "io.github.pme123" %% "orchescala-engine-c7" % orchescalaV,
       |  )
       |  lazy val apiDeps = Seq(
       |    "io.github.pme123" %% "orchescala-api" % orchescalaV,
       |    typesafeConfigDep
       |  )
       |  lazy val dmnDeps = Seq(
       |    "io.github.pme123" %% "orchescala-dmn" % orchescalaV
       |  )
       |  lazy val simulationDeps = Seq(
       |    "io.github.pme123" %% "orchescala-simulation" % orchescalaV,
       |  )
       |  lazy val workerDeps = Seq(
       |    "io.github.pme123" %% "orchescala-worker-c7" % orchescalaV,
       |    //"io.github.pme123" %% "orchescala-worker-c8" % orchescalaV,
       |  )
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
       |    throw new IllegalArgumentException(
       |        "System Environment Variable ${companyNameUpper}_MVN_RELEASE_REPOSITORY is not set."
       |      )
       |  )
       |  lazy val mavenRepoStr           = sys.env.getOrElse(
       |    "${companyNameUpper}_MVN_DEPENDENCY_REPOSITORY",
       |    throw new IllegalArgumentException(
       |        "System Environment Variable ${companyNameUpper}_MVN_DEPENDENCY_REPOSITORY is not set."
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
       |}
       |""".stripMargin

  private lazy val buildSbt =
    s"""// $helperCompanyHowToResetText
       |import sbt.*
       |import sbt.Keys.*
       |import Settings.*
       |
       |ThisBuild / version := projectV
       |ThisBuild / organization := projectOrg
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
       |    helper,
       |    docs
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
       |  .dependsOn(domain)
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
       |  .settings(libraryDependencies ++= workerDeps)
       |  .dependsOn(engine)
       |
       |lazy val helper = project
       |  .in(file("./04-helper"))
       |  .settings(generalSettings(Some("helper")))
       |  .settings(publicationSettings)
       |  .settings(libraryDependencies ++= helperDeps)
       |  .dependsOn(api, simulation)
       |
       |lazy val docs = project
       |  .in(file("./00-docs"))
       |  .settings(
       |    name := s"$$projectName-docs"
       |  )
       |  .settings(generalSettings())
       |  .settings(preventPublication)
       |  .dependsOn(helper)
       |  .settings(laikaSettings)
       |  .enablePlugins(LaikaPlugin)
       |
       |
       |""".stripMargin
  end buildSbt

  private lazy val pluginsSbt =
    s"""$helperCompanyDoNotAdjustText
       |addDependencyTreePlugin // sbt dependencyBrowseTreeHTML -> target/tree.html
       |
       |addSbtPlugin("org.jetbrains.scala" % "sbt-ide-settings" % "1.1.2")
       |addSbtPlugin("com.eed3si9n" % "sbt-buildinfo" % "0.12.0")
       |
       |// docs
       |addSbtPlugin("org.typelevel" % "laika-sbt" % "1.3.0")
       |
       |// docker (optional)
       |addSbtPlugin("com.github.sbt" % "sbt-native-packager" % "1.10.0")
       |""".stripMargin

end CompanySbtGenerator
