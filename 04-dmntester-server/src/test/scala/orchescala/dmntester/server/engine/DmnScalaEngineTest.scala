package orchescala.dmntester.server.engine

import munit.FunSuite
import orchescala.dmntester.*

/** Locks the behaviour of the only engine implementation - and proves that the
  * Scala 2.13 DMN engine works from Scala 3 (parsing a DMN via os-lib and
  * evaluating FEEL via fastparse in one JVM).
  */
class DmnScalaEngineTest extends FunSuite:

  private val engine: DmnEvalEngine = DmnScalaEngine()

  private val resources =
    os.pwd / "04-dmntester-server" / "src" / "test" / "resources"

  private def parse(flavour: String, dmnName: String): ParsedDmnModel =
    val stream = os.read.inputStream(resources / "dmn" / flavour / dmnName)
    try engine.parse(stream, dmnName).fold(e => fail(e.msg), identity)
    finally stream.close()

  test("the engine says which DMN semantics it implements"):
    assert(engine.name.contains("dmn-scala 1.11.0"), engine.name)
    assert(engine.name.contains("feel-scala 1.20.0"), engine.name)
    assert(engine.name.contains("Camunda 8"), engine.name)

  test("parse a DMN and enumerate its decisions"):
    assertEquals(parse("c8", "c8-dish.dmn").decisionIds, Seq("c8-dish"))

  test("read hit policy, columns and rules of a decision table"):
    val model = parse("c8", "c8-dish.dmn")
    val tables =
      engine.decisionTables(model, "c8-dish", testUnit = true).fold(e => fail(e.msg), identity)
    assertEquals(tables.size, 1)
    val table = tables.head
    assertEquals(table.hitPolicy, HitPolicy.UNIQUE)
    assertEquals(table.aggregation, None)
    assertEquals(table.inputCols.map(_.name), Seq("Season", "How many guests"))
    assertEquals(table.inputCols.map(_.feelExprText), Seq("season", "guestCount"))
    assertEquals(table.outputCols.map(_.name), Seq("desiredDish"))
    assertEquals(table.ruleRows.size, 4)
    assertEquals(
      table.ruleRows.head,
      DmnRule(
        1,
        "DecisionRule_1",
        Seq("Season" -> "\"Fall\"", "How many guests" -> "<= 8"),
        Seq("desiredDish" -> "\"Spareribs\"")
      )
    )

  test("evaluate a row - the matched rule with its in-/ outputs"):
    val model = parse("c8", "c8-dish.dmn")
    val results = engine
      .evalRow(model, "c8-dish", testUnit = true, Map("season" -> "Winter", "guestCount" -> 4))
      .fold(e => fail(e.msg), identity)
    assertEquals(results.size, 1)
    val table = results.head
    assertEquals(table.decisionId, "c8-dish")
    assertEquals(table.maybeError, None)
    assertEquals(table.matchedRules.map(_.ruleId), Seq("DecisionRule_2"))
    assertEquals(table.matchedRules.head.outputs, Seq("desiredDish" -> "Roastbeef"))

  test("evaluate a row that matches no rule"):
    val model = parse("c7", "collect-numbers.dmn")
    val results = engine
      .evalRow(model, "collect-numbers", testUnit = true, Map("number" -> 0))
      .fold(e => fail(e.msg), identity)
    assertEquals(results.head.matchedRules, Seq.empty)

  test("COLLECT can match more than one rule"):
    val model = parse("c7", "collect-numbers.dmn")
    val tables = engine
      .decisionTables(model, "collect-numbers", testUnit = true)
      .fold(e => fail(e.msg), identity)
    assertEquals(tables.head.hitPolicy, HitPolicy.COLLECT)
    val results = engine
      .evalRow(model, "collect-numbers", testUnit = true, Map("number" -> 1))
      .fold(e => fail(e.msg), identity)
    assertEquals(results.head.matchedRules.size, 2)

  test("an evaluation error of a row is reported, not thrown"):
    val model = parse("c7", "eval-error.dmn")
    val results = engine
      .evalRow(model, "eval-error", testUnit = true, Map("season" -> "fall"))
      .fold(e => fail(e.msg), identity)
    assert(
      results.head.maybeError.exists(_.msg.contains("UNIQUE hit policy")),
      results.head.maybeError
    )

  test("a DMN with a not parsable FEEL expression fails on parse"):
    val stream = os.read.inputStream(resources / "dmn" / "c7" / "bad-feel-output.dmn")
    val error = engine.parse(stream, "bad-feel-output.dmn").swap.getOrElse(fail("expected a parse error"))
    stream.close()
    assert(error.msg.contains("failed to parse expression ''"), error.msg)

  test("an unknown decision id is an error - and lists what is there"):
    val model = parse("c8", "c8-dish.dmn")
    val error = engine
      .decisionTables(model, "not-here", testUnit = true)
      .swap
      .getOrElse(fail("expected an error"))
    assert(error.msg.contains("No decision found with id 'not-here'"), error.msg)
    assert(error.msg.contains("c8-dish"), error.msg)

  test("required decisions are separate tables when testUnit is off"):
    val model = parse("c7", "invoiceBusinessDecisions.dmn")
    val unit = engine
      .decisionTables(model, "invoice-assign-approver", testUnit = true)
      .fold(e => fail(e.msg), identity)
    val integrated = engine
      .decisionTables(model, "invoice-assign-approver", testUnit = false)
      .fold(e => fail(e.msg), identity)
    assertEquals(unit.size, 1)
    assert(integrated.size > 1, s"expected required decisions, got ${integrated.map(_.decisionId)}")
    assertEquals(integrated.head.decisionId, "invoice-assign-approver")

end DmnScalaEngineTest
