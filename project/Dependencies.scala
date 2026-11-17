import sbt.*
import sbt.Keys.*

object Dependencies {

  // dependency Versions
  // 00-docs
  // - mdoc Plugin (compiles the scala snippets of the markdown pages)
  // 04-helper
  val osLibVersion          = "0.11.10"
  // 01-domain
  val openapiCirceVersion   = "0.12.1"
  val tapirVersion          = "1.14.1"
  val ironCirceVersion      = "3.4.1"
  val mUnitVersion          = "1.3.6"
  val scala3MockVersion     = "0.6.6"
  // 02-bpmn
  // -> domain
  // - osLib
  // 03-api
  // -> bpmn
  val typesafeConfigVersion = "1.4.10"
  val scalaXmlVersion       = "2.5.0"
  // - mUnitVersion
  // 03-dmn
  // -> bpmn
  val sttpClient3Version    = "3.11.0"
  // 03-dmn-tester-shared / 04-dmn-tester-server / 04-dmn-tester-client
  val circeVersion          = "0.14.17"
  // dmn-scala: the DMN engine embedded in Camunda 8 (Scala 2.13 jar, usable from Scala 3)
  val dmnScalaVersion       = "1.12.6"
  val http4sVersion         = "0.23.38"
  val laminarVersion        = "17.2.1"
  // java.time for Scala.js - the model uses LocalDateTime
  val scalaJavaTimeVersion  = "2.11.0"
  val scalaJsDomVersion     = "2.8.1"
  // - mUnitVersion
  // 03-simulation
  // -> bpmn
  val testInterfaceVersion  = "1.0"
  // - sttpClient3
  // 03-worker
  // -> bpmn
  // -mUnitVersion
  val chimneyVersion        = "2.1.1"
  val coursierVersion       = "1.0.30"
  // --- Implementations
  // 04-helper
  val sardineWebDavVersion  = "5.13"
  val scalametaVersion      = "4.17.4" // the tests parse the generated sbt code
  // 04-worker-c7spring
  // -> worker
  val camundaVersion        = "7.24.0" // external task client
  val jaxbApiVersion        = "4.0.5"  // needed by the camunda client 7.21?!
  val scaffeineV            = "5.3.0"  // caching
  val zioVersion            = "2.1.27" // zio
  val zioHttpVersion        = "3.11.6" // zio http
  val zioLoggingVersion     = "2.5.4" // logging
  val logbackVersion        = "1.6.7" // logging
  // - sttpClient3

  // 04-engine-c8
  val camunda8Version       = "8.10.9"
  // 04-helper: reads the OpenAPI specs
  val swaggerOpenAPIVersion = "2.1.48"
  // 06-gateway
  val oauth2Version = "4.6.2"
  val jgitVersion   = "7.8.1.202611041320-r"

  // 04-persistence-postgres
  val hikariVersion         = "6.3.3"
  val postgresqlVersion     = "42.7.14"
  val testcontainersVersion = "1.21.4"

  // the sbt version of the generated company and project builds - separate from orchescala's
  // own (project/build.properties), so orchescala can move to a new sbt without the companies
  val generatedSbtVersion = "1.13.1"

  // sbt plugins - their versions are only in project/plugins.sbt, read from there
  // (BuildInfo passes them on to the generated company builds).
  // Relative to the working directory, like the `version` file in Settings.scala: sbt runs in the
  // root of the build (also for IDE / BSP imports). Commented-out lines do not count.
  private lazy val pluginsSbt =
    IO.readLines(file("project/plugins.sbt"))
      .filterNot(_.trim.startsWith("//"))
      .mkString("\n")
  private def pluginVersion(name: String): String =
    ("\"" + java.util.regex.Pattern.quote(name) + "\"\\s*%\\s*\"([^\"]+)\"").r
      .findFirstMatchIn(pluginsSbt)
      .map(_.group(1))
      .getOrElse(sys.error(s"sbt plugin $name not found in project/plugins.sbt"))
  lazy val sbtNativePackager = pluginVersion("sbt-native-packager")
  lazy val sbtCiRelease      = pluginVersion("sbt-ci-release")
  lazy val sbtBuildInfo      = pluginVersion("sbt-buildinfo")

  lazy val jaxbApiDependency   = "jakarta.xml.bind" % "jakarta.xml.bind-api" % jaxbApiVersion
  lazy val coursierDependency = "io.get-coursier" % "interface" % coursierVersion
  // the 3-way merge of the helper's merge from Orch Spec (MergeAlgorithm, MergeFormatter)
  lazy val jgitDependency     = "org.eclipse.jgit" % "org.eclipse.jgit" % jgitVersion
  lazy val scalametaTestDependency = "org.scalameta" %% "scalameta" % scalametaVersion % Test
  lazy val scaffeineDependency = // token caching
    "com.github.blemale" %% "scaffeine" % scaffeineV // caching

  lazy val tapirDependencies = Seq(
    "com.softwaremill.sttp.tapir"   %% "tapir-openapi-docs" % tapirVersion,
    "com.softwaremill.sttp.tapir"   %% "tapir-json-circe"   % tapirVersion,
    "com.softwaremill.sttp.apispec" %% "openapi-circe-yaml" % openapiCirceVersion,
    // "io.circe" %% "circe-generic" % circeVersion,
    "io.github.iltotore"            %% "iron-circe"         % ironCirceVersion,
    "com.softwaremill.sttp.tapir"   %% "tapir-iron"         % tapirVersion
  )

  lazy val zioHttpDependencies = Seq(
    "dev.zio"                       %% "zio-http"              % zioHttpVersion,
    "com.softwaremill.sttp.tapir"   %% "tapir-zio-http-server" % tapirVersion
  )

  lazy val camunda7ZioWorkerDependencies = Seq(
    "org.camunda.bpm" % "camunda-external-task-client" % camundaVersion
  )

  val opVersion = "1.1.0"
  lazy val opWorkerDependencies = Seq(
    "org.operaton.bpm" % "operaton-external-task-client" % opVersion,
    // the client's XML data format needs JAXB when it is built - without it every Operaton
    // worker app failed to start (NoClassDefFoundError: jakarta/xml/bind/JAXBException)
    jaxbApiDependency
  )
  lazy val camunda7EngineDependencies    =
    Seq("org.camunda.community" % "camunda-engine-rest-client-openapi-java" % camundaVersion)

  /** 03-dmn: the DMN Tester - engine, http server and config handling. */
  lazy val dmnTesterDependencies = Seq(
    // The DMN engine embedded in Camunda 8 - a Scala 2.13 jar, usable from
    // Scala 3. Its FEEL parser (fastparse_2.13) drags in geny_2.13, while
    // os-lib brings geny_3 - the same library, two cross versions. Excluding
    // the 2.13 one leaves a single geny on the classpath; the exclusion is
    // part of the published pom, so no company or project build has to deal
    // with a cross-version clash. Covered by the engine tests, which parse
    // FEEL (fastparse) and read DMNs via os-lib (geny) in one JVM.
    ("org.camunda.bpm.extension.dmn.scala" % "dmn-engine" % dmnScalaVersion)
      .excludeAll(ExclusionRule("com.lihaoyi", "geny_2.13")), // the Scala 2.13 artifact - not cross-versioned
    "org.http4s"                         %% "http4s-dsl"          % http4sVersion,
    "org.http4s"                         %% "http4s-ember-server" % http4sVersion,
    "org.http4s"                         %% "http4s-circe"        % http4sVersion,
    "com.typesafe"                        % "config"              % typesafeConfigVersion,
    zioDependency,
    osLib
  )

  lazy val sttpDependencies              = Seq(
    "com.softwaremill.sttp.client3" %% "circe"                            % sttpClient3Version,
    "com.softwaremill.sttp.client3" %% "async-http-client-backend-zio"    % sttpClient3Version,
    "com.softwaremill.sttp.client3" %% "async-http-client-backend-future" % sttpClient3Version
  )

  val camunda8JavaClientDependency =
    "io.camunda" % "camunda-client-java" % camunda8Version

  val zioDependency =
    "dev.zio" %% "zio" % zioVersion
  // PersistenceWorker on Postgres (04-persistence-postgres): JDBC pool and driver; Testcontainers
  val persistencePostgresDependencies = Seq(
    "com.zaxxer"          % "HikariCP"                 % hikariVersion,
    "org.postgresql"      % "postgresql"               % postgresqlVersion,
    "org.testcontainers"  % "postgresql"               % testcontainersVersion % Test
  )

  val zioTestDependencies =
    Seq(
      "dev.zio" %% "zio-test"     % zioVersion % Test,
      "dev.zio" %% "zio-test-sbt" % zioVersion % Test
    )

  val zioSlf4jDependency = "dev.zio"       %% "zio-logging-slf4j" % zioLoggingVersion
  val logbackDependency  = "ch.qos.logback" % "logback-classic"   % logbackVersion % Runtime
  val oauth2Dependency   = "com.auth0" % "java-jwt" % oauth2Version

  lazy val osLib          = "com.lihaoyi"         %% "os-lib"         % osLibVersion
  lazy val chimney        = "io.scalaland"        %% "chimney"        % chimneyVersion
  lazy val swaggerOpenAPI = "io.swagger.parser.v3" % "swagger-parser" % swaggerOpenAPIVersion
  lazy val sardineWebDav  = "com.github.lookfirst" % "sardine"        % sardineWebDavVersion

  lazy val camunda8EngineDependencies = Seq(
    camunda8JavaClientDependency
  )

}
