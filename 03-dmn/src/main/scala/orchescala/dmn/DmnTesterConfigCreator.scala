package orchescala
package dmn

import orchescala.domain.*
import pme123.camunda.dmn.tester.shared.*

import java.io.FileNotFoundException
import java.time.LocalDateTime
import scala.language.reflectiveCalls
import scala.reflect.ClassTag

trait DmnTesterConfigCreator extends DmnConfigWriter, DmnTesterStarter:

  // the path where the DMNs are
  protected def dmnBasePath: os.Path                     = starterConfig.dmnPaths.head
  // the path where the DMN Configs are
  protected def dmnConfigPath: os.Path                   = starterConfig.dmnConfigPaths.head
  // creating the Path to the DMN - by default the _dmnName_ is `decisionDmn.decisionDefinitionKey`.
  protected def defaultDmnPath(dmnName: String): os.Path =
    val dmnPath = dmnBasePath / s"${dmnName.replace(s"${starterConfig.companyName}-", "")}.dmn"
    if !dmnPath.toIO.exists() then
      throw FileNotFoundException(s"There is no DMN in $dmnPath")
    dmnPath
  end defaultDmnPath

  protected def createDmnConfigs(dmnTesterObjects: DmnTesterObject[?]*): Unit =
    startDmnTester
    dmnConfigs(dmnTesterObjects)
      .foreach(updateConfig(_, dmnConfigPath))
    println("Check it on http://localhost:8883")
  end createDmnConfigs

  given [In <: Product]: Conversion[DecisionDmn[In, ?], DmnTesterObject[In]] =
    decisionDmn =>
      DmnTesterObject(
        decisionDmn,
        defaultDmnPath(decisionDmn.decisionDefinitionKey)
      )

  private def dmnConfigs(
      dmnTesterObjects: Seq[DmnTesterObject[?]]
  ): Seq[DmnConfig] =
    dmnTesterObjects
      .filterNot(_._inTestMode)
      .map { dmnTO =>
        val dmn         = dmnTO.dDmn
        val in: Product = dmn.in
        val inputs      = toInputs(in, dmnTO)
        val variables   = toVariables(in)
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

  /** ------- JSON helpers for Seq / Map support ------- */
  private def escapeJsonString(s: String): String =
    s.flatMap {
      case '"'              => "\\\""
      case '\\'             => "\\\\"
      case '\b'             => "\\b"
      case '\f'             => "\\f"
      case '\n'             => "\\n"
      case '\r'             => "\\r"
      case '\t'             => "\\t"
      case c if c.isControl => f"\\u${c.toInt}%04x"
      case c                => c.toString
    }

  private def toJson(any: Any): String =
    any match
      case null                                                                  => "null"
      case s: String                                                             => "\"" + escapeJsonString(s) + "\""
      case d: Double if d.isNaN                                                  => "\"NaN\""
      case d: Double if d.isInfinity                                             => if d > 0 then "\"Infinity\"" else "\"-Infinity\""
      case f: Float if f.isNaN                                                   => "\"NaN\""
      case f: Float if f.isInfinity                                              => if f > 0 then "\"Infinity\"" else "\"-Infinity\""
      case n: (Byte | Short | Int | Long | Float | Double | BigInt | BigDecimal) =>
        n.toString
      case b: Boolean                                                            => b.toString
      case dt: LocalDateTime                                                     => "\"" + escapeJsonString(dt.toString) + "\""
      case e: scala.reflect.Enum                                                 => "\"" + escapeJsonString(e.toString) + "\""
      case m: scala.collection.Map[?, ?]                                         =>
        // best effort: JSON object, stringify keys
        m.iterator.map { case (k, v) =>
          val key   = "\"" + escapeJsonString(Option(k).map(_.toString).getOrElse("null")) + "\""
          val value = toJson(v)
          s"$key:$value"
        }.mkString("{", ",", "}")
      case it: Iterable[?]                                                       => it.map(toJson).mkString("[", ",", "]")
      case arr: Array[?]                                                         => arr.iterator.map(toJson).mkString("[", ",", "]")
      case other                                                                 => "\"" + escapeJsonString(other.toString) + "\""

  /** --------------------------------------------------- */

  private def testValues[E: ClassTag](
      k: String,
      value: E,
      addTestValues: Map[String, List[TesterValue]]
  ): TesterInput =
    val unwrapValue = value match
      case d: LocalDateTime => d.toString
      case Some(v)          => v
      case v                => v
    val isNullable  = value match
      case Some(_) => true
      case _       => false

    unwrapValue match
      case v: (Double | Int | Long | Short | String | Float) =>
        TesterInput(
          k,
          isNullable,
          addTestValues.getOrElse(k, List(TesterValue.fromAny(v)))
        )
      case _: Boolean                                        =>
        TesterInput(
          k,
          isNullable,
          List(TesterValue.fromAny(true), toTesterValue(false))
        )
      case v: scala.reflect.Enum                             =>
        val e: { def values: Array[?] } =
          v.asInstanceOf[{ def values: Array[?] }]
        TesterInput(
          k,
          isNullable,
          addTestValues.getOrElse(k, e.values.map(v => toTesterValue(v)).toList)
        )
      // NEW: support Map
      case m: scala.collection.Map[?, ?] =>
        val json = toJson(m)
        TesterInput(
          k,
          isNullable,
          addTestValues.getOrElse(k, List(TesterValue.fromAny(json)))
        )  

      // NEW: support for iterables
      case it: Iterable[?] =>
        val json = toJson(it)
        TesterInput(
          k,
          isNullable,
          addTestValues.getOrElse(k, List(TesterValue.fromAny(json)))
        )
      case arr: Array[?]   =>
        val json = toJson(arr)
        TesterInput(
          k,
          isNullable,
          addTestValues.getOrElse(k, List(TesterValue.fromAny(json)))
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
      dmnPath: os.Path,
      addTestValues: Map[String, List[TesterValue]] = Map.empty,
      _testUnit: Boolean = false,
      _acceptMissingRules: Boolean = false,
      _inTestMode: Boolean = false
  )

  private def toTesterValue(value: Any) =
    value match
      // enums not supported in DmnTester 2.13
      case e: scala.reflect.Enum         => TesterValue.fromAny(e.toString)
      // NEW: pass collections/maps as compact JSON
      case m: scala.collection.Map[?, ?] => TesterValue.fromAny(toJson(m))
      case it: Iterable[?]               => TesterValue.fromAny(toJson(it))
      case arr: Array[?]                 => TesterValue.fromAny(toJson(arr))
      case s: String                     => TesterValue.fromAny(s)
      case v                             => TesterValue.fromAny(v)

  extension [In <: Product](dmnTO: DmnTesterObject[In])

    def dmnPath(path: os.Path): DmnTesterObject[In] =
      dmnTO.copy(dmnPath = path)

    def dmnPath(dmnName: String): DmnTesterObject[In] =
      dmnPath(defaultDmnPath(dmnName))

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
        .map(v => toTesterValue(v)) // <-- keep structure for Seq/Map instead of .toString
        .toList
      dmnTO.copy(addTestValues =
        dmnTO.addTestValues + (nameOfVariable(key) -> testerValues)
      )
    end testValues
  end extension
end DmnTesterConfigCreator
