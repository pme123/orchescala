import Dependencies.*
import Settings.*
import laika.ast.Path.Root
import laika.config.*
import laika.format.Markdown.GitHubFlavor
import laika.helium.Helium
import laika.helium.config.{Favicon, HeliumIcon, IconLink}

ThisBuild / versionScheme          := Some("early-semver")
ThisBuild / sonatypeCredentialHost := "s01.oss.sonatype.org"
ThisBuild / evictionErrorLevel     := Level.Warn
//Problems in Scala 3.5.0: ThisBuild / usePipelining := true

lazy val root = project
  .in(file("."))
  .configure(preventPublication)
  .settings(
    name          := "orchescala",
    organization  := org,
    sourcesInBase := false
  )
  .aggregate(
    docs,
    domain,
    engine,
    api,
    dmn,
    simulation,
    helper
  )

// general independent
lazy val docs =
  (project in file("./00-docs"))
    .configure(preventPublication)
    .settings(
      projectSettings("docs"),
      autoImportSetting,
      laikaSettings,
      mdocSettings
    )
    .enablePlugins(LaikaPlugin, MdocPlugin)
    .dependsOn(helper)

// layer 01
lazy val domain = project
  .in(file("./01-domain"))
  .configure(publicationSettings)
  .settings(projectSettings("domain"))
  .settings(unitTestSettings)
  .settings(
    autoImportSetting,
    libraryDependencies ++= tapirDependencies ++ Seq(
      osLib,
      chimney // mapping
    ),
    buildInfoPackage := "orchescala",
    buildInfoKeys    := Seq[BuildInfoKey](
      organization,
      name,
      version,
      scalaVersion,
      sbtVersion,
      BuildInfoKey("camundaVersion", camundaVersion),
      BuildInfoKey("springBootVersion", springBootVersion),
      BuildInfoKey("jaxbApiVersion", jaxbApiVersion),
      BuildInfoKey("osLibVersion", osLibVersion),
      BuildInfoKey("mUnitVersion", mUnitVersion),
      BuildInfoKey("zioVersion", zioVersion),
      BuildInfoKey("logbackVersion", logbackVersion),
      BuildInfoKey("dmnTesterVersion", dmnTesterVersion)
    )
  ).enablePlugins(BuildInfoPlugin)
// layer 02
lazy val engine = project
  .in(file("./02-engine"))
  .configure(publicationSettings)
  .settings(projectSettings("engine"))
  .settings(unitTestSettings)
  .settings(
    autoImportSetting,
    libraryDependencies ++= Seq(
      zioDependency
    )
  )
  .dependsOn(domain)

// layer 03
lazy val api = project
  .in(file("./03-api"))
  .configure(publicationSettings)
  .settings(projectSettings("api"))
  .settings(unitTestSettings)
  .settings(
    autoImportSetting,
    libraryDependencies ++=
      Seq(
        "org.scala-lang.modules" %% "scala-xml" % scalaXmlVersion,
        "com.typesafe"            % "config"    % typesafeConfigVersion
      )
  )
  .dependsOn(engine)

lazy val dmn = project
  .in(file("./03-dmn"))
  .configure(publicationSettings)
  .settings(projectSettings("dmn"))
  .settings(unitTestSettings)
  .settings(
    libraryDependencies ++= sttpDependencies :+
      "io.github.pme123" %% "camunda-dmn-tester-shared" % dmnTesterVersion
  )
  .dependsOn(engine)

lazy val simulation = project
  .in(file("./03-simulation"))
  .configure(publicationSettings)
  .settings(projectSettings("simulation"))
  .settings(
    autoImportSetting,
    libraryDependencies ++= sttpDependencies ++ Seq(
      "org.scala-sbt" % "test-interface" % testInterfaceVersion
    )
  )
  .dependsOn(engine)

// layer 04
lazy val helper = project
  .in(file("./04-helper"))
  .configure(publicationSettings)
  .settings(projectSettings("helper"))
  .settings(unitTestSettings)
  .settings(
    autoImportSetting,
    libraryDependencies ++= Seq(osLib, swaggerOpenAPI, sardineWebDav)
  ).dependsOn(api, simulation, engine)
