import Dependencies.*
import laika.ast.Path.Root
import laika.config.*
import laika.format.Markdown.GitHubFlavor
import laika.helium.Helium
import laika.helium.config.{HeliumIcon, IconLink}
import laika.sbt.LaikaPlugin.autoImport.*
import mdoc.MdocPlugin.autoImport.*
import sbt.*
import sbt.Keys.*

import scala.util.Using

object Settings {

  lazy val projectVersion =
    Using(scala.io.Source.fromFile("version"))(_.mkString.trim).get
  val scalaV = "3.7.1"
  val org = "io.github.pme123"

  def projectSettings(projName: String) = Seq(
    name := s"orchescala-$projName",
    organization := org,
    scalaVersion := scalaV,
    version := projectVersion,
    scalacOptions ++= Seq(
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
  lazy val publicationSettings: Project => Project = _.settings(
    // publishMavenStyle := true,
    pomIncludeRepository := { _ => false },
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
  lazy val preventPublication: Project => Project =
    _.settings(
      publish := {},
      publishTo := Some(
        Resolver
          .file("Unused transient repository", target.value / "fakepublish")
      ),
      publishArtifact := false,
      publishLocal := {},
      packagedArtifacts := Map.empty
    ) // doesn't work - https://github.com/sbt/sbt-pgp/issues/42

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

  lazy val laikaSettings = Seq(
    laikaConfig := LaikaConfig.defaults
      .withConfigValue(LaikaKeys.excludeFromNavigation, Seq(Root))
      .withConfigValue("project.version", projectVersion)
      .withConfigValue(
        LinkConfig.empty
          .addTargets(
            TargetDefinition.external("bpmn specification", "https://www.bpmn.org"),
            TargetDefinition.external("camunda", "https://camunda.com")
          ).addSourceLinks(
            SourceLinks(
              baseUri =
                githubUrl + "/tree/master/05-examples/invoice/camunda7/src/main/scala/",
              suffix = "scala"
            )
          )
      )
      .withRawContent
    // .failOnMessages(MessageFilter.None)
    //  .renderMessages(MessageFilter.None)
    ,
    Laika / sourceDirectories := Seq(mdocOut.value),

    laikaSite / target := baseDirectory.value / ".." / "docs",
    laikaExtensions := Seq(GitHubFlavor, SyntaxHighlighting),
    laikaTheme := Helium.defaults.site
      .topNavigationBar(
        homeLink = IconLink.internal(Root / "index.md", HeliumIcon.home),
        navLinks = Seq(
          IconLink.external(githubUrl, HeliumIcon.github),
        )
      )
      .build,
  )
  lazy val mdocSettings = Seq(
    mdocIn                    := baseDirectory.value / "src" / "docs",
    mdocVariables             := Map(
      "VERSION"-> projectVersion
    ),
    mdocExtraArguments        := Seq("--no-link-hygiene"),
  )
}
