package orchescala.helper.dev.company.docs

import orchescala.api.{ApiConfig, DocProjectConfig, ProjectGroup}

case class DependencyLinkCreator()(using
    val apiConfig: ApiConfig,
    val configs: Seq[DocProjectConfig]
) extends DependencyCreator:

  def createIndex(dependencyGraph: String): Unit =
    val indexPage = create("Valiant Process Documentation", dependencyGraph)
    os.write.over(apiConfig.basePath / "src" / "docs" / "index.md", indexPage)

  def createDependencies(dependencyGraph: String): Unit =
    val depPage = create("Dependencies Overview", dependencyGraph)
    os.write.over(
      apiConfig.basePath / "src" / "docs" / "overviewDependencies.md",
      depPage
    )
  end createDependencies

  private def create(title: String, dependencyGraph: String): String =
    val packages: Seq[Package] = configs
      .groupBy(_.projectName)
      .map { case _ -> v =>
        Package(v.maxBy(_.version))
      }
      .toSeq

    def linkGroup(projectGroup: ProjectGroup) =
      s"""
         |## ${projectGroup.name}
         |${packages
          .filter(p => apiConfig.projectsConfig.hasProjectGroup(p.name, projectGroup))
          .map { co =>
            s"""- **${co.name}:** [API Doc](../${co.name}/OpenApi.html "${co.name} API Documentation") - [Dependencies](./${releaseConfig.releaseTag}/dependencies/${co.name}.html "${co.name} Dependencies")"""
          }
          .mkString("\n")}
         |""".stripMargin

    s"""
       |{%
       |laika.versioned = true
       |%}
       |
       |# $title
       |${releaseConfig.releasedLabel}
       |
       |## BPMN Projects
       |${printGraph(dependencyGraph)}
       |
       |$printColorLegend
       |
       |${apiConfig.projectGroups.map { group =>
        linkGroup(group)
      }.mkString("\n")}
       |""".stripMargin
  end create
end DependencyLinkCreator
