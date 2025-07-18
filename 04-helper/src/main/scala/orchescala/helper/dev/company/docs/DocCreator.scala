package orchescala.helper.dev.company.docs

import orchescala.api.{ApiProjectConfig, DocProjectConfig, ProjectConfig, catalogFileName}
import orchescala.helper.dev.publish.DocsWebDAV
import orchescala.helper.util.{Helpers, PublishConfig}
import os.Path

import java.time.LocalDate
import java.time.format.DateTimeFormatter

/** the idea is use Orchescala to create Company's Process documentation.
  *
  * For a Start you can create a Catalog.
  */
trait DocCreator extends DependencyCreator, Helpers:

  protected def publishConfig: Option[PublishConfig]
  protected def gitBasePath: os.Path                                           = apiConfig.tempGitDir
  protected def configs: Seq[DocProjectConfig]                                 = setupConfigs()
  protected def apiProjectConfig(projectConfigPath: os.Path): ApiProjectConfig =
    ApiProjectConfig(projectConfigPath)

  lazy val projectConfigs: Seq[ProjectConfig] =
    apiConfig.projectsConfig.projectConfigs ++ apiConfig.otherProjectsConfig.projectConfigs

  def prepareDocs(): Unit =
    println(s"API Config: $apiConfig")
    apiConfig.projectsConfig.init
    apiConfig.otherProjectsConfig.init
    createCatalog()
    DevStatisticsCreator(gitBasePath, apiConfig.basePath).create()
    createDynamicConf()
    // println(s"Preparing Docs Started")
    createReleasePage()
  end prepareDocs

  // noinspection ScalaUnusedExpression
  def publishDocs(): Unit =
    createDynamicConf()
    println(s"Releasing Docs started")
    os.proc(
      "sbt",
      "-J-Xmx3G",
      "clean",
      "laikaSite" // generate HTML pages from Markup
    ).callOnConsole()
    publishConfig
      .map: config =>
        DocsWebDAV(apiConfig, config).upload(releaseConfig.releaseTag)
      .getOrElse(println("No Publish Config found"))
  end publishDocs

  protected def createCatalog(): Unit =

    val catalogs    = s"""{%
                      |// auto generated - do not change!
                      |helium.site.pageNavigation.depth = 1
                      |%}
                      |## Catalog
                      |${projectConfigs
                       .map { case pc @ ProjectConfig(projectName, _, _) =>
                         val path = pc.absGitPath(gitBasePath) / catalogFileName
                         if os.exists(path) then
                           os.read(path)
                         else
                           s"""### $projectName
                              |Sorry there is no $path.
                              |""".stripMargin
                         end if
                       }
                       .mkString("\n")}""".stripMargin
    val catalogPath = apiConfig.basePath / "src" / "docs" / catalogFileName
    println(s"Catalog Path: $catalogPath")
    if os.exists(catalogPath) then
      os.write.over(catalogPath, catalogs)
    else
      os.write(catalogPath, catalogs, createFolders = true)
  end createCatalog

  protected def createDynamicConf(): Unit =
    val table =
      s"""// auto generated - do not change!
         |laika.versioned = false
         |release.tag = "${releaseConfig.releaseTag}"
         |created.day = "${LocalDate
          .now()
          .format(DateTimeFormatter.ofPattern("dd.MM.yyyy"))}"
         |laika.navigationOrder = [
         |  index.md
         |  release.md
         |  overviewDependencies.md
         |  pattern.md
         |  statistics.md
         |  devStatistics.md
         |  catalog.md
         |  contact.md
         |  instructions.md
         |  dependencies
         |]
         """.stripMargin
    os.write.over(apiConfig.basePath / "src" / "docs" / "directory.conf", table)
  end createDynamicConf

  private def createReleasePage(): Unit =
    given configs: Seq[DocProjectConfig] = setupConfigs()
    given ReleaseConfig                  = releaseConfig
    DependencyValidator().validateDependencies
    val indexGraph                       = DependencyGraphCreator().createIndex
    DependencyLinkCreator().createIndex(indexGraph)
    val dependencyGraph                  = DependencyGraphCreator().createDependencies
    DependencyLinkCreator().createDependencies(dependencyGraph)
    DependencyGraphCreator().createProjectDependencies
    val releaseNotes                     = setupReleaseNotes
    DependencyValidator().validateOrphans
    val tableFooter                      =
      "(\\*) New in this Release / (\\*\\*) Patched in this Release - check below for the details"
    val table                            =
      s"""
         |{%
         |// auto generated - do not change!
         |laika.versioned = true
         |%}
         |
         |# Release ${releaseConfig.releaseTag}
         | ${releaseConfig.releasedLabel}
         |
         |${releaseConfig.jiraReleaseUrl.map(u => s"[JIRA Release Planing]($u)").getOrElse("")}
         |
         |## Camunda Dependencies
         |
         |${dependencyTable(configs, isWorker = false)}
         |
         |$tableFooter
         |
         |## Worker Dependencies
         |
         |${dependencyTable(configs, isWorker = true)}
         |
         |$tableFooter
         |
         |$releaseNotes
         """.stripMargin

    val releasePath = apiConfig.basePath / "src" / "docs" / "release.md"
    os.write.over(releasePath, table)
  end createReleasePage

  private def setupConfigs(): Seq[DocProjectConfig] =
    val configsLines         = os.read.lines(apiConfig.basePath / "VERSIONS.conf")
    val previousConfigsLines = os.read.lines(apiConfig.basePath / "VERSIONS_PREVIOUS.conf")
    val versions             = extractVersions(configsLines)
    val previousVersions     = extractVersions(previousConfigsLines)

    // Use ZIO to run fetchConf in parallel
    import zio._

    val configs = Unsafe.unsafe { implicit unsafe =>
      Runtime.default.unsafe.run(
        ZIO.foreachPar(versions.toSeq) { case (projectName, version) =>
          ZIO.attempt {
            val previousVersion =
              previousVersions.get(projectName).map(_._1).getOrElse(DocProjectConfig.defaultVersion)
            fetchConf(
              projectName.replace("-worker", ""),
              version,
              previousVersion,
              projectName.endsWith("worker")
            )
          }
        }
      ).getOrThrow()
    }

    // Flatten the results and filter out None values
    configs.flatten
  end setupConfigs

  private def extractVersions(
      versions: Seq[String]
  ): Map[String, String] =
    versions
      .filter(l => l.contains("Version") && !l.contains("\"\""))
      .map: l =>
        val projectName = l.trim
          .split("(?<!(^|[A-Z]))(?=[A-Z])|(?<!^)(?=[A-Z][a-z])")
          .map(_.toLowerCase)
          .takeWhile(!_.startsWith("version"))
          .mkString("-")
        val regex       = """"(\d+\.\d+\.\d+)"""".r
        val version     = regex.findFirstMatchIn(l.trim).get.group(1)
        projectName -> version
      .toMap

  private def fetchConf(
      project: String,
      version: String,
      versionPrevious: String,
      isWorker: Boolean
  ) =
    for
      projConfig <- apiConfig.projectsConfig.projectConfig(project)
      projectPath = projConfig.absGitPath(gitBasePath)
      _           = println(s"Project Git Path $projectPath / $gitBasePath")
      _           = if !os.exists(projectPath) then
                      apiConfig.projectsConfig.initProject(project, gitBasePath)
      _           = os.proc("git", "fetch", "--tags").callOnConsole(projectPath)
      _           = os
                      .proc("git", "checkout", s"tags/v$version")
                      .callOnConsole(projectPath)
    yield DocProjectConfig(
      apiProjectConfig(projectPath / apiConfig.projectsConfig.projectConfPath),
      os.read.lines(projectPath / "CHANGELOG.md"),
      versionPrevious,
      isWorker
    )

  private def dependencyTable(configs: Seq[DocProjectConfig], isWorker: Boolean) =
    val selectedConfigs = configs
      .filter(_.isWorker == isWorker)
    val filteredConfigs =
      selectedConfigs
        .filter(c =>
          configs.exists(c2 =>
            c.projectName != c2.projectName && c2.dependencies.exists(d =>
              d.projectName == c.projectName
            )
          ) // && c.version.matches(d.version)) )
        )
        .sortBy(_.projectName)

    "| **Package** | **Version** | Previous Version " +
      filteredConfigs
        .map(c => s"**${c.projectName}** ${c.projectVersion}")
        .mkString("| ", " | ", " |") +
      "\n||----| :----:  | :----:  " + filteredConfigs
        .map(_ => s":----:")
        .mkString("| ", " | ", " |\n") +
      selectedConfigs
        .sortBy(_.projectName)
        .map { c =>
          val (name, version, versionPrevious) =
            c match
              case _ if c.isNew     =>
                (s"[${c.projectName}]*", s"**${c.projectVersion}**", s"${c.versionPrevious}")
              case _ if c.isPatched =>
                (s"[${c.projectName}]**", s"_${c.projectVersion}_", s"${c.versionPrevious}")
              case _                =>
                (s"${c.projectName}", s"${c.projectVersion}", s"${c.versionPrevious}")

          s"|| **$name** | $version | $versionPrevious " +
            filteredConfigs
              .map(c2 =>
                c.dependencies
                  .find: c3 =>
                    val version2 = c2.projectVersion.minorVersion + "."
                    c3.projectName == c2.projectName && c3.projectVersion.toString.startsWith(
                      version2
                    )
                  .map(_ => c2.projectVersion)
                  .getOrElse("")
              )
              .mkString("| ", " | ", " |")
        }
        .mkString("\n")
  end dependencyTable

  private def setupReleaseNotes(using configs: Seq[DocProjectConfig]): String =
    val mergeConfigs = configs
      .foldLeft(Seq.empty[DocProjectConfig]):
        case (result, c) =>
          result
            .find(_.projectName == c.projectName)
            .map: mc =>
              val previousVersion = // get the highest previous version
                if mc.versionPreviousConf.isHigherThan(c.versionPreviousConf)
                then
                  mc.versionPreviousConf.toString
                else
                  c.versionPreviousConf.toString

              val config = // get the highest version
                if mc.projectVersion.isHigherThan(c.projectVersion)
                then
                  mc
                else c
              result.filterNot(_.projectName == c.projectName) :+
                config.copy(versionPrevious = previousVersion)
            .getOrElse(result :+ c)
      .filter(c => c.isNew || c.isPatched) // take only the new or patched ones

    val projectChangelogs = mergeConfigs
      .sortBy(_.projectName)
      .map(c => s"""
                   |## [${c.projectName}](s"${apiConfig.docBaseUrl}/${c.projectName}/OpenApi.html")
                   |${extractChangelog(c)}
                   |""".stripMargin)
      .mkString("\n")
    s"""
       |# Release Notes
       |# DRAFT!!!
       |
       |_Automatically gathered from the project's Change Logs and manually adjusted.
       |Please check the project _CHANGELOG_ for more details._
       |
       |${releaseConfig.releaseNotes}
       |
       |${projectChangelogs}
       |
       |""".stripMargin
  end setupReleaseNotes

  private def extractChangelog(conf: DocProjectConfig) =
    val versionRegex = "## \\d+\\.\\d+\\.\\d+.+"
    val groups       = ChangeLogGroup.values

    val changeLogEntries = conf.changelog
      // start with the release version
      .dropWhile(!_.trim.startsWith(s"## ${conf.projectVersion}"))
      // take only to the ones that belong to this version
      .takeWhile(!_.trim.startsWith(s"## ${conf.versionPrevious}"))
      // remove all version titles
      .filterNot(_.matches(versionRegex))
      // remove empty lines
      .filter(_.trim.nonEmpty)
      // group
      .foldLeft((Seq.empty[ChangeLogEntry], ChangeLogGroup.Changed)) {
        case ((entries, activeGroup), line) =>
          line match
            case l if l.startsWith("### ") => // group
              val group = groups.map(_.toString).toSeq.findLast(_ == l.drop(4).trim)
                .map(ChangeLogGroup.valueOf).getOrElse(ChangeLogGroup.Other)
              (entries, group)
            case l                         =>
              val regex    = """(.*)(MAP-\d+)(:? )(.*)""".r
              val newEntry = regex.findFirstMatchIn(l) match
                case Some(v) =>
                  val jiraTicket = v.group(2)
                  ChangeLogEntry(
                    activeGroup,
                    s"- ${v.group(4)}",
                    Some(jiraTicket)
                  )
                case None    => ChangeLogEntry(activeGroup, l)
              (entries :+ newEntry, activeGroup)
      }
      ._1

    val preparedGroups = groups
      // take only the groups that have entries
      .filter(g => changeLogEntries.exists(_.group == g))
      .foldLeft(Map.empty[ChangeLogGroup, Map[String, Seq[String]]]) {
        case (result, group) =>
          // get the new entries for a group - group it by ticket
          val newEntries =
            changeLogEntries.filter(_.group == group).groupBy(_.ticket).map {
              case k -> v => k.getOrElse("Other") -> v.map(_.text)
            }
          if groups.take(3).contains(group) then // for Added, Changed, Fixed -> merge tickets
            val existingResult = newEntries.foldLeft(result) {
              case (result, (ticket, texts)) =>
                (result.view.mapValues { rTickets =>
                  rTickets.map {
                    case rT -> rTexts if rT == ticket =>
                      rT -> (rTexts ++ texts)
                    case rT -> rTexts                 =>
                      rT -> rTexts
                  }
                }.toMap)

            }
            // only take new entries that were not merged
            val filteredNew    = newEntries.filter { case t -> _ =>
              !existingResult.values.flatten.exists(_._1 == t)
            }

            existingResult + (group -> filteredNew)
          else
            result + (group -> newEntries)
          end if
      }
      .filter(g => g._2.nonEmpty) // remove if there are no new entries

    preparedGroups
      .map { case k -> v =>
        s"""### $k
           |${v.toSeq
            .sortBy(_._1)
            .map { case ticket -> entries =>
              s"""
                 |**${replaceJira(ticket)}**
                 |
                 |${entries.mkString("\n")}
                 |""".stripMargin
            }
            .mkString("\n")}
           |""".stripMargin
      }
      .mkString("\n")
  end extractChangelog

  private def replaceJira(
      jiraTicket: String
  ): String =
    if jiraTicket == "Other" then
      jiraTicket
    else
      s"[$jiraTicket](https://issue.swisscom.ch/browse/$jiraTicket)"

  private enum ChangeLogGroup:
    case Added, Changed, Fixed, Deprecated, Removed, Security, Other

  private case class ChangeLogEntry(
      group: ChangeLogGroup = ChangeLogGroup.Changed,
      text: String,
      ticket: Option[String] = None
  )

end DocCreator
