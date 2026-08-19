package orchescala.dmntester.server.runner

import munit.FunSuite
import orchescala.dmntester.*
import orchescala.dmntester.server.engine.DmnScalaEngine
import zio.{Runtime, Unsafe}

/** End to end: DmnConfig -> DMN evaluation -> DmnEvalResult. */
class DmnTesterTest extends FunSuite:

  private val engine = DmnScalaEngine()
  private val resources = os.pwd / "04-dmntester-server" / "src" / "test" / "resources"

  private def run[E, A](body: zio.ZIO[Any, E, A]): Either[E, A] =
    Unsafe.unsafe { implicit unsafe =>
      Runtime.default.unsafe.run(body.either).getOrThrowFiberFailure()
    }

  private def config(flavour: String, name: String): DmnConfig =
    run(DmnConfigHandler.read((resources / "dmn-config" / flavour / s"$name.conf").toIO))
      .fold(e => fail(e.msg), identity)

  private def result(flavour: String, name: String): DmnEvalResult =
    run(DmnTester(config(flavour, name), engine).run()).fold(e => fail(e.msg), identity)

  test("test all input combinations of country-risk"):
    val res = result("c7", "country-risk")
    assertEquals(res.dmnTables.tables.size, 1)
    assertEquals(res.dmnTables.mainTable.hitPolicy, HitPolicy.FIRST)
    assertEquals(res.evalResults.size, 25) // 5 x 5 inputs
    assertEquals(res.inputKeys, Seq("currentCountry", "targetCountry"))
    assertEquals(res.outputKeys, Seq("approvalRequired"))
    // every row is covered by a test case in country-risk.conf
    assertEquals(res.evalResults.map(_.status).distinct, Seq(EvalStatus.INFO))
    // ... but not every rule of the table is reached
    assertEquals(res.missingRules.map(_.index), Seq(3, 5))
    assertEquals(res.maxEvalStatus, EvalStatus.WARN)

  test("acceptMissingRules turns the missing-rules warning off"):
    val res = result("c7", "country-risk")
    val accepted = res.copy(dmnTables =
      res.dmnTables.copy(dmnConfig = res.dmnTables.dmnConfig.copy(acceptMissingRules = true))
    )
    assertEquals(res.maxEvalStatus, EvalStatus.WARN)
    assertEquals(accepted.maxEvalStatus, EvalStatus.INFO)

  test("a matched rule of the main table knows its row index and outputs"):
    val res = result("c7", "country-risk")
    val row = res.evalResults
      .find(_.testInputs == Map("currentCountry" -> "CH", "targetCountry" -> "DE"))
      .getOrElse(fail("row not found"))
    val perTable = row.matchedRulesPerTable.head
    assertEquals(perTable.decisionId, "country-risk")
    val rule = perTable.matchedRules.head
    assertEquals(rule.rowIndex, TestSuccess("2"))
    assertEquals(rule.outputs, Seq("approvalRequired" -> TestSuccess("true")))

  test("required decisions are reported per table, only the main one is checked"):
    val res = result("c7", "invoice-assign-approver")
    assert(res.dmnTables.hasRequiredTables, res.dmnTables.tables.map(_.decisionId))
    val row = res.evalResults.head
    assert(row.matchedRulesPerTable.size > 1, row.matchedRulesPerTable.map(_.decisionId))
    assertEquals(row.matchedRulesPerTable.head.decisionId, "invoice-assign-approver")
    // the required table is shown, but not compared with expectations
    val required = row.matchedRulesPerTable.tail.head
    assert(
      required.matchedRules.flatMap(_.outputs).forall(_._2.isInstanceOf[NotTested]),
      required.matchedRules
    )

  test("COLLECT collects all matching rules of a row"):
    val res = result("c7", "collect-numbers")
    val row = res.evalResults.find(_.testInputs("number") == "1").getOrElse(fail("row not found"))
    assertEquals(res.dmnTables.mainTable.hitPolicy, HitPolicy.COLLECT)
    assertEquals(row.matchedRulesPerTable.head.matchedRules.size, 2)

  test("accepted rows become test cases and are verified on the next run"):
    val first = result("c8", "c8-dish").copy()
    val cfg = first.dmnTables.dmnConfig.copy(data =
      first.dmnTables.dmnConfig.data.copy(testCases = List.empty)
    )
    val fresh = run(DmnTester(cfg, engine).run()).fold(e => fail(e.msg), identity)
    assert(
      fresh.evalResults.flatMap(_.matchedRulesPerTable).flatMap(_.matchedRules)
        .forall(_.rowIndex.isInstanceOf[NotTested])
    )
    val accepted = fresh.configWithTestCases(fresh.correctRowIndexes)
    assertEquals(accepted.data.testCases.size, fresh.evalResults.size)
    val second = run(DmnTester(accepted, engine).run()).fold(e => fail(e.msg), identity)
    assert(
      second.evalResults.flatMap(_.matchedRulesPerTable).flatMap(_.matchedRules)
        .forall(_.rowIndex.isInstanceOf[TestSuccess]),
      second.evalResults.flatMap(_.matchedRulesPerTable).flatMap(_.matchedRules).map(_.rowIndex)
    )
    assertEquals(second.evalResults.map(_.status).distinct, Seq(EvalStatus.INFO))

  test("an object Input is tested like any other - one row per object"):
    val res = result("c7", "selected-fond")
    assertEquals(res.inputKeys, Seq("selectedFond"))
    assertEquals(res.outputKeys, Seq("share"))
    assertEquals(
      res.evalResults.map(_.testInputs("selectedFond")),
      Seq("{id: 11393215, percentage: 10}", "{id: 11393215, percentage: 50}")
    )
    assertEquals(
      res.evalResults.flatMap(_.matchedRulesPerTable).flatMap(_.matchedRules)
        .flatMap(_.outputs.map(_._2.value)),
      Seq("small", "big")
    )
    assertEquals(res.missingRules, Seq.empty)

  test("accepted rows of an object Input are found again as test cases"):
    val fresh = result("c7", "selected-fond")
    val accepted = fresh.configWithTestCases(fresh.correctRowIndexes)
    assertEquals(accepted.data.testCases.size, 2)
    val second = run(DmnTester(accepted, engine).run()).fold(e => fail(e.msg), identity)
    assert(
      second.evalResults.flatMap(_.matchedRulesPerTable).flatMap(_.matchedRules)
        .forall(_.rowIndex.isInstanceOf[TestSuccess]),
      second.evalResults.flatMap(_.matchedRulesPerTable).flatMap(_.matchedRules)
        .map(_.rowIndex)
    )
    assertEquals(second.maxEvalStatus, EvalStatus.INFO)

  test("a wrong DMN path is an EvalException - the run does not blow up"):
    val res = run(DmnTester(config("c7", "bad-path"), engine).run())
    assert(res.isLeft)
    assert(res.swap.toOption.get.msg.contains("There was no DMN in"))

  test("a broken FEEL expression gives a helpful hint"):
    val res = run(DmnTester(config("c7", "bad-feel-output"), engine).run())
    val msg = res.swap.toOption.getOrElse(fail("expected an error")).msg
    assert(msg.contains("All outputs need a value"), msg)
    assert(msg.contains("failed to parse expression ''"), msg)

end DmnTesterTest
