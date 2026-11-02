package orchescala.helper.dev.update.merge

import munit.FunSuite

/** The diagram of a BPMN or DMN merged apart from its logic: moving shapes never conflicts with a
  * changed flow, nor two moves with each other - where the text merge alone would conflict.
  */
class DiagramMergeTest extends FunSuite:

  private def shape(id: String, x: Int, y: Int = 100) =
    s"""      <bpmndi:BPMNShape id="${id}_di" bpmnElement="$id">
       |        <dc:Bounds height="80" width="100" x="$x" y="$y" />
       |      </bpmndi:BPMNShape>""".stripMargin

  private def bpmn(logic: Seq[String], shapes: Seq[String]) =
    (Seq(
      """<?xml version="1.0" encoding="UTF-8"?>""",
      """<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" id="d">""",
      """  <bpmn:process id="p" isExecutable="true">"""
    ) ++ logic.map("    " + _) ++ Seq(
      "  </bpmn:process>",
      """  <bpmndi:BPMNDiagram id="D">""",
      """    <bpmndi:BPMNPlane id="P" bpmnElement="p">"""
    ) ++ shapes ++ Seq("    </bpmndi:BPMNPlane>", "  </bpmndi:BPMNDiagram>", "</bpmn:definitions>")).mkString("", "\n", "\n")

  private val logic = Seq("""<bpmn:startEvent id="s" name="start" />""", """<bpmn:serviceTask id="a" name="A" />""", """<bpmn:endEvent id="e" />""")
  private val base  = bpmn(logic, Seq(shape("s", 100), shape("a", 200), shape("e", 400)))

  private def merged(b: String, c: String, n: String) = DiagramMerge.merge(b, c, n).getOrElse(fail("not split"))

  test("both moved the same shape: no conflict - the code's layout stays, with a note"):
    val code = bpmn(logic.updated(0, """<bpmn:startEvent id="s" name="begin" />"""), Seq(shape("s", 100), shape("a", 250), shape("e", 400)))
    val spec = bpmn(logic, Seq(shape("s", 100), shape("a", 300), shape("e", 400)))
    assert(!ThreeWay.merge(base, code, spec).clean) // as text: a conflict
    val r    = merged(base, code, spec)
    assert(r.merge.clean)
    assertEquals(r.merge.text, code)
    assertEquals(r.notes, Seq("Layout of a: moved in the code and in orch-spec - the code's stays"))

  test("a new task from orch-spec: its shape after its neighbour - the developer's moves and logic stay"):
    val code = bpmn(logic.updated(0, """<bpmn:startEvent id="s" name="begin" />"""), Seq(shape("s", 110), shape("a", 210), shape("e", 410)))
    val spec = bpmn(logic.patch(2, Seq("""<bpmn:serviceTask id="b" name="B" />"""), 0), Seq(shape("s", 100), shape("a", 200), shape("b", 300), shape("e", 500)))
    val r    = merged(base, code, spec)
    assert(r.merge.clean, r.merge.text)
    assertEquals(
      r.merge.text,
      bpmn(
        logic.updated(0, """<bpmn:startEvent id="s" name="begin" />""").patch(2, Seq("""<bpmn:serviceTask id="b" name="B" />"""), 0),
        // e: moved by both - the code's
        Seq(shape("s", 110), shape("a", 210), shape("b", 300), shape("e", 410))
      )
    )

  test("a task removed in orch-spec: its shape goes, even if the developer moved it"):
    val code = bpmn(logic, Seq(shape("s", 100), shape("a", 222), shape("e", 400)))
    val spec = bpmn(logic.patch(1, Nil, 1), Seq(shape("s", 100), shape("e", 400)))
    val r    = merged(base, code, spec)
    assert(r.merge.clean)
    assertEquals(r.merge.text, spec)

  test("a conflict in the logic stays a conflict - the diagram is merged all the same"):
    val code = bpmn(logic.updated(1, """<bpmn:serviceTask id="a" name="A code" />"""), Seq(shape("s", 100), shape("a", 200), shape("e", 400)))
    val spec = bpmn(logic.updated(1, """<bpmn:serviceTask id="a" name="A spec" />"""), Seq(shape("s", 100), shape("a", 200), shape("e", 480)))
    val r    = merged(base, code, spec)
    assertEquals(r.merge.conflicts.map(c => c.code.trim -> c.spec.trim), Seq("""<bpmn:serviceTask id="a" name="A code" />""" -> """<bpmn:serviceTask id="a" name="A spec" />"""))
    assertEquals(r.merge.conflicts.head.line, code.linesIterator.indexWhere(_.contains("A code")) + 1)
    assert(r.merge.text.contains("<<<<<<< code") && r.merge.text.contains("""x="480""""), r.merge.text)
    assert(!r.merge.text.contains("orchescala: diagram"), r.merge.text)

  test("a DMN: the table changed in the code, the decision moved in orch-spec"):
    def dmn(rule: String, x: Int) =
      s"""<?xml version="1.0" encoding="UTF-8"?>
         |<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" xmlns:dmndi="https://www.omg.org/spec/DMN/20191111/DMNDI/" xmlns:dc="http://www.omg.org/spec/DMN/20180521/DC/" id="defs">
         |  <decision id="rules" name="Rules">
         |    <decisionTable id="t">
         |      <rule id="r1">
         |        <outputEntry id="o1">$rule</outputEntry>
         |      </rule>
         |    </decisionTable>
         |  </decision>
         |  <dmndi:DMNDI>
         |    <dmndi:DMNDiagram id="DD">
         |      <dmndi:DMNShape id="rules_di" dmnElementRef="rules">
         |        <dc:Bounds height="80" width="180" x="$x" y="100" />
         |      </dmndi:DMNShape>
         |    </dmndi:DMNDiagram>
         |  </dmndi:DMNDI>
         |</definitions>
         |""".stripMargin
    val r = merged(dmn("\"a\"", 100), dmn("\"b\"", 100), dmn("\"a\"", 300))
    assert(r.merge.clean)
    assertEquals(r.merge.text, dmn("\"b\"", 300))

  test("without a diagram: None - the file is merged as text"):
    assertEquals(DiagramMerge.merge("<a/>\n", "<a/>\n", "<b/>\n"), None)

end DiagramMergeTest
