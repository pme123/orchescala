package orchescala.dmntester.server.runner

import orchescala.dmntester.*
import orchescala.dmntester.HandledTesterException.EvalException
import orchescala.dmntester.server.engine.*
import zio.{IO, ZIO}

/** Tests ONE DmnConfig with ALL input combinations.
  *
  * Pure orchestration - the DMN evaluation itself is delegated to the
  * [[DmnEvalEngine]]; the comparison against the configured test cases and the
  * aggregation into a [[DmnEvalResult]] happen here.
  *
  * With `testUnit = false` a decision is evaluated together with its required
  * decisions: every table reports its own matched rules
  * ([[MatchedRulesPerTable]]), but only the MAIN table is compared with the
  * expected values - the required decisions are an implementation detail of
  * the decision under test.
  */
case class DmnTableEngine(
    engine: DmnEvalEngine,
    model: ParsedDmnModel,
    dmnConfig: DmnConfig
):

  private val decisionId = dmnConfig.decisionId
  private val testUnit = dmnConfig.testUnit

  def evalDecision(
      source: Option[String] = None,
      dmnPath: String = ""
  ): IO[EvalException, DmnEvalResult] =
    for
      tables <- evalError(engine.decisionTables(model, decisionId, testUnit))
      allTables = AllDmnTables(dmnConfig, tables, source, dmnPath)
      rows <- ZIO.foreach(dmnConfig.data.allInputs())(evalRow(allTables, _))
      mainRules = rows
        .flatMap(_.matchedRulesPerTable.filter(_.isForMainTable(decisionId)))
      outputKeys = mainRules
        .flatMap(_.matchedRules)
        .headOption
        .toSeq
        .flatMap(_.outputs.map(_._1))
    yield DmnEvalResult(
      allTables,
      dmnConfig.data.inputKeys,
      outputKeys,
      rows,
      missingRules(mainRules.flatMap(_.matchedRules), allTables.mainTable)
    )

  private def evalRow(
      allTables: AllDmnTables,
      inputMap: Map[String, Any]
  ): IO[EvalException, DmnEvalRowResult] =
    for
      tableResults <- evalError(
        engine.evalRow(model, decisionId, testUnit, inputMap)
      )
      perTable = tableResults.map: tableResult =>
        MatchedRulesPerTable(
          tableResult.decisionId,
          tableResult.matchedRules.map(
            matchedRule(allTables, tableResult.decisionId, inputMap, _)
          ),
          tableResult.maybeError
        )
      evalResult = EvalResult(perTable)
    yield DmnEvalRowResult(
      evalResult.status,
      inputMap.view.mapValues(v => if v == null then "null" else v.toString).toMap,
      perTable,
      evalResult.failed
    )

  /** adds the comparison with the configured test case to a matched rule. */
  private def matchedRule(
      allTables: AllDmnTables,
      tableId: String,
      inputMap: Map[String, Any],
      rule: MatchedRuleResult
  ): MatchedRule =
    val isMainTable = allTables.isMainTable(tableId)
    val ruleIndex = allTables
      .table(tableId)
      .flatMap(_.ruleRows.find(_.ruleId == rule.ruleId))
      .map(_.index)
    val testedIndex = ruleIndex match
      case Some(index) if isMainTable => checkIndex(index, inputMap)
      case Some(index)                => NotTested(index.toString)
      case None                       => TestFailure(s"No Rule ID ${rule.ruleId} found!")
    MatchedRule(
      rule.ruleId,
      testedIndex,
      rule.inputs,
      if isMainTable then checkOutputs(inputMap, testedIndex, rule.outputs)
      else rule.outputs.map((key, value) => key -> NotTested(value))
    )

  private def checkIndex(rowIndex: Int, inputMap: Map[String, Any]): TestedValue =
    dmnConfig
      .findTestCase(inputMap)
      .map(_.checkIndex(rowIndex))
      .getOrElse(NotTested(rowIndex.toString))

  private def checkOutputs(
      inputMap: Map[String, Any],
      rowIndex: TestedValue,
      outputs: Seq[(String, String)]
  ): Seq[(String, TestedValue)] =
    if rowIndex.isError then outputs.map((key, value) => key -> NotTested(value))
    else
      val maybeTestCase = dmnConfig.findTestCase(inputMap)
      outputs.map: (key, value) =>
        key -> maybeTestCase
          .map(_.checkOut(rowIndex.intValue, key, value))
          .getOrElse(NotTested(value))

  /** rules of the MAIN table that no input combination reached */
  private def missingRules(
      matchedRules: Seq[MatchedRule],
      mainTable: DmnTable
  ): Seq[DmnRule] =
    val matchedRuleIds = matchedRules.map(_.ruleId).distinct
    mainTable.ruleRows.filterNot(rule => matchedRuleIds.contains(rule.ruleId))

  private def evalError[A](either: Either[EvalError, A]): IO[EvalException, A] =
    ZIO.fromEither(either).mapError(error => EvalException(decisionId, error.msg))
end DmnTableEngine
