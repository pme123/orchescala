package orchescala.api

import munit.FunSuite

import scala.xml.XML

class CamundaXmlPrinterTest extends FunSuite:

  test("self-closing tags get a space before />"):
    val xml = XML.loadString("""<camunda:in source="renterClientKey" target="clientKey"/>""")
    assertEquals(
      CamundaXmlPrinter.toCamundaXmlString(xml),
      """<camunda:in source="renterClientKey" target="clientKey" />"""
    )

  test("double quotes in attribute values are encoded as &#34; instead of &quot;"):
    val xml = XML.loadString(
      """<camunda:in sourceExpression="${ (a ? &quot;x&quot; : &quot;-&quot;) }" target="accountCategory"/>"""
    )
    val result = CamundaXmlPrinter.toCamundaXmlString(xml)
    assert(result.contains("&#34;x&#34;"))
    assert(!result.contains("&quot;"))

  test("single quotes in attribute values are encoded as &#39;"):
    val xml = XML.loadString(
      """<camunda:in sourceExpression="${ newAddress.prop('street').stringValue() }" target="accountCategory"/>"""
    )
    val result = CamundaXmlPrinter.toCamundaXmlString(xml)
    assertEquals(
      result,
      """<camunda:in sourceExpression="${ newAddress.prop(&#39;street&#39;).stringValue() }" target="accountCategory" />"""
    )

  test("double quotes in element text content are left untouched"):
    val xml = XML.loadString(
      """<camunda:script scriptFormat="groovy">println("RENTAL PARTY start: ${ rentalParty}")</camunda:script>"""
    )
    assertEquals(
      CamundaXmlPrinter.toCamundaXmlString(xml),
      """<camunda:script scriptFormat="groovy">println("RENTAL PARTY start: ${ rentalParty}")</camunda:script>"""
    )

  test("xmlns attributes are placed before other attributes"):
    val xml = XML.loadString(
      """<bpmn:definitions id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn" exporter="Camunda Modeler" exporterVersion="5.46.1" xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn"/>"""
    )
    assertEquals(
      CamundaXmlPrinter.toCamundaXmlString(xml),
      """<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn" exporter="Camunda Modeler" exporterVersion="5.46.1" />"""
    )

  test("matches Camunda Modeler output for callActivity extension elements"):
    val xml = XML.loadString(
      """<bpmn:extensionElements>
        |<camunda:in source="renterClientKey" target="clientKey"/>
        |<camunda:in sourceExpression="${2080}" target="accountType"/>
        |<camunda:in sourceExpression="CHF" target="accountCurrency"/>
        |<camunda:in sourceExpression="${ newAddress.prop('street').stringValue() }, ${ (newAddress.hasProp('houseNumber') ? (newAddress.prop('houseNumber').stringValue()) : &quot;-&quot;)}, ${ newAddress.prop('postcode').stringValue() }, ${ newAddress.prop('place').stringValue()}" target="accountCategory"/>
        |<camunda:in source="processCallOrigin" target="processCallOrigin"/>
        |</bpmn:extensionElements>""".stripMargin
    )
    val expected =
      """<bpmn:extensionElements>
        |<camunda:in source="renterClientKey" target="clientKey" />
        |<camunda:in sourceExpression="${2080}" target="accountType" />
        |<camunda:in sourceExpression="CHF" target="accountCurrency" />
        |<camunda:in sourceExpression="${ newAddress.prop(&#39;street&#39;).stringValue() }, ${ (newAddress.hasProp(&#39;houseNumber&#39;) ? (newAddress.prop(&#39;houseNumber&#39;).stringValue()) : &#34;-&#34;)}, ${ newAddress.prop(&#39;postcode&#39;).stringValue() }, ${ newAddress.prop(&#39;place&#39;).stringValue()}" target="accountCategory" />
        |<camunda:in source="processCallOrigin" target="processCallOrigin" />
        |</bpmn:extensionElements>""".stripMargin
    assertEquals(CamundaXmlPrinter.toCamundaXmlString(xml), expected)

end CamundaXmlPrinterTest
