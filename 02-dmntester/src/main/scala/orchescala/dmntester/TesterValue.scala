package orchescala.dmntester

import io.circe.generic.semiauto.*
import io.circe.{Decoder, Encoder}
import orchescala.dmntester.conversions.*

import java.time.*
import java.util.Date
import scala.language.implicitConversions

sealed trait TesterValue:
  def valueStr: String
  def valueType: String
  def value: Any

object TesterValue:

  def fromAny(value: Any): TesterValue =
    value match
      case b: Boolean       => BooleanValue(b)
      case n: Int           => NumberValue(n)
      case n: Long          => NumberValue(n)
      case n: Float         => NumberValue(n.toDouble)
      case n: Double        => NumberValue(n)
      case n: BigDecimal    => NumberValue(n)
      case d: LocalDateTime => DateValue(d)
      case d: Date          =>
        DateValue(
          Instant
            .ofEpochMilli(d.getTime)
            .atZone(ZoneId.systemDefault())
            .toLocalDateTime
        )
      case s: String if s == NullValue.constant   => NullValue
      case s: String if s.trim.matches(dateRegex) => DateValue(s)
      case s: String                              => StringValue(s)
      case o if o == null                         => NullValue
      case e: scala.reflect.Enum                  => StringValue(e.toString)
      case m: Map[?, ?]                           =>
        ObjectValue(m.map((k, v) => k.toString -> fromAny(v)).toMap)
      case Some(v)                                => fromAny(v)
      case None                                   => NullValue
      case i: Iterable[?]                         =>
        throw new IllegalArgumentException(
          s"Collections are not supported as DMN Input value: $i"
        )
      // a case class - the DMN addresses its fields (e.g. `myObject.myField`)
      case p: Product                             =>
        ObjectValue(
          p.productElementNames
            .zip(p.productIterator)
            .map((key, value) => key -> fromAny(value))
            .toMap
        )
      case o                                      =>
        throw new IllegalArgumentException(
          s"Not expected value type: ${o.getClass} ($o)"
        )

  def fromString(value: String): TesterValue =
    value match
      case "null"                           => NullValue
      case NullValue.constant               => NullValue
      case "true"                           => BooleanValue(true)
      case "false"                          => BooleanValue(false)
      case s if s.trim.matches(longRegex)   => NumberValue(s.trim.toLong)
      case s if s.trim.matches(doubleRegex) => NumberValue(s.trim.toDouble)
      case s if s.trim.matches(dateRegex)   => DateValue(s)
      case s                                => StringValue(s)

  def valueMap(inputs: Map[String, String]): Map[String, TesterValue] =
    inputs.view.mapValues(fromString).toMap

  case class StringValue(value: String) extends TesterValue:
    val valueStr: String = value
    val valueType: String = "String"

  case class BooleanValue(value: Boolean) extends TesterValue:
    val valueStr: String = value.toString
    val valueType: String = "Boolean"

  object BooleanValue:
    def apply(strValue: String): BooleanValue = BooleanValue(strValue == "true")

  case class NumberValue(value: BigDecimal) extends TesterValue:
    val valueStr: String = value.toString
    val valueType: String = "Number"

  object NumberValue:
    def apply(strValue: String): NumberValue = NumberValue(BigDecimal(strValue))
    def apply(intValue: Int): NumberValue = NumberValue(BigDecimal(intValue))
    def apply(longValue: Long): NumberValue = NumberValue(BigDecimal(longValue))
    def apply(doubleValue: Double): NumberValue =
      NumberValue(BigDecimal(doubleValue))

  lazy val datePattern = "yyyy-MM-dd'T'HH:mm:ss"
  lazy val dateFormat: format.DateTimeFormatter =
    format.DateTimeFormatter.ofPattern(datePattern)

  case class DateValue(value: LocalDateTime) extends TesterValue:
    val valueStr: String = dateFormat.format(value)
    val valueType: String = "Date"

  object DateValue:
    /** `dateRegex` allows the seconds to be omitted (`2021-12-23T00:00`), the
      * pattern above does not - so fall back to the ISO parser, which reads
      * both. Rendering always keeps the full `datePattern`.
      */
    def apply(dateStr: String): DateValue =
      DateValue(
        try LocalDateTime.parse(dateStr.trim, dateFormat)
        catch
          case _: format.DateTimeParseException =>
            LocalDateTime.parse(dateStr.trim)
      )

  /** An Input that is an object - the DMN input expression addresses its
    * fields, e.g. `selectedFond.percentage`:
    * {{{ In(SelectedFond(id = 11393215, percentage = 50)) }}}
    *
    * The DMN engine gets it as a `Map[String, Any]`, which FEEL evaluates as a
    * Context.
    */
  case class ObjectValue(fields: Map[String, TesterValue]) extends TesterValue:
    lazy val value: Any = fields.view.mapValues(_.value).toMap
    // sorted by key - a Map has no order, and HOCON renders sorted as well
    lazy val valueStr: String =
      fields.toSeq
        .sortBy(_._1)
        .map((key, value) => s"$key: ${value.valueStr}")
        .mkString("{", ", ", "}")
    val valueType: String = "Object"

  object ObjectValue:
    def apply(fields: (String, TesterValue)*): ObjectValue =
      ObjectValue(fields.toMap)

  case object NullValue extends TesterValue:
    val valueStr: String = "null"
    val valueType: String = "Null"
    val constant: String = "_NULL_"
    val value: Any = null

  given Decoder[TesterValue] = deriveDecoder
  given Encoder[TesterValue] = deriveEncoder
end TesterValue

case class TestCase(
    inputs: Map[String, TesterValue],
    results: List[TestResult]
):

  def checkIndex(rowIndex: Int): TestedValue =
    if results.exists(_.rowIndex == rowIndex) then TestSuccess(s"$rowIndex")
    else TestFailure(s"There is no Index $rowIndex")

  def checkOut(rowIndex: Int, outputKey: String, value: String): TestedValue =
    results
      .find(_.rowIndex == rowIndex)
      .map(_.checkOut(outputKey, value))
      .getOrElse(TestFailure(s"There is no Output with the Index $rowIndex"))
end TestCase

object TestCase:
  given Decoder[TestCase] = deriveDecoder
  given Encoder[TestCase] = deriveEncoder

case class TestResult(rowIndex: Int, outputs: Map[String, TesterValue]):

  def checkOut(outputKey: String, value: String): TestedValue =
    outputs
      .get(outputKey)
      .map: expected =>
        if expected.valueStr == value then TestSuccess(value)
        else
          TestFailure(
            value,
            s"The output '$outputKey' did not succeed: \n- expected: '${expected.valueStr}'\nactual : '$value'"
          )
      .getOrElse(TestFailure(s"There is no Output with Key '$outputKey'"))
end TestResult

object TestResult:
  given Decoder[TestResult] = deriveDecoder
  given Encoder[TestResult] = deriveEncoder

object conversions:
  val longRegex = """^(-?)(0|([1-9][0-9]*))$"""
  val doubleRegex = """^(-?)(0|([1-9][0-9]*))(\.[0-9]+)?$"""
  val dateRegex =
    """^([0-9]{4})-(1[0-2]|0[1-9])-(3[01]|0[1-9]|[12][0-9])T(2[0-3]|[01][0-9]):([0-5][0-9]):?([0-5][0-9])?$"""

  implicit def stringToTesterValue(x: String): TesterValue =
    if x.trim.matches(dateRegex) then TesterValue.DateValue(x)
    else TesterValue.StringValue(x)

  implicit def intToTesterValue(x: Int): TesterValue =
    TesterValue.NumberValue(BigDecimal(x))

  implicit def longToTesterValue(x: Long): TesterValue =
    TesterValue.NumberValue(BigDecimal(x))

  implicit def doubleToTesterValue(x: Double): TesterValue =
    TesterValue.NumberValue(BigDecimal(x))

  implicit def booleanToTesterValue(x: Boolean): TesterValue =
    TesterValue.BooleanValue(x)
end conversions
