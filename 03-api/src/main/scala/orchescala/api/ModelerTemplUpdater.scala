package orchescala.api

import orchescala.domain.diagramPath
import io.circe.parser
import io.circe.syntax.*

import java.io.StringReader
import scala.language.postfixOps
import scala.xml.*
import scala.xml.transform.{RewriteRule, RuleTransformer}

case class ModelerTemplUpdater(apiConfig: ApiConfig, apiProjectConfig: ApiProjectConfig):
  
  def update(): Unit =
    updateTemplates()
    updateBpmnColors()

  private def updateTemplates(): Unit =
    docProjectConfig.dependencies
      .foreach: c =>
        val toPath = templConfig.templatePath / "dependencies"
        os.makeDir.all(toPath)
        val fromPath = apiConfig.tempGitDir / c.projectName / templConfig.templateRelativePath
        println(s"Fetch dependencies: ${c.projectName} > $fromPath")
        if os.exists(fromPath) then
          os.walk(fromPath)
            .filter: p =>
              p.last.startsWith(c.projectName)
            .foreach: p =>
              parser.parse(os.read(p))
                .flatMap:
                  _.as[MTemplate]
                .map:
                  case t
                      if t.elementType.value == AppliesTo.`bpmn:CallActivity` &&
                        t.name != docProjectConfig.projectName =>
                    val newTempl =
                      t.asJson
                        .deepDropNullValues
                        .toString
                    os.write.over(toPath / p.last, newTempl)

                  case t =>
                    println(s" - Just copy Template: ${t.id}")
                    os.copy(p, toPath / p.last, replaceExisting = true)
        else
          println(s"No Modeler Templates for $fromPath")
        end if
  end updateTemplates

  private def updateBpmnColors(): Unit =
    if os.exists(os.pwd / diagramPath) then
      println("Adjust Color for:")
      projectsConfig.projectConfig(docProjectConfig.projectName)
        .map: pc =>
          os.walk(os.pwd / diagramPath)
            .filter:
              _.toString.endsWith(".bpmn")
            .map: p =>
              p -> os.read(p)
            .map:
              extractUsesRefs
    else println("No BPMN Diagrams found")
  end updateBpmnColors
  
  private lazy val templConfig = apiConfig.modelerTemplateConfig
  private lazy val projectsConfig = apiConfig.projectsConfig
  private lazy val docProjectConfig: DocProjectConfig = DocProjectConfig(apiProjectConfig)
  private lazy val colorMap = apiConfig.projectsConfig.colors.toMap

  private def extractUsesRefs(bpmnPath: os.Path, xmlStr: String) =
    println(s" - ${bpmnPath.last}")
    val xml: Node = XML.load(new StringReader(xmlStr))
    val callActivities = (xml \\ "callActivity")
      .map: ca =>
        val calledElement = ca \@ "calledElement"
        val id = ca \@ "id"
        println(s"CHANGED  -> $calledElement > $id --")
        calledElement -> id

    val externalWorkers = (xml \\ "serviceTask")
      .map: br =>
        val workerRef = br
          .attribute("http://camunda.org/schema/1.0/bpmn", "topic")
          .get
        val id = br \@ "id"
        println(s"CHANGED workerRef -> $workerRef > $id --")
        workerRef.toString -> id

    val businessRuleTasks = (xml \\ "businessRuleTask")
      .map: br =>
        val decisionRef = br
          .attribute("http://camunda.org/schema/1.0/bpmn", "decisionRef")
          .get
        val id = br \@ "id"
        println(s"CHANGED decisionRef -> $decisionRef > $id --")
        decisionRef.toString -> id

    val xmlNew = (callActivities ++ businessRuleTasks ++ externalWorkers)
      .flatMap:
        case refName -> elemId =>
          apiConfig.projectsConfig
            .colorForId(refName, docProjectConfig.projectName)
              .map (_ -> elemId).toSeq
      .foldLeft(xml):
        case (xmlResult, project -> color -> id) =>
          println(s"  -> $project > $id -- $color")
          new RuleTransformer(changeColor(project, id)).apply(xmlResult)
    os.write.over(bpmnPath, xmlNew.toString)
  end extractUsesRefs

  private def changeColor(project: String, id: String) = new RewriteRule:
    override def transform(n: Node): Seq[Node] = n match
      case e: Elem if e.label == "BPMNShape" && (e \@ "bpmnElement").equals(id) =>
        e % Attribute("color", "background-color", Text(s"${colorMap(project)}"), Null)
      case x => x

end ModelerTemplUpdater
