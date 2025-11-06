import Dependencies.*
import Settings.*


ThisBuild / versionScheme          := Some("early-semver")

ThisBuild / evictionErrorLevel     := Level.Warn
//Problems in Scala 3.5.0: ThisBuild / usePipelining := true

lazy val root = project
  .in(file("."))
  .settings(preventPublication)
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
    worker,
    helper,
    engineC7,
    engineC8,
    engineGateway,
    gateway,
    workerC7,
    workerC8
  )

// general independent
lazy val docs =
  (project in file("./00-docs"))
    .settings(preventPublication)
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
  .settings(publicationSettings)
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
  .settings(publicationSettings)
  .settings(projectSettings("engine"))
  .settings(unitTestSettings)
  .settings(
    autoImportSetting,
    libraryDependencies ++= Seq(
      zioDependency,
      zioSlf4jDependency
    )
  )
  .dependsOn(domain)

// layer 03
lazy val api = project
  .in(file("./03-api"))
  .settings(publicationSettings)
  .settings(projectSettings("api"))
  .settings(unitTestSettings)
  .settings(
    autoImportSetting,
    libraryDependencies ++=
      Seq(
        zioDependency,
        zioSlf4jDependency,
        "org.scala-lang.modules" %% "scala-xml" % scalaXmlVersion,
        "com.typesafe"            % "config"    % typesafeConfigVersion
      )
  )
  .dependsOn(engine)

lazy val dmn = project
  .in(file("./03-dmn"))
  .settings(publicationSettings)
  .settings(projectSettings("dmn"))
  .settings(unitTestSettings)
  .settings(
    libraryDependencies ++= sttpDependencies :+
      "io.github.pme123" %% "camunda-dmn-tester-shared" % dmnTesterVersion
  )
  .dependsOn(domain)

lazy val simulation = project
  .in(file("./03-simulation"))
  .settings(publicationSettings)
  .settings(projectSettings("simulation"))
  .settings(
    autoImportSetting,
    libraryDependencies ++= Seq(
      "org.scala-sbt" % "test-interface" % testInterfaceVersion
    )
  )
  .dependsOn(engine)

lazy val worker = project
  .in(file("./03-worker"))
  .settings(publicationSettings)
  .settings(
    projectSettings("worker"),
    unitTestSettings,
    autoImportSetting,
    libraryDependencies ++= sttpDependencies ++ Seq(
      scaffeineDependency,
      logbackDependency
    ) ++ zioTestDependencies
  )
  .dependsOn(engine)

// layer 04
lazy val helper = project
  .in(file("./04-helper"))
  .settings(publicationSettings)
  .settings(projectSettings("helper"))
  .settings(unitTestSettings)
  .settings(
    autoImportSetting,
    libraryDependencies ++= Seq(osLib, swaggerOpenAPI, sardineWebDav)
  ).dependsOn(api, simulation)

lazy val engineC7 = project
  .in(file("./04-engine-c7"))
  .settings(publicationSettings)
  .settings(projectSettings("engine-c7"))
  .settings(
    autoImportSetting,
    unitTestSettings,
    libraryDependencies ++= camunda7EngineDependencies ++ zioTestDependencies
  )
  .dependsOn(engine)

lazy val engineC8 = project
  .in(file("./04-engine-c8"))
  .settings(publicationSettings)
  .settings(projectSettings("engine-c8"))
  .settings(
    autoImportSetting,
    unitTestSettings,
    libraryDependencies ++= camunda8EngineDependencies ++ zioTestDependencies
  )
  .dependsOn(engine)

// Task to generate OpenAPI YAML file
lazy val generateOpenApi = taskKey[Unit]("Generate OpenAPI specification YAML file")

lazy val engineGateway = project
  .in(file("./05-engine-gateway"))
  .settings(publicationSettings)
  .settings(projectSettings("engine-gateway"))
  .settings(
    autoImportSetting,
    unitTestSettings,
    libraryDependencies ++= zioTestDependencies ++ Seq(
      scaffeineDependency,
      logbackDependency
    )
  )
  .dependsOn(engineC7, engineC8, worker)

// layer 06
lazy val gateway = project
  .in(file("./06-gateway"))
  .settings(publicationSettings)
  .settings(projectSettings("gateway"))
  .settings(
    autoImportSetting,
    unitTestSettings,
    libraryDependencies ++= zioTestDependencies ++ zioHttpDependencies ++ tapirDependencies ++ Seq(
      scaffeineDependency,
      logbackDependency
    ),
    // Task to generate OpenAPI specification (run manually with: sbt "project gateway" generateOpenApi)
    generateOpenApi := {
      val log = streams.value.log
      log.info("Generating OpenAPI specification...")
      (Compile / runMain).toTask(" orchescala.gateway.GenerateOpenApiYaml").value
    }
  )
  .dependsOn(engineGateway)

lazy val workerC7 = project
  .in(file("./04-worker-c7"))
  .settings(publicationSettings)
  .settings(projectSettings("worker-c7"))
  .settings(unitTestSettings)
  .settings(
    autoImportSetting,
    libraryDependencies ++=
      camunda7ZioWorkerDependencies ++ zioTestDependencies
  )
  .dependsOn(worker)
lazy val workerC8 = project
  .in(file("./04-worker-c8"))
  .settings(publicationSettings)
  .settings(projectSettings("worker-c8"))
  .settings(unitTestSettings)
  .settings(
    autoImportSetting,
    libraryDependencies ++= Seq(
      camunda8JavaClientDependency
    ) ++ zioTestDependencies
  )
  .dependsOn(worker, engineC8)
