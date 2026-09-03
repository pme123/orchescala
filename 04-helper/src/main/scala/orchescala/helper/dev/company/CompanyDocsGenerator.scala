package orchescala.helper.dev.company

import orchescala.helper.dev.update.createIfNotExists

import java.time.LocalDate

/** The company's `00-docs`: the hand-written markdown pages (rendered by the documentation
  * app - orch-doc, shipped in the orchescala jars - from `src/docs`), the release configuration
  * and the `site` folder the built site goes into (uploaded by publishDocs, served by the
  * company gateway).
  */
case class CompanyDocsGenerator(companyName: String, companyOrchescala: os.Path):
  private lazy val docsBase = companyOrchescala / s"00-docs"
  private lazy val docsSrc = docsBase / "src" / "docs"

  lazy val generate: Unit =
    println("Generate Company Docs")
    // generate docs
    os.makeDir.all(docsSrc / "dependencies")
    os.makeDir.all(docsSrc / "development")
    contact
    instructions
    onboarding
    pattern
    statistics
    config
    versions("VERSIONS")
    versions("VERSIONS_PREVIOUS")
    // site
    os.makeDir.all(docsBase / "site")
    removeLegacySiteGenerator()
  end generate

  /** Leftovers of the former static-site generator (Laika/Helium) - navigation files, theme
    * folder and styles the documentation app neither needs nor understands.
    */
  private def removeLegacySiteGenerator(): Unit =
    // NOT favicon.ico - that is the company's logo (see DocsJson), untouched
    val legacy = Seq(
      docsSrc / "helium",
      docsSrc / "style.css",
      docsBase / "site" / "style.css"
    ) ++ os.walk(docsSrc).filter(_.last == "directory.conf")
    legacy.filter(os.exists).foreach: p =>
      println(s"Removing legacy site generator file: $p")
      os.remove.all(p)
    // its `{% … %}` front matter in the markdown pages (navigation / versioning directives)
    val frontMatter = """(?s)\A\s*\{%.*?%\}\s*""".r
    os.walk(docsSrc).filter(_.ext == "md").foreach: md =>
      val content = os.read(md)
      if frontMatter.findPrefixOf(content).isDefined then
        println(s"Removing legacy front matter: $md")
        os.write.over(md, frontMatter.replaceFirstIn(content, ""))
  end removeLegacySiteGenerator

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
      s"""|# Onboarding
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
      s"""|# Process Pattern
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

end CompanyDocsGenerator
