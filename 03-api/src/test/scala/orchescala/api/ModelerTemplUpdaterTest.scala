package orchescala.api

import java.io.StringReader
import scala.xml.XML

class ModelerTemplUpdaterTest extends munit.FunSuite:

  private def bpmn(shapes: String*) =
    s"""<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" id="d">
       |  <bpmndi:BPMNDiagram id="dia">
       |    <bpmndi:BPMNPlane id="plane" bpmnElement="p">
       |${shapes.map(id => s"""      <bpmndi:BPMNShape id="${id}_di" bpmnElement="$id" />""").mkString("\n")}
       |    </bpmndi:BPMNPlane>
       |  </bpmndi:BPMNDiagram>
       |</bpmn:definitions>""".stripMargin

  private val generated = bpmn(
    "InitProcessTask", "OutputmockedBoundaryEvent", "OutputmockedEvent1", "MockedBoundaryEvent", "SendMailTask"
  )

  // the shape's tag - the colour may stand before or after bpmnElement
  private def colorOf(xmlStr: String, elementId: String): Option[String] =
    s"""<bpmndi:BPMNShape [^>]*bpmnElement="$elementId"[^>]*>""".r
      .findFirstIn(xmlStr)
      .flatMap("""color:background-color="([^"]+)"""".r.findFirstMatchIn(_))
      .map(_.group(1))

  // what api/run writes (extractUsesRefs): grey, then the file
  private def written(xmlStr: String): String =
    ModelerTemplUpdater.toBpmnFile(ModelerTemplUpdater.withGeneratedInGrey(XML.load(new StringReader(xmlStr))))

  test("the init worker and the mock elements are grey - as in the createProcess template"):
    val out = written(generated)
    assertEquals(colorOf(out, "InitProcessTask"), Some("#D5D5D5"))
    assertEquals(colorOf(out, "OutputmockedBoundaryEvent"), Some("#D5D5D5"))
    assertEquals(colorOf(out, "OutputmockedEvent1"), Some("#D5D5D5"))
    assertEquals(colorOf(out, "MockedBoundaryEvent"), Some("#D5D5D5"))
    assertEquals(colorOf(out, "SendMailTask"), None)

  test("only the generated ids - an own element that starts with Mocked or Outputmocked stays"):
    val out = written(bpmn("MockedCustomerCheck", "OutputmockedSummaryTask"))
    assertEquals(colorOf(out, "MockedCustomerCheck"), None)
    assertEquals(colorOf(out, "OutputmockedSummaryTask"), None)

  test("an element with a colour of its own keeps it"):
    val own = generated
      .replace("""xmlns:bpmndi=""", """xmlns:color="http://www.omg.org/spec/BPMN/non-normative/color/1.0" xmlns:bpmndi=""")
      .replace("""bpmnElement="InitProcessTask" />""", """bpmnElement="InitProcessTask" color:background-color="#ffffcc" />""")
    assertEquals(colorOf(written(own), "InitProcessTask"), Some("#ffffcc"))

  test("the file: the XML declaration, xmlns:color once - and it is valid XML"):
    val out = written(generated)
    assert(out.startsWith("""<?xml version="1.0" encoding="UTF-8"?>""" + "\n"), out)
    assertEquals("""xmlns:color="""".r.findAllIn(out).size, 1)
    XML.loadString(out) // throws if the prefix is unbound

  test("no colour - no xmlns:color; already there - not added again"):
    assert(!written(bpmn("SendMailTask")).contains("xmlns:color"))
    val withNs = generated.replace("""xmlns:bpmndi=""", """xmlns:color="http://www.omg.org/spec/BPMN/non-normative/color/1.0" xmlns:bpmndi=""")
    assertEquals("""xmlns:color="""".r.findAllIn(written(withNs)).size, 1)

  test("decided on the XML - a colour only in a documentation needs no namespace"):
    val node = XML.loadString(
      """<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d"><bpmn:documentation>color:background-color</bpmn:documentation></bpmn:definitions>"""
    )
    assert(!ModelerTemplUpdater.needsColorNamespace(node))
    assert(!ModelerTemplUpdater.toBpmnFile(node).contains("""xmlns:color="http"""))

  test("decided on the XML - `xmlns:color=` in a documentation is no namespace"):
    val node = ModelerTemplUpdater.withGeneratedInGrey(XML.loadString(
      s"""<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" id="d"><bpmn:documentation>xmlns:color=</bpmn:documentation><bpmndi:BPMNShape id="i" bpmnElement="InitProcessTask" /></bpmn:definitions>"""
    ))
    assert(ModelerTemplUpdater.needsColorNamespace(node))
    XML.loadString(ModelerTemplUpdater.toBpmnFile(node)) // valid - the grey has its namespace

  test("the namespace goes on the definitions tag - not on a tag that only starts like it"):
    val out = ModelerTemplUpdater.withColorNamespace("""<x><definitions-foo /></x><definitions id="d">""")
    assertEquals(out, s"""<x><definitions-foo /></x><definitions xmlns:color="${ModelerTemplUpdater.colorNamespace}" id="d">""")

end ModelerTemplUpdaterTest
