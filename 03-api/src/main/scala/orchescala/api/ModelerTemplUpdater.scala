package orchescala.api

import io.circe.generic.auto.deriveEncoder
import io.circe.parser
import io.circe.syntax.*
import orchescala.domain.BpmnProcessType
import templates.*

import java.io.StringReader
import scala.language.postfixOps
import scala.xml.*
import scala.xml.transform.{RewriteRule, RuleTransformer}

case class ModelerTemplUpdater(apiConfig: ApiConfig, apiProjectConfig: ApiProjectConfig):
  private lazy val templConfigs = apiConfig.modelerTemplateConfigs

  def update(): Unit =
    updateTemplates()
    updateBpmnColors()
  end update

  private def updateTemplates(): Unit =
    docProjectConfig.dependencies
      .foreach: c =>
        templConfigs.foreach: templConfig =>
          val toPath   = templConfig.templatePath / "dependencies"
          os.makeDir.all(toPath)
          val fromPath = apiConfig.tempGitDir / c.projectName / templConfig.templateRelativePath
          println(s"Fetch dependencies: ${c.projectName} > $fromPath")
          if os.exists(fromPath) then
            os.list(fromPath)
              .filter: p =>
                p.last.startsWith(c.projectName)
              .map: p =>
                parser.parse(os.read(p))
                  .flatMap:
                    case json if json.isArray =>
                      json.asArray
                        .get
                        .head
                        .as[MTemplateC8]
                    case json =>
                      json.as[MTemplate]
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
                      println(s" - Just copy Template: ${t.id} - from $p to ${toPath / p.last}")
                      os.copy(p, toPath / p.last, replaceExisting = true)
                  .left.foreach: ex =>
                    println(s"Problem parsing Template: $ex")
          else
            println(s"No Modeler Templates for $fromPath")
          end if
  end updateTemplates

  private def updateBpmnColors(): Unit =
    BpmnProcessType.diagramPaths.foreach: diagramPath =>
      if os.exists(os.pwd / diagramPath) then
        println(s"Adjust Color for $diagramPath:")
        projectsConfig.projectConfig(docProjectConfig.projectName)
          .map: pc =>
            os.walk(os.pwd / diagramPath)
              .filter:
                _.toString.endsWith(".bpmn")
              .map: p =>
                p -> os.read(p)
              .map:
                extractUsesRefs
      else println(s"No BPMN Diagrams found for $diagramPath")
  end updateBpmnColors

  private lazy val projectsConfig                     = apiConfig.projectsConfig
  private lazy val docProjectConfig: DocProjectConfig = DocProjectConfig(apiProjectConfig)
  private lazy val colorMap                           = apiConfig.projectsConfig.colors.toMap

  private def extractUsesRefs(bpmnPath: os.Path, xmlStr: String) =
    println(s" - ${bpmnPath.last}")
    val xml: Node      = XML.load(new StringReader(xmlStr))
    val callActivities = (xml \\ "callActivity")
      .map: ca =>
        val calledElement = ca \@ "calledElement"
        val id            = ca \@ "id"
        println(s"CHANGED  -> $calledElement > $id --")
        calledElement -> id

    val externalWorkers = (xml \\ "serviceTask")
      .map: br =>
        val workerRef = br
          .attribute("http://camunda.org/schema/1.0/bpmn", "topic")
          .get
        val id        = br \@ "id"
        println(s"CHANGED workerRef -> $workerRef > $id --")
        workerRef.toString -> id

    val businessRuleTasks = (xml \\ "businessRuleTask")
      .map: br =>
        val decisionRef = br
          .attribute("http://camunda.org/schema/1.0/bpmn", "decisionRef")
          .get
        val id          = br \@ "id"
        println(s"CHANGED decisionRef -> $decisionRef > $id --")
        decisionRef.toString -> id

    val xmlNew = (callActivities ++ businessRuleTasks ++ externalWorkers)
      .flatMap:
        case refName -> elemId =>
          apiConfig.projectsConfig
            .colorForId(refName, docProjectConfig.projectName)
            .map(_ -> elemId).toSeq
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
      case x                                                                    => x

end ModelerTemplUpdater
