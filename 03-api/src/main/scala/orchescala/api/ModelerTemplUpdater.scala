package orchescala.api

import io.circe.generic.auto.deriveEncoder
import io.circe.parser
import io.circe.syntax.*
import orchescala.domain.BpmnProcessType
import templates.*

import java.io.StringReader
import scala.language.postfixOps
import scala.util.Try
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

  private def updateBpmnColors(): Unit = colourProject(os.pwd)

  /** Colours the BPMNs of the project in `projectDir` - in every folder of `colouredPaths`. A file
    * that cannot be coloured is reported and left as it is; the others are coloured all the same -
    * a draft must not stop the docs. Returns the files not coloured (summed up in a warning).
    */
  private[api] def colourProject(projectDir: os.Path): Seq[os.Path] =
    projectsConfig.projectConfig(docProjectConfig.projectName) match
      case None    =>
        println(s"No colours: ${docProjectConfig.projectName} is not in the projectsConfig")
        Seq.empty
      case Some(_) =>
        val notColoured = ModelerTemplUpdater.colouredPaths.flatMap: path =>
          if os.exists(projectDir / path) then
            println(s"Adjust Color for $path:")
            os.walk(projectDir / path)
              .filter:
                _.ext == "bpmn"
              .flatMap: p =>
                Try(extractUsesRefs(p, os.read(p))).failed.toOption.map: ex =>
                  println(s" - ${p.last}: not coloured - $ex")
                  p
          else
            println(s"No BPMN Diagrams found in $path")
            Seq.empty
        if notColoured.nonEmpty then
          val files = notColoured.map(_.relativeTo(projectDir)).mkString(", ")
          println(s"WARNING: ${notColoured.size} BPMN(s) not coloured: $files")
        notColoured
    end match
  end colourProject

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

    // without a topic or a decisionRef (e.g. a step in orch-spec without a service yet) - no colour
    val externalWorkers = (xml \\ "serviceTask")
      .flatMap: st =>
        st.attribute("http://camunda.org/schema/1.0/bpmn", "topic").map: workerRef =>
          val id = st \@ "id"
          println(s"CHANGED workerRef -> $workerRef > $id --")
          workerRef.toString -> id

    val businessRuleTasks = (xml \\ "businessRuleTask")
      .flatMap: br =>
        br.attribute("http://camunda.org/schema/1.0/bpmn", "decisionRef").map: decisionRef =>
          val id = br \@ "id"
          println(s"CHANGED decisionRef -> $decisionRef > $id --")
          decisionRef.toString -> id

    val xmlNew = ModelerTemplUpdater.withGeneratedInGrey(
      (callActivities ++ businessRuleTasks ++ externalWorkers)
        .flatMap:
          case refName -> elemId =>
            apiConfig.projectsConfig
              .colorForId(refName, docProjectConfig.projectName)
              .map(_ -> elemId).toSeq
        .foldLeft(xml):
          case (xmlResult, project -> color -> id) =>
            println(s"  -> $project > $id -- $color")
            new RuleTransformer(changeColor(project, id)).apply(xmlResult)
    )
    // next to it, then moved over it - orch-spec may open the file meanwhile, never half written
    val tmp = bpmnPath / os.up / s".${bpmnPath.last}.tmp"
    os.write.over(tmp, ModelerTemplUpdater.toBpmnFile(xmlNew))
    os.move(tmp, bpmnPath, replaceExisting = true, atomicMove = true)
  end extractUsesRefs

  private def changeColor(project: String, id: String) = new RewriteRule:
    override def transform(n: Node): Seq[Node] = n match
      case e: Elem if e.label == "BPMNShape" && (e \@ "bpmnElement").equals(id) =>
        e % Attribute("color", "background-color", Text(s"${colorMap(project)}"), Null)
      case x                                                                    => x

end ModelerTemplUpdater

object ModelerTemplUpdater:
  val colorNamespace = "http://www.omg.org/spec/BPMN/non-normative/color/1.0"

  /** Where orch-spec keeps its copy of the BPMN in a project - what it shows. */
  val specProcessesPath: os.RelPath = os.rel / "spec" / "processes"

  /** The folders whose BPMNs `api/run` colours: the diagrams of the engine (what is deployed) and
    * the copy of orch-spec. Both get the same colours; before, orch-spec showed its copy without.
    */
  def colouredPaths: Seq[os.RelPath] = BpmnProcessType.diagramPaths :+ specProcessesPath

  // the grey of BpmnProcessGenerator's template
  val generatedGrey  = "#D5D5D5"

  /** The ids the template of `createProcess` (BpmnProcessGenerator) and orch-spec's «output-mocked»
    * give the init worker and the mock elements - exactly these, so an own element (e.g.
    * `MockedCustomerCheck`) is never greyed.
    */
  val generatedIds: Set[String] = Set(
    "InitProcessTask",
    "MockedBoundaryEvent",
    "OutputmockedBoundaryEvent",
    "OutputmockedEvent",
    "OutputmockedEvent1",
    "OutputmockedEndEvent"
  )

  /** The init worker and the mock elements in grey - as the template of `createProcess` has them,
    * so also a BPMN of orch-spec (`processFromSpec`) gets them. An element with a colour of its own
    * keeps it.
    */
  def withGeneratedInGrey(xml: Node): Node =
    new RuleTransformer(greyGenerated).apply(xml)

  private val greyGenerated = new RewriteRule:
    override def transform(n: Node): Seq[Node] = n match
      case e: Elem
          if e.label == "BPMNShape" && generatedIds(e \@ "bpmnElement") &&
            !e.attributes.exists(_.key == "background-color") =>
        e % Attribute("color", "background-color", Text(generatedGrey), Null)
      case x => x

  /** The file `api/run` writes: serialized as the Modeler does, with `xmlns:color` if a colour needs
    * it - and parsed again first, so a broken BPMN is never written (it throws).
    */
  def toBpmnFile(xml: Node): String =
    val body = CamundaXmlPrinter.toCamundaXmlString(xml)
    val text = if needsColorNamespace(xml) then withColorNamespace(body) else body
    XML.loadString(text)
    """<?xml version="1.0" encoding="UTF-8"?>""" + "\n" + text + "\n"
  end toBpmnFile

  /** A `color:` attribute somewhere, but no `xmlns:color` on the definitions - decided on the XML,
    * not on its text (comments or documentation do not count).
    */
  private[api] def needsColorNamespace(xml: Node): Boolean =
    Option(xml.scope.getURI("color")).isEmpty &&
      (xml \\ "_").exists(_.attributes.exists:
        case a: PrefixedAttribute => a.pre == "color"
        case _                    => false)

  /** `xmlns:color` on the definitions - added to the text: a binding added in scala-xml only on the
    * root is written again on every child.
    */
  private[api] def withColorNamespace(xmlStr: String): String =
    // the tag `definitions` itself (not `definitions-foo`); the namespace is a plain URI - no `$` or `\`
    """<((?:\w+:)?definitions)(?=[\s/>])""".r
      .replaceFirstIn(xmlStr, s"""<$$1 xmlns:color="$colorNamespace"""")
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
