package orchescala.dmn

import orchescala.domain.*
import orchescala.dmntester.*

import java.time.LocalDateTime
import scala.reflect.ClassTag
import scala.reflect.Selectable.reflectiveSelectable

/** The DSL to describe WHAT shall be tested:
  *
  * {{{
  * DocumentInfoDmn.example.testUnit
  *   .testValues(_.docId, "Basisvertrag", "QR-Rechnung")
  *   .acceptMissingRules
  * }}}
  *
  * Pure - it only turns `DecisionDmn`s into `DmnConfig`s. Writing them and
  * starting the tester is the job of `orchescala-dmntester-server`.
  */
trait DmnTesterDsl:

  /** the path where the DMN of a decision lives - `source` selects one of the
    * named DMN sources of the project (e.g. "c7" / "c8")
    */
  protected def dmnPathOf(dmnName: String, source: Option[String]): os.Path

  /** paths in a DmnConfig are relative to the project */
  protected def projectBasePath: os.Path = os.pwd

  given [In <: Product]: Conversion[DecisionDmn[In, ?], DmnTesterObject[In]] =
    decisionDmn => DmnTesterObject(decisionDmn)

  protected def dmnConfigs(
      dmnTesterObjects: Seq[DmnTesterObject[?]]
  ): Seq[DmnConfig] =
    dmnTesterObjects
      .filterNot(_._inTestMode)
      .map { dmnTO =>
        val dmn = dmnTO.dDmn
        val in: Product = dmn.in
        val inputs = toInputs(in, dmnTO)
        val variables = toVariables(in)
        DmnConfig(
          dmn.decisionDefinitionKey,
          TesterData(inputs, variables),
          dmnTO.dmnPath.relativeTo(projectBasePath).segments.toList,
          testUnit = dmnTO._testUnit,
          acceptMissingRules = dmnTO._acceptMissingRules
        )

      }

  private def toInputs[T <: Product](
      product: T,
      dmnTO: DmnTesterObject[?]
  ) =
    product.productElementNames
      .zip(product.productIterator)
      .collect {
        case (k, v) if !v.isInstanceOf[DmnVariable[?]] =>
          testValues(k, v, dmnTO.addTestValues)
      }
      .toList

  private def testValues[E: ClassTag](
      k: String,
      value: E,
      addTestValues: Map[String, List[TesterValue]]
  ): TesterInput =
    val unwrapValue = value match
      case d: LocalDateTime => d.toString
      case Some(v) => v
      case v => v
    val isNullable = value match
      case Some(_) => true
      case _ => false
    // noinspection ScalaUnnecessaryParentheses
    unwrapValue match
      case v: (Double | Int | Long | Short | String | Float) =>
        TesterInput(
          k,
          isNullable,
          addTestValues.getOrElse(k, List(TesterValue.fromAny(v)))
        )
      case _: Boolean =>
        TesterInput(
          k,
          isNullable,
          List(TesterValue.fromAny(true), toTesterValue(false))
        )
      case v: scala.reflect.Enum =>
        val e: { def values: Array[?] } =
          v.asInstanceOf[{ def values: Array[?] }]
        TesterInput(
          k,
          isNullable,
          addTestValues.getOrElse(k, e.values.map(v => toTesterValue(v)).toList)
        )
      case v =>
        throw new IllegalArgumentException(
          s"Not supported for DMN Input ($k -> $v)"
        )
    end match
  end testValues

  private def toVariables[T <: Product](
      product: T
  ) =
    product.productElementNames
      .zip(product.productIterator)
      .collect { case (k, v: DmnVariable[?]) =>
        val result: DmnValueType = v.value
        testValues(k, result, Map.empty)
      }
      .toList

  case class DmnTesterObject[In <: Product](
      dDmn: DecisionDmn[In, ?],
      // set explicitly with `.dmnPath(...)` - otherwise it is derived from the
      // decision id and the source, lazily: `.from("c8")` may still change it.
      maybeDmnPath: Option[os.Path] = None,
      addTestValues: Map[String, List[TesterValue]] = Map.empty,
      // which named DMN source this table comes from - the configuration is
      // written into the sub directory of the same name
      source: Option[String] = None,
      _testUnit: Boolean = false,
      _acceptMissingRules: Boolean = false,
      _inTestMode: Boolean = false
  ):
    lazy val dmnPath: os.Path =
      maybeDmnPath.getOrElse(dmnPathOf(dDmn.decisionDefinitionKey, source))

    /** the same table, taken from this concrete DMN file */
    def withDmnPath(path: os.Path): DmnTesterObject[In] =
      copy(maybeDmnPath = Some(path))

  private def toTesterValue(value: Any) =
    value match
      // enums not supported in DmnTester 2.13
      case e: scala.reflect.Enum => TesterValue.fromAny(e.toString)
      case v => TesterValue.fromAny(v)

  extension [In <: Product](dmnTO: DmnTesterObject[In])

    def dmnPath(path: os.Path): DmnTesterObject[In] =
      dmnTO.copy(maybeDmnPath = Some(path))

    def dmnPath(dmnName: String): DmnTesterObject[In] =
      dmnTO.copy(maybeDmnPath = Some(dmnPathOf(dmnName, dmnTO.source)))

    /** takes the DMN from the named source of the project and writes the
      * configuration into the sub directory of that name:
      * {{{ DocumentInfoDmn.example.testUnit.from("c8") }}}
      */
    def from(source: String): DmnTesterObject[In] =
      dmnTO.copy(source = Some(source))

    def testUnit: DmnTesterObject[In] =
      dmnTO.copy(_testUnit = true)

    def inTestMode: DmnTesterObject[In] =
      dmnTO.copy(_inTestMode = true)

    def acceptMissingRules: DmnTesterObject[In] =
      dmnTO.copy(_acceptMissingRules = true)

    inline def testValues(
        inline key: In => DmnValueType | Option[DmnValueType],
        values: Any*
    ): DmnTesterObject[In] =
      val testerValues = values
        .map(v => toTesterValue(v.toString))
        .toList
      dmnTO.copy(addTestValues =
        dmnTO.addTestValues + (nameOfVariable(key) -> testerValues)
      )
    end testValues
  end extension
end DmnTesterDsl
