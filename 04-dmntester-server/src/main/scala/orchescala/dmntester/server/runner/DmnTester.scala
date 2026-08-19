package orchescala.dmntester.server.runner

import orchescala.dmntester.*
import orchescala.dmntester.HandledTesterException.EvalException
import orchescala.dmntester.server.engine.{DmnEvalEngine, ParsedDmnModel}
import zio.{IO, ZIO}

import java.io.InputStream

/** Parses the DMN of a [[DmnConfig]] and tests its decision table(s). */
case class DmnTester(dmnConfig: DmnConfig, engine: DmnEvalEngine):

  private val decisionId = dmnConfig.decisionId
  private val dmnPath = dmnConfig.allDmnPaths.head._2

  /** one result per DMN the configuration references (e.g. c7 and c8) */
  def runAll(): IO[EvalException, Seq[DmnEvalResult]] =
    ZIO.foreach(dmnConfig.allDmnPaths)(run)

  def run(): IO[EvalException, DmnEvalResult] =
    run(dmnConfig.allDmnPaths.head)

  def run(
      source: (Option[String], List[String])
  ): IO[EvalException, DmnEvalResult] =
    val (name, path) = source
    for
      _ <- printLine(
        s"Testing $decisionId${name.map(n => s" [$n]").getOrElse("")}: " +
          s"${dmnConfig.dmnPathStr(path)}"
      )
      model <- parsedDmn(path)
      result <- DmnTableEngine(engine, model, dmnConfig).evalDecision(name, path)
    yield result

  def run(model: ParsedDmnModel): IO[EvalException, DmnEvalResult] =
    DmnTableEngine(engine, model, dmnConfig).evalDecision(None, dmnPath)

  def parsedDmn(): IO[EvalException, ParsedDmnModel] = parsedDmn(dmnPath)

  def parsedDmn(dmnPath: List[String]): IO[EvalException, ParsedDmnModel] =
    ZIO
      .attempt(os.read.inputStream(osPath(dmnPath)))
      .orElseFail(
        EvalException(
          decisionId,
          s"There was no DMN in ${dmnPath.mkString("/")} (${osPath(dmnPath)})."
        )
      )
      .flatMap(is => parsedDmn(is).ensuring(ZIO.succeed(is.close())))

  def parsedDmn(streamToTest: InputStream): IO[EvalException, ParsedDmnModel] =
    ZIO
      .fromEither(engine.parse(streamToTest, dmnPath.mkString("/")))
      .mapError(parseError)

  private def parseError(error: EvalError): EvalException = error match
    // dmn-scala 1.11 / feel-scala 1.20 wording:
    // "FEEL expression: failed to parse expression '': ..."
    case EvalError(msg) if msg.contains("failed to parse expression ''") =>
      EvalException(
        decisionId,
        s"""|ERROR: Could not parse a FEEL expression in the DMN table: $decisionId.
            |Hints:
            |> All outputs need a value.
            |> All Input-/ Output-Columns need an expression.
            |> Did you miss to wrap Strings in " - e.g. "TEXT"?
            |> Check if there is an 'empty' Rule you accidentally created.
            |> Check if all Values are valid FEEL expressions - see https://docs.camunda.io/docs/components/modeler/feel/what-is-feel/
            |
            |Original message: $msg""".stripMargin
      )
    case EvalError(msg) => EvalException(decisionId, msg)

end DmnTester

object DmnTester:

  def testDmnTable(
      dmnConfig: DmnConfig,
      engine: DmnEvalEngine
  ): IO[EvalException, Seq[DmnEvalResult]] =
    printLine(
      s"Start testing ${dmnConfig.decisionId} (testUnit = ${dmnConfig.testUnit}) " +
        s"against ${dmnConfig.allDmnPaths.size} DMN(s)"
    ) *> DmnTester(dmnConfig, engine).runAll()
