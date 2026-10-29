import Dependencies.*
import mdoc.MdocPlugin.autoImport.*
import sbt.*
import sbt.Keys.*

import scala.util.Using

object Settings {

  lazy val projectVersion =
    Using(scala.io.Source.fromFile("version"))(_.mkString.trim).get
  val scalaV = "3.8.3"
  val org = "io.github.pme123"

  def projectSettings(projName: String) = Seq(
    name := s"orchescala-$projName",
    organization := org,
    scalaVersion := scalaV,
    version := projectVersion,
    scalacOptions ++= Seq(
      "-deprecation", // Emit warning and location for usages of deprecated APIs.
      "-feature", // Emit warning and location for usages of features that should be imported explicitly.
      //   "-Xmax-inlines:50", // is declared as erased, but is in fact used
      //   "-Wunused:imports",
    ),
    javacOptions ++= Seq("-source", "17", "-target", "17")
  )

  lazy val unitTestSettings = Seq(
    libraryDependencies ++= Seq(
      "org.scalameta" %% "munit" % mUnitVersion % Test,
    ),
    testFrameworks += new TestFramework("munit.Framework"),
    Test / testOptions += Tests.Argument(TestFrameworks.MUnit, "+l", "--verbose")
  )

  lazy val zioTestSettings = Seq(
    libraryDependencies ++= zioTestDependencies,
    Test / parallelExecution := true,
    testFrameworks += new TestFramework("zio.test.sbt.ZTestFramework")
  )
  
  lazy val githubUrl = "https://github.com/pme123/orchescala"
  lazy val publicationSettings = Seq(
    organization := "io.github.pme123",
    licenses += ("MIT", url("http://opensource.org/licenses/MIT")),
    homepage := Some(url(githubUrl)),
    startYear := Some(2021),
    // logLevel := Level.Debug,
    scmInfo := Some(
      ScmInfo(
        url(githubUrl),
        "scm:git:github.com:/pme123/orchescala"
      )
    ),
    developers := developerList
  )
  lazy val developerList = List(
    Developer(
      id = "pme123",
      name = "Pascal Mengelt",
      email = "pascal.mengelt@gmail.com",
      url = url("https://github.com/pme123")
    )
  )
  lazy val preventPublication = Seq(
    publish / skip := true,
    publish := {},
    publishArtifact := false,
    publishLocal := {}
  )

  lazy val autoImportSetting =
    scalacOptions +=
      Seq(
        "java.lang",
        "scala",
        "scala.Predef",
        "io.circe",
        "io.circe.generic.semiauto",
        "io.circe.derivation",
        "io.circe.syntax",
        "sttp.tapir",
        "sttp.tapir.json.circe"
      ).mkString(start = "-Yimports:", sep = ",", end = "")

  lazy val mdocSettings = Seq(
    mdocIn                    := baseDirectory.value / "src" / "docs",
    mdocVariables             := Map(
      "VERSION"-> projectVersion
    ),
    mdocExtraArguments        := Seq("--no-link-hygiene"),
  )
}
