package orchescala.dmntester.server.engine

import orchescala.dmntester.*

import java.io.InputStream

/** The tester's view on a DMN engine (SPI).
  *
  * Everything in these signatures is engine-neutral: only `orchescala.dmntester`
  * and standard types. The concrete engine (see [[DmnScalaEngine]]) is the only
  * place that may import `org.camunda.*`.
  *
  * The tester needs more than `eval(xml, vars)`:
  *   - parse a DMN once and evaluate many input rows against it,
  *   - read the table metadata of the decision AND of its required decisions -
  *     the UI renders the tables from this,
  *   - unit-test mode: evaluate a decision with its required decisions/BKMs
  *     stripped,
  *   - per input row: which rules matched in which table, with which outputs.
  */
trait DmnEvalEngine:

  /** e.g. "dmn-scala 1.11.0 (feel-scala 1.20.0) - Camunda 8 semantics" */
  def name: String

  def parse(
      dmnXml: InputStream,
      path: String
  ): Either[EvalError, ParsedDmnModel]

  /** The main decision table first, then - if `testUnit` is false - the tables
    * of all required decisions.
    */
  def decisionTables(
      model: ParsedDmnModel,
      decisionId: String,
      testUnit: Boolean
  ): Either[EvalError, Seq[DmnTable]]

  /** Evaluate ONE input row - one result per evaluated table. */
  def evalRow(
      model: ParsedDmnModel,
      decisionId: String,
      testUnit: Boolean,
      variables: Map[String, Any]
  ): Either[EvalError, Seq[TableRowResult]]
end DmnEvalEngine

/** Opaque handle - a concrete engine puts its parsed model inside. */
trait ParsedDmnModel:
  def decisionIds: Seq[String]

/** What one table did for one input row - engine-neutral, i.e. WITHOUT the
  * tester's expected-value comparison (that is the tester's job, see
  * `DmnTableEngine`).
  */
case class TableRowResult(
    decisionId: String,
    matchedRules: Seq[MatchedRuleResult],
    maybeError: Option[EvalError]
)

case class MatchedRuleResult(
    ruleId: String,
    inputs: Seq[(String, String)],
    outputs: Seq[(String, String)]
)
