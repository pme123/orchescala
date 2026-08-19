package orchescala.dmntester

import io.circe.generic.semiauto.*
import io.circe.{Decoder, Encoder}
import orchescala.dmntester.conversions.*

import java.time.*
import java.util.Date
import scala.language.implicitConversions
import scala.util.Random

/** The test definition of ONE DMN decision - persisted as HOCON (`*.conf`).
  *
  * The JSON shape of this model is the wire format between server and client
  * AND the shape `DmnConfigHandler` reads/writes - do not change it lightly.
  */
case class DmnConfig(
    decisionId: String = "",
    data: TesterData = TesterData(),
    dmnPath: List[String] = List.empty,
    isActive: Boolean = false,
    testUnit: Boolean = true,
    // if you have lots of inputs, and you don't want to cover all of them
    acceptMissingRules: Boolean = false,
    /** The SAME decision in more than one place - e.g. the Camunda 7 DMN and
      * the one migrated to Camunda 8:
      * {{{ dmnPaths { c7 = [src, main, ...], c8 = [c8, src, ...] } }}}
      * One configuration, one set of test cases - the tester runs them against
      * every DMN, so a difference between the versions shows up as a failure.
      */
    dmnPaths: Map[String, List[String]] = Map.empty
):

  /** every DMN this configuration is tested against - the named ones, or the
    * single `dmnPath` of a project with one platform.
    */
  lazy val allDmnPaths: Seq[(Option[String], List[String])] =
    if dmnPaths.nonEmpty then
      dmnPaths.toSeq.sortBy(_._1).map((name, path) => Some(name) -> path)
    else Seq(None -> dmnPath)

  /** Either ONE unnamed DMN (`dmnPath`) or named ones (`dmnPaths`) - never
    * both, so a configuration says a path exactly once.
    */
  def withDmnPaths(paths: Seq[(Option[String], List[String])]): DmnConfig =
    paths.collect { case (Some(name), path) => name -> path } match
      case Nil   =>
        copy(dmnPath = paths.headOption.map(_._2).getOrElse(List.empty), dmnPaths = Map.empty)
      case named =>
        copy(dmnPath = List.empty, dmnPaths = named.toMap)


  lazy val dmnPathStr: String =
    allDmnPaths.headOption.map((_, path) => dmnPathStr(path)).getOrElse("")

  def dmnPathStr(path: List[String]): String =
    path.map(_.trim).filter(_.nonEmpty).mkString("/")

  lazy val dmnConfigPathStr: String =
    s"$decisionId${if testUnit then "" else "-INT"}.conf"

  lazy val inputKeys: Seq[String] = data.inputKeys

  def findTestCase(testInputs: Map[String, Any]): Option[TestCase] =
    data.findTestCase(testInputs)

  lazy val decisionIdError: Option[String] =
    val regex =
      """^(?!xml|Xml|xMl|xmL|XMl|xML|XmL|XML)[A-Za-z_][A-Za-z0-9-_.]*$""".r
    if regex.matches(decisionId) then None
    else Some(s"This must be a correct XML identifier (regex: $regex)")

  lazy val dmnPathError: Option[String] =
    val regex = """^([^\\/?%*:|"<>.])+(/[^\\/?%*:|"<>.]+)*\.dmn$""".r
    allDmnPaths
      .map((name, path) => name -> dmnPathStr(path))
      .collectFirst:
        case (name, path) if !regex.matches(path) =>
          s"${name.map(n => s"[$n] ").getOrElse("")}This must be a correct Path " +
            s"e.g 'myDmns/countryTable.dmn' (regex: $regex)"

  lazy val hasErrors: Boolean =
    decisionIdError.nonEmpty || dmnPathError.nonEmpty
end DmnConfig

object DmnConfig:
  given Decoder[DmnConfig] = deriveDecoder
  given Encoder[DmnConfig] = deriveEncoder

case class TesterData(
    inputs: List[TesterInput] = List.empty,
    // simple input-, output-variables used in the DMN
    variables: List[TesterInput] = List.empty,
    testCases: List[TestCase] = List.empty
):

  lazy val inputKeys: Seq[String] = inputs.map(_.key)

  /** every combination of every input value - one DMN evaluation per entry */
  def allInputs(): List[Map[String, Any]] =
    cartesianProduct((inputs ++ variables).map(_.asValues())).map(_.toMap)

  /** the SAME combinations as [[allInputs]], as `TesterValue`s and in the same
    * order - so an evaluated row can be turned back into a `TestCase`.
    */
  def allTesterValues(): List[Map[String, TesterValue]] =
    cartesianProduct((inputs ++ variables).map(_.asTesterValues())).map(_.toMap)

  /** this creates all variations of the inputs you provide */
  private def cartesianProduct[A](
      xss: List[(String, List[A])]
  ): List[List[(String, A)]] =
    xss match
      case Nil           => List(Nil)
      case (key, v) :: t =>
        for xh <- v; xt <- cartesianProduct(t) yield (key -> xh) :: xt

  def findTestCase(testInputs: Map[String, Any]): Option[TestCase] =
    testCases.find: testCase =>
      testCase.inputs.view.mapValues(_.value).toMap == testInputs
end TesterData

object TesterData:
  given Decoder[TesterData] = deriveDecoder
  given Encoder[TesterData] = deriveEncoder

case class TesterInput(
    key: String,
    nullValue: Boolean,
    values: List[TesterValue],
    id: Option[Int]
):

  val valuesAsString: String = values.map(_.valueStr).mkString(", ")

  lazy val withId: TesterInput =
    if id.isEmpty then copy(id = Some(Random.nextInt(100000))) else this

  def valueType: String = values
    .map(_.valueType)
    .foldLeft(values.headOption.map(_.valueType).getOrElse("String")): (r, tpe) =>
      if r == tpe then r else "String"

  /** the configured values, plus `null` if `nullValue` is set */
  def asTesterValues(): (String, List[TesterValue]) =
    key -> (values ++ (if nullValue then List(TesterValue.NullValue) else Nil))

  /** the values as the DMN engine gets them */
  def asValues(): (String, List[Any]) =
    key -> asTesterValues()._2.map(_.value)

  lazy val keyError: Option[String] =
    val regex = """^[A-Za-z_][A-Za-z0-9-_.]*$""".r
    if regex.matches(key) then None
    else Some(s"This must be a correct key - e.g. 'contractId' (regex: $regex)")

  lazy val valuesError: Option[String] =
    if valuesAsString.trim.nonEmpty then None
    else Some("Values are required. Examples: '1,2,3', 'hello', 'true, false'")

  lazy val hasErrors: Boolean = keyError.nonEmpty || valuesError.nonEmpty
end TesterInput

object TesterInput:
  def apply(
      key: String = "",
      nullValue: Boolean = false,
      values: List[TesterValue] = List.empty
  ): TesterInput =
    TesterInput(key, nullValue, values, id = Some(Random.nextInt(100000)))

  def unapply(
      input: TesterInput
  ): Option[(String, Boolean, List[TesterValue])] =
    Some((input.key, input.nullValue, input.values))

  given Decoder[TesterInput] = deriveDecoder
  given Encoder[TesterInput] = deriveEncoder
end TesterInput

/** The `*.conf` files of ONE directory below the configured config path.
  *
  * A project can keep the DMNs of several platforms next to each other - e.g.
  * `dmnConfigs/c7` and `dmnConfigs/c8` - and test them with ONE tester.
  */
case class DmnConfigGroup(
    // relative to the config path - empty for the config path itself
    path: String,
    configs: Seq[DmnConfig]
):
  lazy val name: String = if path.isEmpty then "/" else path

object DmnConfigGroup:
  given Decoder[DmnConfigGroup] = deriveDecoder
  given Encoder[DmnConfigGroup] = deriveEncoder
