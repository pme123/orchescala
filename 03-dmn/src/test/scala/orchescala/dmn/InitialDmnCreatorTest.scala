package orchescala.dmn

import munit.FunSuite
import orchescala.domain.*

/** The DMN of a decision is in its domain object - this locks WHAT is taken
  * from there (see [[InitialDmnCreator]]).
  */
class InitialDmnCreatorTest extends FunSuite:

  enum DocType:
    case contract, invoice

  object DocType:
    given ApiSchema[DocType] = deriveApiSchema
    given InOutCodec[DocType] = deriveInOutCodec

  /** one value as result -> ONE output column, UNIQUE */
  object SingleEntryDmn extends BpmnDecisionDsl:
    val decisionId = "acme-single-entry"
    val descr = "one value"
    case class In(docId: String = "Contract", amount: Int = 12, isValid: Boolean = true)
    object In:
      given ApiSchema[In] = deriveApiSchema
      given InOutCodec[In] = deriveInOutCodec
    lazy val example = singleEntry(In(), "the result")

  /** a case class as result -> one output column per field */
  object SingleResultDmn extends BpmnDecisionDsl:
    val decisionId = "acme-single-result"
    val descr = "many values"
    case class In(docType: DocType = DocType.contract, price: Double = 4.2)
    object In:
      given ApiSchema[In] = deriveApiSchema
      given InOutCodec[In] = deriveInOutCodec
    case class Out(group: String = "management", level: Long = 3L)
    object Out:
      given ApiSchema[Out] = deriveApiSchema
      given InOutCodec[Out] = deriveInOutCodec
    lazy val example = singleResult(In(), Out())

  /** a Seq as result -> more than one rule may match -> COLLECT */
  object CollectEntriesDmn extends BpmnDecisionDsl:
    val decisionId = "acme-collect-entries"
    val descr = "many results"
    case class In(
        docId: String = "Contract",
        // a variable is no column - it is used in the expressions of the DMN
        user: DmnVariable[String] = DmnVariable("me")
    )
    object In:
      given ApiSchema[In] = deriveApiSchema
      given InOutCodec[In] = deriveInOutCodec
    lazy val example = collectEntries(In(), CollectEntries(Seq("management")))

  private def c7(dmn: DecisionDmn[?, ?]): String =
    InitialDmnCreator.dmnXml(dmn, DmnFlavor.C7)

  test("the decision is the one of the domain object"):
    val xml = c7(SingleEntryDmn.example)
    assert(xml.contains("""<decision id="acme-single-entry" name="Acme Single Entry"""), xml)
    assert(xml.startsWith("""<?xml version="1.0" encoding="UTF-8"?>"""), xml)

  test("every input of the In is a column - with its type"):
    val xml = c7(SingleEntryDmn.example)
    assert(xml.contains("""<inputExpression id="InputExpression_docId" typeRef="string">"""), xml)
    assert(xml.contains("""<inputExpression id="InputExpression_amount" typeRef="integer">"""), xml)
    assert(
      xml.contains("""<inputExpression id="InputExpression_isValid" typeRef="boolean">"""),
      xml
    )
    assert(xml.contains("<text>docId</text>"), xml)

  test("a DmnVariable is no input column"):
    val xml = c7(CollectEntriesDmn.example)
    assert(xml.contains("""label="docId""""), xml)
    assert(!xml.contains("user"), xml)

  test("a SingleEntry has ONE output column - the example value is the rule"):
    val xml = c7(SingleEntryDmn.example)
    assertEquals("<output ".r.findAllIn(xml).size, 1)
    assert(xml.contains("""name="result" typeRef="string""""), xml)
    assert(xml.contains("""<text>"the result"</text>"""), xml)

  test("a SingleResult has one output column per field of the result"):
    val xml = c7(SingleResultDmn.example)
    assertEquals("<output ".r.findAllIn(xml).size, 2)
    assert(xml.contains("""name="group" typeRef="string""""), xml)
    assert(xml.contains("""name="level" typeRef="long""""), xml)
    // enums and doubles of the In
    assert(xml.contains("""id="InputExpression_docType" typeRef="string""""), xml)
    assert(xml.contains("""id="InputExpression_price" typeRef="double""""), xml)

  test("a Seq as result means COLLECT - a single value UNIQUE"):
    assert(c7(CollectEntriesDmn.example).contains("""hitPolicy="COLLECT""""))
    assert(c7(SingleEntryDmn.example).contains("""hitPolicy="UNIQUE""""))
    assert(c7(SingleResultDmn.example).contains("""hitPolicy="UNIQUE""""))

  test("the one rule matches every input - so the DMN works from the start"):
    val xml = c7(SingleEntryDmn.example)
    assertEquals("<inputEntry ".r.findAllIn(xml).size, 3)
    assertEquals("<text></text>".r.findAllIn(xml).size, 3)

  test("Camunda 7: the decision is deployable - and typed as Camunda 7 does"):
    val xml = c7(SingleResultDmn.example)
    assert(xml.contains("""camunda:historyTimeToLive="180""""), xml)
    assert(xml.contains("""modeler:executionPlatform="Camunda Platform""""), xml)

  test("Camunda 8: numbers are numbers - and no history time to live"):
    val xml = InitialDmnCreator.dmnXml(SingleResultDmn.example, DmnFlavor.C8)
    assert(xml.contains("""name="level" typeRef="number""""), xml)
    assert(xml.contains("""id="InputExpression_price" typeRef="number""""), xml)
    assert(!xml.contains("historyTimeToLive"), xml)
    assert(xml.contains("""modeler:executionPlatform="Camunda Cloud""""), xml)

end InitialDmnCreatorTest
