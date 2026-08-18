package orchescala.dmn

import orchescala.BuildInfo
import orchescala.domain.*

import java.time.*

/** Which platform a created DMN is for - it only changes the flavour of the
  * XML (the type refs and what the Camunda Modeler is told), not the table.
  */
enum DmnFlavor(
    /** the name of the DMN source a created DMN goes to - if the project has
      * named sources (`dmnSources`) and one of them has this name
      */
    val sourceName: String,
    val executionPlatform: String,
    val executionPlatformVersion: String
):
  case C7 extends DmnFlavor("c7", "Camunda Platform", "7.24.0")
  case C8 extends DmnFlavor("c8", "Camunda Cloud", "8.8.0")
end DmnFlavor

/** Creates the DMN of a decision from its domain object.
  *
  * Everything a DMN table needs is already described in the `DecisionDmn`:
  *
  *   - the `In` are the input columns - with the types of the example values
  *     (a `DmnVariable` is no column - it is a variable of the expressions).
  *   - the `Out` are the output columns - ONE for `SingleEntry` /
  *     `CollectEntries`, one per field for `SingleResult` / `ResultList`.
  *   - a `Seq` in the `Out` means more than one rule may match - so the hit
  *     policy is COLLECT, otherwise UNIQUE.
  *
  * The result is a valid, evaluatable DMN with ONE rule that matches every
  * input and returns the example output - so you start from a table that
  * works, in the DMN Tester as well as in the Camunda Modeler.
  */
object InitialDmnCreator:

  def dmnXml(decisionDmn: DecisionDmn[?, ?], flavor: DmnFlavor): String =
    val decisionId = decisionDmn.decisionDefinitionKey
    val outputs    = outputColumns(decisionDmn.out, flavor)
    if outputs.isEmpty then
      throw IllegalArgumentException(
        s"There is no output to create a DMN for '$decisionId' - the Out of " +
          s"the decision (${decisionDmn.out.getClass.getSimpleName}) has no fields."
      )
    definitions(
      decisionId = decisionId,
      name = decisionDmn.inOutDescr.niceName,
      inputs = inputColumns(decisionDmn.in, flavor),
      outputs = outputs,
      hitPolicy = if isCollect(decisionDmn.out) then "COLLECT" else "UNIQUE",
      flavor = flavor
    )
  end dmnXml

  /** ONE column of the decision table - with the type and the example value of
    * the domain object.
    */
  private case class Col(key: String, typeRef: String, feelValue: String)

  private def definitions(
      decisionId: String,
      name: String,
      inputs: Seq[Col],
      outputs: Seq[Col],
      hitPolicy: String,
      flavor: DmnFlavor
  ): String =
    val id = xmlId(decisionId)
    // Camunda 7 only deploys a decision that says how long its history is kept
    val historyTimeToLive =
      if flavor == DmnFlavor.C7 then " camunda:historyTimeToLive=\"180\"" else ""
    val lines =
      Seq(
        """<?xml version="1.0" encoding="UTF-8"?>""",
        """<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/"""",
        """             xmlns:dmndi="https://www.omg.org/spec/DMN/20191111/DMNDI/"""",
        """             xmlns:dc="http://www.omg.org/spec/DMN/20180521/DC/"""",
        """             xmlns:camunda="http://camunda.org/schema/1.0/dmn"""",
        """             xmlns:modeler="http://camunda.org/schema/modeler/1.0"""",
        s"""             id="Definitions_$id"""",
        s"""             name="${attr(name)}"""",
        """             namespace="http://camunda.org/schema/1.0/dmn"""",
        """             exporter="orchescala"""",
        s"""             exporterVersion="${attr(BuildInfo.version)}"""",
        s"""             modeler:executionPlatform="${flavor.executionPlatform}"""",
        s"""             modeler:executionPlatformVersion="${flavor.executionPlatformVersion}">""",
        s"""  <decision id="${attr(decisionId)}" name="${attr(name)}"$historyTimeToLive>"""
      ) ++
        Seq(s"""    <decisionTable id="DecisionTable_$id" hitPolicy="$hitPolicy">""") ++
        inputs.flatMap(inputColumn) ++
        outputs.map(outputColumn) ++
        Seq(
          """      <rule id="DecisionRule_1">""",
          "        <description>created from the domain object - adjust the rules</description>"
        ) ++
        // an empty input entry matches every value - so the rule is the
        // starting point: everything decides for the example output
        inputs.flatMap(in => entry("inputEntry", s"UnaryTests_${xmlId(in.key)}", "")) ++
        outputs.flatMap(out =>
          entry("outputEntry", s"LiteralExpression_${xmlId(out.key)}", out.feelValue)
        ) ++
        Seq(
          "      </rule>",
          "    </decisionTable>",
          "  </decision>",
          "  <dmndi:DMNDI>",
          s"""    <dmndi:DMNDiagram id="DMNDiagram_$id">""",
          s"""      <dmndi:DMNShape id="DMNShape_$id" dmnElementRef="${attr(decisionId)}">""",
          """        <dc:Bounds height="80" width="180" x="160" y="100" />""",
          "      </dmndi:DMNShape>",
          "    </dmndi:DMNDiagram>",
          "  </dmndi:DMNDI>",
          "</definitions>"
        )
    lines.mkString("", "\n", "\n")
  end definitions

  private def inputColumn(col: Col): Seq[String] =
    val id = xmlId(col.key)
    Seq(
      s"""      <input id="Input_$id" label="${attr(col.key)}">""",
      s"""        <inputExpression id="InputExpression_$id" typeRef="${col.typeRef}">""",
      s"""          <text>${text(col.key)}</text>""",
      "        </inputExpression>",
      "      </input>"
    )

  private def outputColumn(col: Col): String =
    s"""      <output id="Output_${xmlId(col.key)}" label="${attr(col.key)}" """ +
      s"""name="${attr(col.key)}" typeRef="${col.typeRef}" />"""

  private def entry(tag: String, id: String, value: String): Seq[String] =
    Seq(
      s"""        <$tag id="$id">""",
      s"""          <text>${text(value)}</text>""",
      s"        </$tag>"
    )

  /** the input columns - a `DmnVariable` is no column, it is a variable the
    * expressions of the DMN use.
    */
  private def inputColumns(in: Product, flavor: DmnFlavor): Seq[Col] =
    fields(in)
      .filterNot((_, value) => value.isInstanceOf[DmnVariable[?]])
      .map((key, value) => toCol(key, value, flavor))

  private def outputColumns(out: Product, flavor: DmnFlavor): Seq[Col] =
    fields(out) match
      case Seq((key, value)) =>
        unwrap(value) match
          // SingleEntry - the value itself is the result
          case v: DmnValueType     => Seq(toCol(key, v, flavor))
          // CollectEntries / ResultList - the head of the example says which
          case values: Iterable[?] =>
            values.headOption.map(unwrap) match
              case Some(v: DmnValueType) => Seq(toCol(key, v, flavor))
              case Some(p: Product)      => fields(p).map((k, v) => toCol(k, v, flavor))
              case _                     => Seq(toCol(key, "", flavor))
          // SingleResult - every field of the result is a column
          case p: Product          => fields(p).map((k, v) => toCol(k, v, flavor))
          case other               => Seq(toCol(key, other, flavor))
      // no wrapper - take the fields as they are
      case many              => many.map((k, v) => toCol(k, v, flavor))

  /** a `Seq` in the output means more than one rule may match */
  private def isCollect(out: Product): Boolean =
    fields(out) match
      case Seq((_, value)) =>
        unwrap(value) match
          case _: DmnValueType => false
          case _: Iterable[?]  => true
          case _               => false
      case _               => false

  private def fields(product: Product): Seq[(String, Any)] =
    product.productElementNames.zip(product.productIterator).toSeq

  private def toCol(key: String, value: Any, flavor: DmnFlavor): Col =
    val unwrapped = unwrap(value)
    Col(key, typeRef(unwrapped, flavor), feelValue(unwrapped))

  private def unwrap(value: Any): Any =
    value match
      case Some(v)           => unwrap(v)
      case v: DmnVariable[?] => unwrap(v.value)
      case v                 => v

  private def typeRef(value: Any, flavor: DmnFlavor): String =
    val isC7 = flavor == DmnFlavor.C7
    value match
      case _: Boolean                         => "boolean"
      case _: (Int | Short)                   => if isC7 then "integer" else "number"
      case _: Long                            => if isC7 then "long" else "number"
      case _: (Double | Float)                => if isC7 then "double" else "number"
      case _: LocalDate                       => "date"
      case _: (LocalDateTime | ZonedDateTime) => if isC7 then "date" else "date and time"
      case _                                  => "string"

  /** the example value of the domain object, as FEEL */
  private def feelValue(value: Any): String =
    value match
      case null | None                              => "null"
      case b: Boolean                               => b.toString
      case _: (Int | Long | Short | Double | Float) => value.toString
      case d: LocalDate                             => s"""date("$d")"""
      case d: (LocalDateTime | ZonedDateTime)       => s"""date and time("$d")"""
      case v                                        =>
        s""""${v.toString.replace("\\", "\\\\").replace("\"", "\\\"")}""""

  /** DMN ids must be XML names - a decision id may have characters that are
    * fine there, but not in an id we derive from it.
    */
  private def xmlId(value: String): String =
    val id = value.replaceAll("[^A-Za-z0-9_-]", "_")
    if id.headOption.exists(c => c.isLetter || c == '_') then id else s"_$id"

  private def text(value: String): String =
    value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

  private def attr(value: String): String =
    text(value).replace("\"", "&quot;")

end InitialDmnCreator
