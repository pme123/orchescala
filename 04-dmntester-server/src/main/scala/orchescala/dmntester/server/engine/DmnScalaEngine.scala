package orchescala.dmntester.server.engine

import orchescala.dmntester.*
import org.camunda.dmn.Audit.*
import org.camunda.dmn.DmnEngine
import org.camunda.dmn.DmnEngine.EvalContext
import org.camunda.dmn.parser.*
import org.camunda.feel.syntaxtree.{Val, ValError}
import org.camunda.feel.valuemapper.ValueMapper

import java.io.InputStream

/** The ONLY [[DmnEvalEngine]] implementation: dmn-scala - the DMN engine that
  * is embedded in Camunda 8 (FEEL only, no JUEL / script languages).
  *
  * This is the only place in orchescala that may import `org.camunda.dmn.*` /
  * `org.camunda.feel.*`.
  */
final class DmnScalaEngine(engine: DmnEngine) extends DmnEvalEngine:

  import DmnScalaEngine.*

  override val name: String = engineName

  override def parse(
      dmnXml: InputStream,
      path: String
  ): Either[EvalError, ParsedDmnModel] =
    engine
      .parse(dmnXml)
      .left
      .map(failure => EvalError(failure.message))
      .map(DmnScalaModel.apply)

  override def decisionTables(
      model: ParsedDmnModel,
      decisionId: String,
      testUnit: Boolean
  ): Either[EvalError, Seq[DmnTable]] =
    for
      decision <- pureDecision(model, decisionId, testUnit)
      tables <- decisions(decision).foldLeft(
        Right(Seq.empty): Either[EvalError, Seq[DmnTable]]
      ): (acc, dec) =>
        for
          tables <- acc
          table <- dmnTable(dec)
        yield tables :+ table
    yield tables

  override def evalRow(
      model: ParsedDmnModel,
      decisionId: String,
      testUnit: Boolean,
      variables: Map[String, Any]
  ): Either[EvalError, Seq[TableRowResult]] =
    for
      parsedDmn <- parsedDmn(model)
      decision <- pureDecision(model, decisionId, testUnit)
      context = EvalContext(parsedDmn, variables, decision)
      // the return value is NOT used - the matched rules are only in the
      // AuditLog that the evaluation fills into the context.
      evaluated = engine.decisionEval.eval(decision, context)
      log = AuditLog(context.dmn, context.auditLog.toList)
      results <- rowResults(decisionId, log, evaluated)
    yield results

  /** If `testUnit` is set: remove all dependent Decisions and Business
    * Knowledge Models - so a table can be tested in isolation.
    */
  private def pureDecision(
      model: ParsedDmnModel,
      decisionId: String,
      testUnit: Boolean
  ): Either[EvalError, ParsedDecision] =
    for
      parsedDmn <- parsedDmn(model)
      decision <- parsedDmn.decisionsById
        .get(decisionId)
        .toRight(
          EvalError(
            s"No decision found with id '$decisionId' - the DMN has: " +
              model.decisionIds.mkString(", ")
          )
        )
    yield
      if testUnit then
        decision.copy(requiredBkms = Seq.empty, requiredDecisions = Seq.empty)
      else decision

  /** the decision itself first, then its required decisions (depth first) */
  private def decisions(decision: ParsedDecision): Seq[ParsedDecision] =
    decision +: decision.requiredDecisions.toSeq.flatMap(decisions)

  private def parsedDmn(model: ParsedDmnModel): Either[EvalError, ParsedDmn] =
    model match
      case DmnScalaModel(parsedDmn) => Right(parsedDmn)
      case other                    =>
        Left(EvalError(s"Not a dmn-scala model: ${other.getClass.getName}"))

  private def dmnTable(decision: ParsedDecision): Either[EvalError, DmnTable] =
    decision.logic match
      case ParsedDecisionTable(inputs, outputs, rules, hitPolicy, aggregation) =>
        val inputCols = inputs.toSeq.map: in =>
          InputColumn(in.name, expressionText(in.expression))
        val outputCols = outputs.toSeq.map: out =>
          OutputColumn(out.name, out.value)
        HitPolicy
          .fromString(hitPolicy.toString)
          .toRight(
            EvalError(
              s"The Hit Policy '$hitPolicy' of '${decision.id}' is not supported " +
                s"(supported: ${HitPolicy.values.mkString(", ")})."
            )
          )
          .map: policy =>
            DmnTable(
              decision.id,
              decision.name,
              policy,
              Option(aggregation).flatMap(a => Aggregator.fromString(a.toString)),
              inputCols,
              outputCols,
              rules.toSeq.zipWithIndex.map:
                case (ParsedRule(id, inputEntries, outputEntries), index) =>
                  DmnRule(
                    index + 1,
                    id,
                    inputCols
                      .map(_.name)
                      .zipAll(inputEntries.toSeq.map(expressionText), "", ""),
                    outputEntries.toSeq.map: (name, expr) =>
                      name -> expressionText(expr)
                  )
            )
      case other =>
        Left(
          EvalError(
            s"'${decision.id}' is not a Decision Table, but a " +
              s"${other.getClass.getSimpleName} - this tester only supports Decision Tables."
          )
        )

  private def rowResults(
      decisionId: String,
      log: AuditLog,
      evaluated: Either[DmnEngine.Failure, Val]
  ): Either[EvalError, Seq[TableRowResult]] =
    val tableResults = log.entries.collect:
      case entry =>
        entry.result match
          case DecisionTableEvaluationResult(inputs, matchedRules, result) =>
            val evaluatedInputs =
              inputs.toSeq.map(in => in.input.name -> unwrap(in.value))
            Some(
              TableRowResult(
                entry.id,
                matchedRules.toSeq.map: rule =>
                  MatchedRuleResult(
                    rule.rule.id,
                    evaluatedInputs,
                    rule.outputs.toSeq.map: out =>
                      out.output.name -> unwrap(out.value)
                  ),
                evalError(result, evaluated)
              )
            )
          case SingleEvaluationResult(result) =>
            Some(TableRowResult(entry.id, Seq.empty, evalError(result, evaluated)))
          case ContextEvaluationResult(_, result) =>
            Some(TableRowResult(entry.id, Seq.empty, evalError(result, evaluated)))
    .flatten

    if tableResults.isEmpty then
      Left(
        evalFailure(evaluated)
          .getOrElse(EvalError(s"No Evaluation Result for '$decisionId'"))
      )
    else
      // the decision under test first, then its required decisions
      val (main, required) = tableResults.partition(_.decisionId == decisionId)
      Right(main ++ required)
  end rowResults

  private def evalError(
      result: Val,
      evaluated: Either[DmnEngine.Failure, Val]
  ): Option[EvalError] =
    result match
      case ValError(msg) => Some(EvalError(msg))
      case _             => evalFailure(evaluated)

  private def evalFailure(
      evaluated: Either[DmnEngine.Failure, Val]
  ): Option[EvalError] =
    evaluated.left.toOption.map(failure => EvalError(failure.message))

  /** dmn-scala 1.11 has no `ParsedExpression#text` any more. */
  private def expressionText(expression: ParsedExpression): String =
    expression match
      case FeelExpression(feelExpression) => feelExpression.text
      case ExpressionFailure(failure)     => failure
      case EmptyExpression                => ""
      case other                          => other.toString

  private def unwrap(value: Val): String =
    ValueMapper.defaultValueMapper.unpackVal(value) match
      case Some(seq: Seq[?]) => seq.mkString("[", ", ", "]")
      case Some(value)       => String.valueOf(value)
      case None              => "NO VALUE"
      case value             => String.valueOf(value)

  private case class DmnScalaModel(parsedDmn: ParsedDmn) extends ParsedDmnModel:
    lazy val decisionIds: Seq[String] = parsedDmn.decisionsById.keys.toSeq
end DmnScalaEngine

object DmnScalaEngine:

  def apply(): DmnScalaEngine = new DmnScalaEngine(new DmnEngine())

  /** taken from the jars, so it cannot drift away from `Dependencies.scala`. */
  lazy val engineName: String =
    val dmnVersion = implementationVersion(classOf[DmnEngine], "1.11.0")
    val feelVersion = implementationVersion(classOf[ValError], "1.20.0")
    s"dmn-scala $dmnVersion (feel-scala $feelVersion) - Camunda 8 semantics"

  private def implementationVersion(clazz: Class[?], fallback: String): String =
    Option(clazz.getPackage)
      .flatMap(p => Option(p.getImplementationVersion))
      .getOrElse(fallback)
end DmnScalaEngine
