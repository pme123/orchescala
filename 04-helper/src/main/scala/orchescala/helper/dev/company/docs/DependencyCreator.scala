package orchescala.helper.dev.company.docs

import orchescala.api.{ApiConfig, DocProjectConfig}

trait DependencyCreator:

  protected def apiConfig: ApiConfig
  protected def configs: Seq[DocProjectConfig]
  protected def releaseConfig: ReleaseConfig = readReleaseConfig
  given ApiConfig = apiConfig
  
  case class Package(name: String, minorVersion: String):
    lazy val show = s"$name:$minorVersion"
    lazy val showRect = s"$name:$minorVersion($name:$minorVersion)"
    lazy val versionNumber: Int = minorVersion.replace(".", "").toInt
  end Package

  object Package:
    def apply(conf: DocProjectConfig): Package =
      Package(conf.projectName, conf.minorVersion)

  lazy val colors: Seq[(String, String)] = apiConfig.projectsConfig.colors
  lazy val colorMap: Map[String, String] = colors.toMap

  protected def printGraph(dependencyGraph: String): String =
    s"""
       |<div>
       |      <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
       |
       |      <script>
       |        mermaid.initialize(
       |        {startOnLoad: true}
       |        );
       |      </script>
       |<div class="mermaid">
       |%%{init: {"flowchart": {"htmlLabels": true, "curve": "cardinal", "useMaxWidth": true, "rankSpacing": 70}}
       |}%%
       |
       |$dependencyGraph
       |
       |      </div>
       |</div>
       |""".stripMargin

  protected lazy val printColorLegend: String =
    if colors.nonEmpty then
      s"""
         |<div class="colorLegend">
         |  <p>Color Legend:</p>
         |  <ul>
         |${
          colors
            .filterNot(c => c._2 == "white")
            .map(c =>
              s"""<li style="background: ${c._2};">${c._1}: ${c._2}</li>""".stripMargin
            ).mkString("\n")
        }
         |  </ul>
         |</div>
         |""".stripMargin
    else
      ""
  end printColorLegend

  protected def readReleaseConfig: ReleaseConfig =
    ReleaseConfig.releaseConfig(apiConfig.basePath)

end DependencyCreator
