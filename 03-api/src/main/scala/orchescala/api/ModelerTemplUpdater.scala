package orchescala.api

import io.circe.generic.auto.deriveEncoder
import io.circe.parser
import io.circe.syntax.*
import orchescala.domain.BpmnProcessType
import templates.*

import java.io.StringReader
import scala.language.postfixOps
import scala.util.matching.Regex
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
    val xmlDeclaration = """<?xml version="1.0" encoding="UTF-8"?>""" + "\n"
    os.write.over(bpmnPath, xmlDeclaration + CamundaXmlPrinter.toCamundaXmlString(xmlNew) + "\n")
  end extractUsesRefs

  private def changeColor(project: String, id: String) = new RewriteRule:
    override def transform(n: Node): Seq[Node] = n match
      case e: Elem if e.label == "BPMNShape" && (e \@ "bpmnElement").equals(id) =>
        e % Attribute("color", "background-color", Text(s"${colorMap(project)}"), Null)
      case x                                                                    => x

end ModelerTemplUpdater

// Serializes the XML the same way the Camunda Modeler does, so re-saving in the
// Modeler does not produce a huge diff:
// - self-closing tags get a space before `/>` (e.g. `<foo />` instead of `<foo/>`)
// - `"` in attribute values is encoded as `&#34;` instead of `&quot;` (text content is untouched)
// - `'` in attribute values is encoded as `&#39;` instead of being left as-is
// - `xmlns:*` attributes are placed before the other attributes on a tag
object CamundaXmlPrinter:
  def toCamundaXmlString(node: Node): String =
    val sb = new StringBuilder
    Utility.serialize(node, minimizeTags = MinimizeMode.Always, sb = sb)
    val withFixedQuoting = fixQuoting(sb.toString)
    val withReorderedNs  = reorderNamespacesFirst(withFixedQuoting)
    withReorderedNs.replaceAll("(?<!\\s)/>", " />")
  end toCamundaXmlString

  // scala-xml escapes `"` as `&quot;` everywhere, including plain element text content, and never
  // escapes `'`. The Camunda Modeler only escapes `"`/`'` within attribute values (as `&#34;`/`&#39;`)
  // and leaves text content untouched. This walks the string, treating `="..."` matches as attribute
  // values and everything else as text/markup.
  private val attrValuePattern: Regex = "=\"([^\"]*)\"".r

  private def fixQuoting(xmlStr: String): String =
    val sb      = new StringBuilder
    var lastEnd = 0
    attrValuePattern.findAllMatchIn(xmlStr).foreach { m =>
      sb.append(xmlStr.substring(lastEnd, m.start).replace("&quot;", "\""))
      val escapedValue = m.group(1).replace("&quot;", "&#34;").replace("'", "&#39;")
      sb.append("=\"").append(escapedValue).append("\"")
      lastEnd = m.end
    }
    sb.append(xmlStr.substring(lastEnd).replace("&quot;", "\""))
    sb.toString
  end fixQuoting

  private val startTagPattern: Regex  = """<(?!/)([\w.:-]+)((?:\s+[\w.:-]+="[^"]*")*)(\s*/?)>""".r
  private val singleAttrPattern: Regex = """([\w.:-]+)="([^"]*)"""".r

  private def reorderNamespacesFirst(xmlStr: String): String =
    startTagPattern.replaceAllIn(
      xmlStr,
      m =>
        val tagName  = m.group(1)
        val attrsStr = m.group(2)
        val closing  = m.group(3)
        val attrs    = singleAttrPattern.findAllMatchIn(attrsStr).map(a => a.group(1) -> a.group(2)).toList
        if attrs.isEmpty then Regex.quoteReplacement(m.matched)
        else
          val (nsAttrs, otherAttrs) = attrs.partition(_._1.startsWith("xmlns"))
          val reordered             = (nsAttrs ++ otherAttrs)
            .map { case (k, v) => s""" $k="$v"""" }
            .mkString
          Regex.quoteReplacement(s"<$tagName$reordered$closing>")
    )
  end reorderNamespacesFirst
end CamundaXmlPrinter
