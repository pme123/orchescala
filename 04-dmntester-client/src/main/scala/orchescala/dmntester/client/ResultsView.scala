package orchescala.dmntester.client

import com.raquo.laminar.api.L.*
import orchescala.dmntester.HandledTesterException.EvalException
import orchescala.dmntester.*

/** Step 3: what the tester found - every decision table, every evaluated input
  * row with its matched rule(s) and the rules no input reached.
  *
  * A decision with required decisions (`testUnit = false`) shows one table per
  * decision; only the main table is compared with the expected values.
  */
object ResultsView:

  def apply(
      results: Seq[(String, Either[EvalException, DmnEvalResult])]
  ): HtmlElement =
    div(
      h2(cls := "section-title", "3 - Results"),
      results.map:
        case (_, Left(exception))          => failedConfig(exception)
        case (groupPath, Right(evalResult)) =>
          evalResultView(groupPath, evalResult)
    )

  private def failedConfig(exception: EvalException): HtmlElement =
    div(
      cls := "card",
      div(
        cls := "row",
        h3(cls := "section-title", margin := "0", exception.decisionId),
        statusBadge(EvalStatus.ERROR)
      ),
      div(cls := "note error", pre(exception.msg))
    )

  private def evalResultView(
      groupPath: String,
      result: DmnEvalResult
  ): HtmlElement =
    val tables = result.dmnTables
    val mainTable = tables.mainTable
    // the rows the user accepts as correct - everything green is preselected
    val accepted: Var[Set[Int]] = Var(result.correctRowIndexes)
    div(
      cls := "card",
      div(
        cls := "row",
        h3(cls := "section-title", margin := "0", mainTable.decisionId),
        // which DMN of the configuration this result belongs to (c7 / c8)
        tables.source.map(source => span(cls := "badge", source)),
        Option.when(groupPath.nonEmpty && tables.source.isEmpty)(
          span(cls := "badge", groupPath)
        ),
        statusBadge(result.maxEvalStatus),
        span(cls := "muted", s"Hit Policy: ${mainTable.hitPolicy}"),
        mainTable.aggregation.map(a => span(cls := "muted", s"Aggregation: $a")),
        span(cls := "muted", s"${result.evalResults.size} input combination(s)"),
        span(cls := "muted", s"${mainTable.ruleRows.size} rule(s)"),
        Option.when(tables.dmnPath.nonEmpty)(
          span(cls := "muted mono-break", tables.dmnPath)
        ),
        Option.when(tables.hasRequiredTables)(
          span(cls := "muted", s"${tables.requiredTables.size} required decision(s)")
        )
      ),
      missingRulesNote(result),
      h4(cls := "sub-title", "Decision Table"),
      decisionTable(mainTable, result.missingRules),
      tables.requiredTables.map: table =>
        div(
          h4(cls := "sub-title", s"Required Decision: ${table.decisionId}"),
          decisionTable(table, Seq.empty)
        )
      ,
      h4(cls := "sub-title", "Test Results"),
      resultTable(result, accepted),
      acceptRow(groupPath, result, accepted)
    )

  private def missingRulesNote(result: DmnEvalResult): Modifier[HtmlElement] =
    if result.missingRules.isEmpty then emptyNode
    else if result.dmnTables.dmnConfig.acceptMissingRules then
      div(
        cls := "note info",
        s"${result.missingRules.size} rule(s) were never matched: " +
          result.missingRules.map(_.index).mkString(", ") +
          " - accepted (acceptMissingRules)"
      )
    else
      div(
        cls := "note warn",
        s"${result.missingRules.size} rule(s) were never matched: " +
          result.missingRules.map(_.index).mkString(", ")
      )

  private def decisionTable(
      table: DmnTable,
      missingRules: Seq[DmnRule]
  ): HtmlElement =
    val missingIndexes = missingRules.map(_.index).toSet
    div(
      cls := "tableScroll",
      table_(
        thead(
          tr(
            th("#"),
            table.inputCols.map(col => th(title := col.feelExprText, col.name)),
            table.outputCols.map(col => th(col.name)),
            th("Rule Id")
          )
        ),
        tbody(
          table.ruleRows.map: rule =>
            tr(
              cls := (if missingIndexes.contains(rule.index) then "missing" else ""),
              td(cls := "index", rule.index.toString),
              rule.inputs.map((_, expr) => td(cellText(expr))),
              rule.outputs.map((_, expr) => td(cellText(expr))),
              td(cls := "notTested", rule.ruleId)
            )
        )
      )
    )

  private def resultTable(
      result: DmnEvalResult,
      accepted: Var[Set[Int]]
  ): HtmlElement =
    val inputKeys = result.inputKeys
    val outputKeys = result.outputKeys
    div(
      cls := "tableScroll",
      table_(
        thead(
          tr(
            th(title := "the outputs of this row are correct", "OK"),
            th("Status"),
            inputKeys.map(key => th(s"in: $key")),
            Option.when(result.dmnTables.hasRequiredTables)(th("Table")),
            th("Rule"),
            outputKeys.map(key => th(s"out: $key")),
            th("Error")
          )
        ),
        tbody(
          result.evalResults.zipWithIndex.flatMap: (row, index) =>
            resultRows(result, row, index, accepted)
        )
      )
    )

  private def resultRows(
      result: DmnEvalResult,
      row: DmnEvalRowResult,
      index: Int,
      accepted: Var[Set[Int]]
  ): Seq[HtmlElement] =
    val inputKeys = result.inputKeys
    val outputKeys = result.outputKeys
    val showTable = result.dmnTables.hasRequiredTables
    val mainId = result.dmnTables.mainTable.decisionId

    def inputCells =
      inputKeys.map(key => td(cellText(row.testInputs.getOrElse(key, "-"))))
    def errorCell(msg: Option[String]) =
      td(cls := "failure", msg.getOrElse(""))
    def acceptCell =
      if row.hasNoMatch then td(cls := "notTested", "-")
      else
        td(
          input(
            tpe := "checkbox",
            checked <-- accepted.signal.map(_.contains(index)),
            onInput.mapToChecked --> (isAccepted =>
              accepted.update(rows =>
                if isAccepted then rows + index else rows - index
              )
            )
          )
        )

    // one line per matched rule, grouped per table - the main table first
    val lines: Seq[(String, Option[MatchedRule], Option[String])] =
      if row.matchedRulesPerTable.isEmpty then Seq((mainId, None, row.maybeError.map(_.msg)))
      else
        row.matchedRulesPerTable.flatMap: perTable =>
          if perTable.matchedRules.isEmpty then
            Seq((perTable.decisionId, None, perTable.maybeError.map(_.msg)))
          else
            perTable.matchedRules.map(rule =>
              (perTable.decisionId, Some(rule), perTable.maybeError.map(_.msg))
            )

    lines.zipWithIndex.map:
      case ((tableId, maybeRule, error), lineIndex) =>
        val isMain = tableId == mainId
        tr(
          if lineIndex == 0 then acceptCell else td(),
          if lineIndex == 0 then td(statusBadge(row.status)) else td(),
          inputCells,
          Option.when(showTable)(
            td(cls := (if isMain then "" else "notTested"), tableId)
          ),
          maybeRule match
            case Some(rule) => td(cls := "index", testedValue(rule.rowIndex))
            case None       => td(cls := "failure", "no match")
          ,
          outputCells(outputKeys, isMain, maybeRule),
          errorCell(error)
        )

  private def outputCells(
      outputKeys: Seq[String],
      isMain: Boolean,
      maybeRule: Option[MatchedRule]
  ): Seq[HtmlElement] =
    maybeRule match
      case None => outputKeys.map(_ => td("-"))
      case Some(rule) if isMain =>
        outputKeys.map: key =>
          td(
            rule.outputs
              .collectFirst { case (k, v) if k == key => testedValue(v) }
              .getOrElse(span("-"))
          )
      case Some(rule) =>
        // a required decision has its own outputs - show them as they are
        Seq(
          td(
            colSpan := math.max(outputKeys.size, 1),
            cls := "notTested",
            rule.outputs.map((k, v) => s"$k: ${v.value}").mkString(" | ")
          )
        )

  private def testedValue(value: TestedValue): HtmlElement =
    value match
      case TestSuccess(v)      => span(cls := "success", v)
      case NotTested(v)        => span(cls := "notTested", v)
      case TestFailure(v, msg) => span(cls := "failure", title := msg, v)

  /** "these outputs are correct" - persists them as the expected values. */
  private def acceptRow(
      groupPath: String,
      result: DmnEvalResult,
      accepted: Var[Set[Int]]
  ): HtmlElement =
    div(
      cls := "row",
      marginTop := "0.75rem",
      button(
        cls := "btn",
        tpe := "button",
        Icons.check,
        child.text <-- accepted.signal.map(rows => s"Save ${rows.size} Test Case(s)"),
        disabled <-- accepted.signal.map(_.isEmpty),
        onClick --> (_ => AppState.saveTestCases(groupPath, result, accepted.now()))
      ),
      span(
        cls := "muted",
        "the checked rows become the expected outputs in " +
          (if groupPath.isEmpty then "" else s"$groupPath/") +
          result.dmnTables.dmnConfig.dmnConfigPathStr
      )
    )

  private def statusBadge(status: EvalStatus): HtmlElement =
    span(cls := s"badge $status", status.toString)

  private def cellText(text: String): String =
    if text == null || text.trim.isEmpty then "-" else text

  // `table` is shadowed by the DmnTable parameters above
  private def table_ = table
end ResultsView
