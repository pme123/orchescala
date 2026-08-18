package orchescala.dmntester

import io.circe.generic.semiauto.{deriveDecoder, deriveEncoder}
import io.circe.{Decoder, Encoder}
import orchescala.dmntester.EvalStatus.INFO

/** The result of testing ONE DmnConfig with ALL input combinations. */
case class DmnEvalResult(
    dmnTables: AllDmnTables,
    inputKeys: Seq[String],
    outputKeys: Seq[String],
    evalResults: Seq[DmnEvalRowResult],
    missingRules: Seq[DmnRule]
):
  def maxEvalStatus: EvalStatus =
    val status = evalResults.map(_.status) ++ missingRules.headOption.map: _ =>
      if dmnTables.dmnConfig.acceptMissingRules then EvalStatus.INFO
      else EvalStatus.WARN
    status.sorted.headOption.getOrElse(INFO)

  /** The rows a user accepted as correct, as `TestCase`s - i.e. the evaluated
    * outputs become the EXPECTED outputs. `rowIndexes` are indexes into
    * [[evalResults]], which is index aligned with
    * `dmnConfig.data.allTesterValues()`.
    *
    * Only the rules of the MAIN table become expectations - the required
    * decisions are an implementation detail of the decision under test.
    */
  def testCases(rowIndexes: Set[Int]): List[TestCase] =
    val allInputs = dmnTables.dmnConfig.data.allTesterValues()
    val mainTable = dmnTables.mainTable
    rowIndexes.toList.sorted.flatMap: rowIndex =>
      for
        row <- evalResults.lift(rowIndex)
        inputs <- allInputs.lift(rowIndex)
        matched <- row.matchedRulesPerTable
          .find(_.isForMainTable(mainTable.decisionId))
        if matched.matchedRules.nonEmpty
      yield TestCase(inputs, matched.matchedRules.map(testResult).toList)

  /** the DmnConfig to persist when the user accepts the given rows */
  def configWithTestCases(rowIndexes: Set[Int]): DmnConfig =
    val dmnConfig = dmnTables.dmnConfig
    dmnConfig.copy(data = dmnConfig.data.copy(testCases = testCases(rowIndexes)))

  /** the rows that are worth accepting: a rule matched and nothing failed */
  lazy val correctRowIndexes: Set[Int] =
    evalResults.zipWithIndex.collect:
      case (row, index) if row.status == INFO && !row.hasNoMatch => index
    .toSet

  private def testResult(matchedRule: MatchedRule): TestResult =
    TestResult(
      // the index of the rule in the table - NOT the (possibly failed)
      // comparison with an already configured test case
      dmnTables.mainTable.ruleRows
        .find(_.ruleId == matchedRule.ruleId)
        .map(_.index)
        .getOrElse(matchedRule.rowIndex.intValue),
      matchedRule.outputs.map: (key, value) =>
        key -> TesterValue.fromString(value.value)
      .toMap
    )
end DmnEvalResult

object DmnEvalResult:
  given Decoder[DmnEvalResult] = deriveDecoder
  given Encoder[DmnEvalResult] = deriveEncoder

  /** the result of a test run: one entry per DmnConfig - in the implicit scope
    * of `Either[EvalException, DmnEvalResult]`, so no import is needed.
    */
  given Decoder[Either[HandledTesterException.EvalException, DmnEvalResult]] =
    Decoder.decodeEither("Left", "Right")
  given Encoder[Either[HandledTesterException.EvalException, DmnEvalResult]] =
    Encoder.encodeEither("Left", "Right")

/** The result of ONE input row - one entry per evaluated table. */
case class DmnEvalRowResult(
    status: EvalStatus,
    testInputs: Map[String, String],
    matchedRulesPerTable: Seq[MatchedRulesPerTable],
    maybeError: Option[EvalError]
):
  lazy val hasNoMatch: Boolean =
    matchedRulesPerTable.flatMap(_.matchedRules).isEmpty

object DmnEvalRowResult:
  given Decoder[DmnEvalRowResult] = deriveDecoder
  given Encoder[DmnEvalRowResult] = deriveEncoder

case class EvalResult(
    status: EvalStatus,
    matchedRules: Seq[MatchedRulesPerTable],
    failed: Option[EvalError]
)

object EvalResult:

  import EvalStatus.*

  def apply(matchedRulesPerTable: Seq[MatchedRulesPerTable]): EvalResult =
    val matchedRules = matchedRulesPerTable.flatMap(_.matchedRules)
    val maybeError = matchedRulesPerTable.find(_.hasError).flatMap(_.maybeError)
    val status =
      if matchedRulesPerTable.exists(_.hasError) then ERROR
      else if matchedRules.isEmpty then WARN
      else INFO
    EvalResult(status, matchedRulesPerTable, maybeError)

  given Decoder[EvalResult] = deriveDecoder
  given Encoder[EvalResult] = deriveEncoder
end EvalResult

case class MatchedRulesPerTable(
    decisionId: String,
    matchedRules: Seq[MatchedRule],
    maybeError: Option[EvalError]
):
  def hasError: Boolean = maybeError.nonEmpty || matchedRules.exists(_.hasError)

  def isForMainTable(decId: String): Boolean = decId == decisionId

  lazy val inputKeys: Seq[String] =
    matchedRules.headOption.toSeq.flatMap(_.inputs).map(_._1)

  lazy val outputKeys: Seq[String] =
    matchedRules.headOption.toSeq.flatMap(_.outputs).map(_._1)
end MatchedRulesPerTable

object MatchedRulesPerTable:
  given Decoder[MatchedRulesPerTable] = deriveDecoder
  given Encoder[MatchedRulesPerTable] = deriveEncoder

case class MatchedRule(
    ruleId: String,
    rowIndex: TestedValue,
    inputs: Seq[(String, String)],
    outputs: Seq[(String, TestedValue)]
):
  def hasError: Boolean = rowIndex.isError || outputs.exists(_._2.isError)

object MatchedRule:
  given Decoder[MatchedRule] = deriveDecoder
  given Encoder[MatchedRule] = deriveEncoder

sealed trait TestedValue:
  def value: String
  def isError: Boolean = false
  lazy val intValue: Int = value.toIntOption.getOrElse(-1)

case class NotTested(value: String) extends TestedValue

case class TestSuccess(value: String) extends TestedValue

object TestedValue:
  given Decoder[TestedValue] = deriveDecoder
  given Encoder[TestedValue] = deriveEncoder

case class TestFailure(value: String, msg: String) extends TestedValue:
  override def isError = true

object TestFailure:
  def apply(msg: String): TestFailure = TestFailure(msg, msg)

  given Decoder[TestFailure] = deriveDecoder
  given Encoder[TestFailure] = deriveEncoder

case class EvalError(msg: String)

object EvalError:
  given Decoder[EvalError] = deriveDecoder
  given Encoder[EvalError] = deriveEncoder

sealed trait EvalStatus extends Comparable[EvalStatus]:
  def order: Int
  override def compareTo(o: EvalStatus): Int = order.compareTo(o.order)

object EvalStatus:

  case object INFO extends EvalStatus:
    val order = 3

  case object WARN extends EvalStatus:
    val order = 2

  case object ERROR extends EvalStatus:
    val order = 1

  val values: Seq[EvalStatus] = Seq(ERROR, WARN, INFO)

  given Ordering[EvalStatus] = Ordering.by(_.order)

  given Decoder[EvalStatus] = deriveDecoder
  given Encoder[EvalStatus] = deriveEncoder
end EvalStatus
