import Dependencies.*
import Settings.*


ThisBuild / versionScheme          := Some("early-semver")

// Try the DMN Tester with the examples of this repository:
//   sbt dmnTester   ->   http://localhost:8883
addCommandAlias(
  "dmnTester",
  "dmnTesterServer/Test/runMain orchescala.dmntester.ExampleDmnTesterApp"
)

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
    dmnTester.jvm,
    dmnTester.js,
    dmn,
    dmnTesterServer,
    dmnTesterClient,
    simulation,
    worker,
    helper,
    engineC7,
    engineC8,
    engineOp,
    engineGateway,
    gateway,
    workerC7,
    workerC8,
    workerOp
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
    .dependsOn(helper, gateway)

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
      BuildInfoKey("zioLoggingVersion", zioLoggingVersion),
      BuildInfoKey("logbackVersion", logbackVersion),
      // plugins
      BuildInfoKey("sbtNativePackager", sbtNativePackager),
      BuildInfoKey("sbtCiRelease", sbtCiRelease),
      BuildInfoKey("laikaSbt", laikaSbt),
      BuildInfoKey("sbtBuildInfo", sbtBuildInfo)
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
    libraryDependencies ++= sttpDependencies ++ Seq(
      scaffeineDependency,
      zioDependency,
      zioSlf4jDependency
    )
  )
  .dependsOn(domain)

/** The DMN Tester's model - cross built, because the Scala.js client of the
  * tester uses the very same model (JSON is the only contract between them).
  */
lazy val dmnTester =
  crossProject(JSPlatform, JVMPlatform)
    .crossType(CrossType.Pure)
    .in(file("./02-dmntester"))
    .settings(publicationSettings)
    .settings(projectSettings("dmntester"))
    .settings(
      libraryDependencies ++= Seq(
        "io.circe" %%% "circe-core"    % circeVersion,
        "io.circe" %%% "circe-generic" % circeVersion,
        "io.circe" %%% "circe-parser"  % circeVersion
      )
    )
    .jsSettings(
      // the model uses java.time.LocalDateTime, which Scala.js does not have
      libraryDependencies +=
        "io.github.cquiroz" %%% "scala-java-time" % scalaJavaTimeVersion
    )

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

/** The DSL a project uses to describe its DMN test configurations. */
lazy val dmn = project
  .in(file("./03-dmn"))
  .settings(publicationSettings)
  .settings(projectSettings("dmn"))
  .settings(unitTestSettings)
  .settings(autoImportSetting)
  .dependsOn(domain, dmnTester.jvm)

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
    libraryDependencies ++= Seq(
      scaffeineDependency,
      logbackDependency
    ) ++ zioTestDependencies ++ zioHttpDependencies
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

lazy val bundleClient = taskKey[Seq[File]](
  "Links the DMN Tester UI (Scala.js) and bundles it with vite into 04-dmntester-client/dist/webapp"
)
lazy val checkClientBundle = taskKey[Unit]("Fails if the DMN Tester UI was not built")

/** The DMN Tester itself: the DMN engine, the http server and everything that
  * writes configurations or starts the tester.
  */
lazy val dmnTesterServer = project
  .in(file("./04-dmntester-server"))
  .settings(publicationSettings)
  .settings(projectSettings("dmntester-server"))
  .settings(unitTestSettings)
  .settings(
    autoImportSetting,
    libraryDependencies ++= sttpDependencies ++ dmnTesterDependencies,
    // the tester is a singleton per JVM (a project runs ONE) - suites that
    // start and stop it must not run at the same time
    Test / parallelExecution := false,
    // the tester's UI: vite bundles it into 04-dmntester-client/dist/webapp,
    // from where it lands in this jar as `webapp/...`. ONLY that directory -
    // the client's target/ (classes, tasty, linked js) must never end up here,
    // it would also break scaladoc.
    Compile / unmanagedResourceDirectories +=
      (LocalRootProject / baseDirectory).value / "04-dmntester-client" / "dist",
    // The UI is built BEFORE the resources are collected - so packaging,
    // publishing and `sbt dmnTester` always take a UI that matches the model.
    // `bundleClient` is cached: if nothing changed, this costs nothing.
    Compile / unmanagedResources := (Compile / unmanagedResources)
      .dependsOn(dmnTesterClient / bundleClient)
      .value,
    checkClientBundle := {
      // build it first - the check is only about the case where that was not
      // possible (no Node.js on this machine)
      val _      = (dmnTesterClient / bundleClient).value
      val bundle = (LocalRootProject / baseDirectory).value /
        "04-dmntester-client" / "dist" / "webapp" / "index.html"
      if (!bundle.exists())
        sys.error(
          s"""The DMN Tester UI is missing: $bundle
             |`bundleClient` builds it as part of this build - but that needs
             |Node.js. Install it, or build the UI yourself:
             |  npm --prefix 04-dmntester-client ci
             |  npm --prefix 04-dmntester-client run build""".stripMargin
        )
    },
    // never publish a tester without its UI
    Compile / packageBin := (Compile / packageBin).dependsOn(checkClientBundle).value
  )
  .dependsOn(domain, dmn, dmnTester.jvm)

/** The tester's UI - Scala.js + Laminar, bundled by vite into
  * `target/webapp`, which the server serves from its jar.
  */
lazy val dmnTesterClient = project
  .in(file("./04-dmntester-client"))
  .enablePlugins(ScalaJSPlugin)
  .settings(preventPublication)
  .settings(projectSettings("dmntester-client"))
  .settings(
    scalaJSUseMainModuleInitializer := true,
    scalaJSLinkerConfig ~= {
      _.withModuleKind(ModuleKind.ESModule)
        .withModuleSplitStyle(
          _root_.org.scalajs.linker.interface.ModuleSplitStyle
            .SmallModulesFor(List("orchescala.dmntester"))
        )
    },
    scalacOptions ++= Seq("-Xmax-inlines", "128"),
    // vite must know where the linked JS is. Asking sbt from vite.config.js
    // is fragile (it silently produced an empty path on CI), so the linker
    // writes to a fixed directory that vite simply points at.
    Compile / fastLinkJS / scalaJSLinkerOutputDirectory :=
      target.value / "scalajs" / "dev",
    Compile / fullLinkJS / scalaJSLinkerOutputDirectory :=
      target.value / "scalajs" / "prod",
    libraryDependencies ++= Seq(
      "org.scala-js" %%% "scalajs-dom" % scalaJsDomVersion,
      "com.raquo"    %%% "laminar"     % laminarVersion
    ),
    bundleClient := {
      val log       = streams.value.log
      val clientDir = baseDirectory.value
      // vite reads the linked Scala.js output - so link it first
      val _         = (Compile / fullLinkJS).value
      val linkedDir = (Compile / fullLinkJS / scalaJSLinkerOutputDirectory).value
      val bundleDir = clientDir / "dist" / "webapp"
      val inputs    = (linkedDir.allPaths.get() ++
        Seq("index.html", "main.js", "style.css", "package.json", "package-lock.json", "vite.config.js")
          .map(clientDir / _) ++
        (clientDir / "public").allPaths.get()).filter(_.isFile).toSet
      def bundled = bundleDir.allPaths.get().filter(_.isFile).toSet
      if (!DmnTesterUi.hasNpm) {
        DmnTesterUi.warnMissingNpm(clientDir, log)
        bundled.toSeq
      } else {
        // only run vite if an input changed or the bundle is gone
        val bundle = FileFunction.cached(
          streams.value.cacheDirectory / "bundleClient",
          FilesInfo.hash,
          FilesInfo.exists
        ) { _ =>
          DmnTesterUi.build(clientDir, log)
          bundled
        }
        bundle(inputs).toSeq
      }
    }
  )
  .dependsOn(dmnTester.js)

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
  .dependsOn(engineC7, engineC8, engineOp, worker)

// layer 06
lazy val gateway = project
  .in(file("./06-gateway"))
  .settings(publicationSettings)
  .settings(projectSettings("gateway"))
  .settings(
    autoImportSetting,
    unitTestSettings,
    libraryDependencies ++= zioTestDependencies ++ zioHttpDependencies ++ Seq(
      oauth2Dependency
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

lazy val engineOp = project
  .in(file("./04-engine-op"))
  .settings(publicationSettings)
  .settings(projectSettings("engine-op"))
  .settings(
    autoImportSetting,
    unitTestSettings,
    libraryDependencies ++= camunda7EngineDependencies ++ zioTestDependencies
  )
  .dependsOn(engineC7)

lazy val workerOp = project
  .in(file("./04-worker-op"))
  .settings(publicationSettings)
  .settings(projectSettings("worker-op"))
  .settings(unitTestSettings)
  .settings(
    autoImportSetting,
    libraryDependencies ++=
      opWorkerDependencies ++ zioTestDependencies
  )
  .dependsOn(worker, engineOp)
