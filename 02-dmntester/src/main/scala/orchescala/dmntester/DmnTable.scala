package orchescala.dmntester

import io.circe.generic.semiauto.{deriveDecoder, deriveEncoder}
import io.circe.{Decoder, Encoder}

/** The parsed DMN of a [[DmnConfig]] - the main decision table and, if the
  * decision has required decisions (`testUnit = false`), those tables as well.
  */
case class AllDmnTables(
    dmnConfig: DmnConfig,
    tables: Seq[DmnTable],
    // which of the config's DMNs was evaluated - e.g. "c7" or "c8"
    source: Option[String] = None,
    // the path of that DMN
    dmnPath: List[String] = List.empty
):
  lazy val dmnPathStr: String =
    dmnPath.map(_.trim).filter(_.nonEmpty).mkString("/")

  lazy val mainTable: DmnTable = tables.head
  lazy val requiredTables: Seq[DmnTable] = tables.tail
  lazy val hasRequiredTables: Boolean = requiredTables.nonEmpty

  def isMainTable(decisionId: String): Boolean =
    mainTable.decisionId == decisionId

  def table(decisionId: String): Option[DmnTable] =
    tables.find(_.decisionId == decisionId)
end AllDmnTables

object AllDmnTables:
  given Decoder[AllDmnTables] = deriveDecoder
  given Encoder[AllDmnTables] = deriveEncoder

case class DmnTable(
    decisionId: String,
    name: String,
    hitPolicy: HitPolicy,
    aggregation: Option[Aggregator],
    inputCols: Seq[InputColumn],
    outputCols: Seq[OutputColumn],
    ruleRows: Seq[DmnRule]
)

object DmnTable:
  given Decoder[DmnTable] = deriveDecoder
  given Encoder[DmnTable] = deriveEncoder

case class InputColumn(
    name: String,
    feelExprText: String
)

object InputColumn:
  given Decoder[InputColumn] = deriveDecoder
  given Encoder[InputColumn] = deriveEncoder

case class OutputColumn(
    name: String,
    value: Option[String]
)

object OutputColumn:
  given Decoder[OutputColumn] = deriveDecoder
  given Encoder[OutputColumn] = deriveEncoder

case class DmnRule(
    index: Int,
    ruleId: String,
    inputs: Seq[(String, String)],
    outputs: Seq[(String, String)]
)

object DmnRule:
  given Decoder[DmnRule] = deriveDecoder
  given Encoder[DmnRule] = deriveEncoder

sealed trait HitPolicy:
  def isSingle: Boolean

object HitPolicy:

  case object UNIQUE extends HitPolicy:
    val isSingle = true

  case object FIRST extends HitPolicy:
    val isSingle = true

  case object ANY extends HitPolicy:
    val isSingle = true

  case object COLLECT extends HitPolicy:
    val isSingle = false

  val values: Seq[HitPolicy] = Seq(UNIQUE, FIRST, ANY, COLLECT)

  /** FEEL-only tester: only these four hit policies are supported. */
  def fromString(value: String): Option[HitPolicy] =
    values.find(_.toString == value.trim.toUpperCase)

  def apply(value: String): HitPolicy =
    fromString(value).getOrElse(
      throw new IllegalArgumentException(s"Unsupported HitPolicy: $value")
    )

  given Decoder[HitPolicy] = deriveDecoder
  given Encoder[HitPolicy] = deriveEncoder
end HitPolicy

sealed trait Aggregator

object Aggregator:

  case object SUM extends Aggregator
  case object COUNT extends Aggregator
  case object MIN extends Aggregator
  case object MAX extends Aggregator

  val values: Seq[Aggregator] = Seq(SUM, COUNT, MIN, MAX)

  def fromString(value: String): Option[Aggregator] =
    values.find(_.toString == value.trim.toUpperCase)

  def apply(value: String): Aggregator =
    fromString(value).getOrElse(
      throw new IllegalArgumentException(s"Unsupported Aggregator: $value")
    )

  given Decoder[Aggregator] = deriveDecoder
  given Encoder[Aggregator] = deriveEncoder
end Aggregator
