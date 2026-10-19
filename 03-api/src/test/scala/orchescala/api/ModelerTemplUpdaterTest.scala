package orchescala.api

import java.io.StringReader
import scala.xml.XML

class ModelerTemplUpdaterTest extends munit.FunSuite:

  private val bpmn =
    """<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" id="d">
      |  <bpmndi:BPMNDiagram id="dia">
      |    <bpmndi:BPMNPlane id="plane" bpmnElement="p">
      |      <bpmndi:BPMNShape id="InitProcessTask_di" bpmnElement="InitProcessTask" />
      |      <bpmndi:BPMNShape id="OutputmockedBoundaryEvent_di" bpmnElement="OutputmockedBoundaryEvent" />
      |      <bpmndi:BPMNShape id="MockedBoundaryEvent_di" bpmnElement="MockedBoundaryEvent" />
      |      <bpmndi:BPMNShape id="SendMailTask_di" bpmnElement="SendMailTask" />
      |    </bpmndi:BPMNPlane>
      |  </bpmndi:BPMNDiagram>
      |</bpmn:definitions>""".stripMargin

  // the shape's tag - the colour may stand before or after bpmnElement
  private def colorOf(xmlStr: String, elementId: String): Option[String] =
    s"""<bpmndi:BPMNShape [^>]*bpmnElement="$elementId"[^>]*>""".r
      .findFirstIn(xmlStr)
      .flatMap("""color:background-color="([^"]+)"""".r.findFirstMatchIn(_))
      .map(_.group(1))

  private def grey(xmlStr: String): String =
    ModelerTemplUpdater.withColorNamespace(
      CamundaXmlPrinter.toCamundaXmlString(
        ModelerTemplUpdater.withGeneratedInGrey(XML.load(new StringReader(xmlStr)))
      )
    )

  test("the init worker and the output-mocked / mocked elements are grey - as in the createProcess template"):
    val out = grey(bpmn)
    assertEquals(colorOf(out, "InitProcessTask"), Some("#D5D5D5"))
    assertEquals(colorOf(out, "OutputmockedBoundaryEvent"), Some("#D5D5D5"))
    assertEquals(colorOf(out, "MockedBoundaryEvent"), Some("#D5D5D5"))
    assertEquals(colorOf(out, "SendMailTask"), None)

  test("an element with a colour of its own keeps it"):
    val own = bpmn
      .replace("""xmlns:bpmndi=""", """xmlns:color="http://www.omg.org/spec/BPMN/non-normative/color/1.0" xmlns:bpmndi=""")
      .replace("""bpmnElement="InitProcessTask" />""", """bpmnElement="InitProcessTask" color:background-color="#ffffcc" />""")
    assertEquals(colorOf(grey(own), "InitProcessTask"), Some("#ffffcc"))

  test("a coloured BPMN without xmlns:color gets it once - and is valid XML"):
    val out = grey(bpmn)
    assertEquals("""xmlns:color="""".r.findAllIn(out).size, 1)
    assert(out.startsWith("""<bpmn:definitions xmlns:color="http://www.omg.org/spec/BPMN/non-normative/color/1.0""""), out)
    XML.load(new StringReader(out)) // throws if the prefix is unbound

  test("xmlns:color is left as it is - and not added without a colour"):
    val withNs = """<definitions xmlns:color="x"><a color:background-color="#fff" /></definitions>"""
    assertEquals(ModelerTemplUpdater.withColorNamespace(withNs), withNs)
    val noColor = """<definitions><a /></definitions>"""
    assertEquals(ModelerTemplUpdater.withColorNamespace(noColor), noColor)

end ModelerTemplUpdaterTest
