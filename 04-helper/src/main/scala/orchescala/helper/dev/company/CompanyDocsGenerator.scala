package orchescala.helper.dev.company

import orchescala.helper.dev.update.createIfNotExists

import java.time.LocalDate

case class CompanyDocsGenerator(companyName: String, companyOrchescala: os.Path):
  private lazy val companyProjectName = companyOrchescala.last
  private lazy val docsBase = companyOrchescala / s"00-docs"
  private lazy val docsSrc = docsBase / "src" / "docs"

  lazy val generate: Unit =
    println("Generate Company Docs")
    // generate docs
    directory("dependencies", "Dependencies", isVersioned = true)
    directory("development", "Development", isVersioned = false)
    directory("helium", "Helium", isVersioned = false)
    contact
    instructions
    onboarding
    favicon()
    pattern
    statistics
    style
    config
    versions("VERSIONS")
    versions("VERSIONS_PREVIOUS")
    // site
    os.makeDir.all(docsBase / "site")
    favicon(docsBase / "site")
    siteIndexHtml
    siteCss
  end generate

  private lazy val contact =
    createIfNotExists(
      docsSrc / "contact.md",
      s"""|## Contact
          |If you have questions, spot a bug or you miss something, please let us know🤓.
          |
          |- _Business_
          |    - [Peter Blank](mailto:peter.blank@todo.ch)
          |- _Technical_
          |    - [Maya Blue](mailto:maya.blue@todo.ch)
          |""".stripMargin
    )
  private lazy val instructions =
    createIfNotExists(
      docsSrc / "development" / "instructions.md",
      s"""|## Create a Release
          |Describe here if your release process is different from the default.
          |
          |General instructions on [Company Documentation](https://pme123.github.io/orchescala/company/development.html#company-documentation)
          |
          |""".stripMargin
    )

  private lazy val onboarding =
    createIfNotExists(
      docsSrc / "development" / "onboarding.md",
      s"""|{%
          |// auto generated - do not change!
          |helium.site.pageNavigation.depth = 2
          |helium.site.pageNavigation.enabled = true
          |%}
          |# Onboarding
          |
          |The general Onboarding you find here:
          |
          |[Orchescala Onboarding](https://pme123.github.io/orchescala/development/onboarding.html)
          |
          |On this page you find stuff that is specific to $companyName and its environment.
          |""".stripMargin
    )

  private lazy val pattern =
    createIfNotExists(
      docsSrc / "pattern.md",
      s"""|{%
          |helium.site.pageNavigation.depth = 1
          |helium.site.pageNavigation.enabled = true
          |%}
          |# Process Pattern
          |We try to establish Patterns for doing the same tasks.
          |This documentation lists them and gives you some examples.
          |
          |TODO: Describe the Patterns here that you want to establish.
          |""".stripMargin
    )
  private lazy val statistics =
    createIfNotExists(
      docsSrc / "statistics.md",
      s"""|# Process Statistics
          |
          |The Process Statistics you find new in Camunda Optimize.
          |
          |TODO - Create here a link to the Optimize Dashboard or add some statistics manually.
          |
          |<iframe id="optimizeFrame" src="https://TODO/" frameborder="0" style="width: 1000px; height: 700px; allowtransparency; overflow: scroll"></iframe>
          |""".stripMargin
    )
  private lazy val style =
    createIfNotExists(
      docsSrc / "style.css",
      s"""|.mermaid svg {
          |    height: 400px;
          |}
          |.colorLegend {
          |    margin-left: auto;
          |    margin-right: 40px;
          |    width: 400px;
          |}
          |""".stripMargin
    )

  private def favicon(path: os.Path = docsSrc) =
    val faviconPath = path / "favicon.ico"
    if !os.exists(faviconPath) then
      os.write(faviconPath, (os.resource / "favicon.ico").toSource)

  private def directory(name: String, title: String, isVersioned: Boolean) =
    os.makeDir.all(docsSrc / name)
    createIfNotExists(
      docsSrc / name / "directory.conf",
      s"""|${laikaVersioned(isVersioned)}
          |
          |${laikaTitle(title)}
          |
          |$laikaNavigationOrder
          |
          |helium.site.pageNavigation.enabled = false
          |""".stripMargin
    )
  end directory

  private def laikaVersioned(isVersioned: Boolean) = s"laika.versioned = $isVersioned"
  private def laikaTitle(title: String) = s"laika.title = $title"
  private lazy val laikaNavigationOrder = s"laika.navigationOrder = [\n]"

  private lazy val config =
    createIfNotExists(
      docsBase / "CONFIG.conf",
      s"""|// year and month you want to release
          |release.tag = "${LocalDate.now().toString.take(7)}"
          |// a list with existing Releases on the web server
          |releases.older = []
          |// flag of this is for the release or just from the TST to see what is going on.
          |released = true
          |// this is the url of the release planing, e.g. Jira
          |jira.release.url = "https://yourReleasePage/versions/64209"
          |// who is responsible for the Release
          |release.responsible {
          |  name = "Peter Blank"
          |  date = "CHANGE to release date"
          |}
          |// what is the release about (abstract as markup)
          |release.notes = \"\"\"
          |- TODO: Describe the Release here
          |\"\"\"
          |""".stripMargin
    )
  private def versions(name: String) =
    createIfNotExists(
      docsBase / s"$name.conf",
      s"""|// START VERSIONS
          |
          |myProjectWorkerVersion = "1.0.0"
          |//..
          |
          |// END WOKRER
          |
          |myProjectVersion = "1.0.3"
          |//..
          |
          |// END VERSIONS
          |""".stripMargin)

  private lazy val siteIndexHtml =
    createIfNotExists(
      docsBase / "site" / "index.html",
      s"""|<!DOCTYPE html>
          |<!-- $helperCompanyHowToResetText -->
          |<html lang="en-CH">
          |
          |<head>
          |    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
          |    <meta charset="utf-8">
          |    <meta name="viewport" content="width=device-width, initial-scale=1.0">
          |    <meta name="generator" content="Typelevel Laika + Helium Theme"/>
          |    <title>$companyName Process Documentation</title>
          |    <meta name="description" content="$companyName-orchescala-docs"/>
          |    <link rel="icon" sizes="32x32" type="image/x-icon" href="./favicon.ico"/>
          |
          |    <link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Lato:400,700">
          |    <link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Fira+Mono:500">
          |    <link rel="stylesheet" type="text/css" href="./$companyName/helium/site/icofont.min.css"/>
          |    <link rel="stylesheet" type="text/css" href="./$companyName/helium/site/laika-helium.css"/>
          |
          |    <script> /* for avoiding page load transitions */ </script>
          |</head>
          |
          |<body>
          |
          |<div id="container">
          |
          |    <main class="content">
          |
          |        <h1 class="title">Process & Worker Catalogs</h1>
          |        <p><em>Find existing Processes and Worker in our Catalogs.</em></p>
          |
          |        <h2 class="section"><a href="./$companyName/index.html">$companyName</a></h2>
          |        <ul>
          |            <li><strong><a href="./$companyName/catalog.html" title="Catalog">Catalog</a></strong></li>
          |        </ul>
          |
          |    </main>
          |
          |</div>
          |
          |</body>
          |
          |</html>""".stripMargin
    )
  private lazy val siteCss =
    createIfNotExists(
      docsBase / "site" / "style.css",
      s"""# $helperCompanyHowToResetText
         |
         |.mermaid svg {
         |    height: 400px;
         |}
         |.colorLegend {
         |    margin-left: auto;
         |    margin-right: 40px;
         |    width: 400px;
         |}""".stripMargin
    )
end CompanyDocsGenerator
