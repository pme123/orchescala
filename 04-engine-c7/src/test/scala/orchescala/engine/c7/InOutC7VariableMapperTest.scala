package orchescala.engine.c7

import orchescala.domain.*
import orchescala.domain.CamundaVariable.*
import munit.FunSuite
import org.camunda.community.rest.client.dto.VariableValueDto

class InOutC7VariableMapperTest extends FunSuite:

  test("toC7Variables should convert product to C7 variables"):
    val testInput = TestInput()
    val result = InOutC7VariableMapper.toC7Variables(testInput)
    
    assertEquals(result.size, 4)
    assertEquals(result("stringValue").getValue, "hello")
    assertEquals(result("stringValue").getType, "String")
    assertEquals(result("intValue").getValue, 42.asInstanceOf[AnyRef])
    assertEquals(result("intValue").getType, "Integer")
    assertEquals(result("boolValue").getValue, true.asInstanceOf[AnyRef])
    assertEquals(result("boolValue").getType, "Boolean")
    assertEquals(result("nestedValue").getType, "Json")

  test("toC7VariableValue should convert CString to VariableValueDto"):
    val cString = CString("test")
    val result = InOutC7VariableMapper.toC7VariableValue(cString)
    
    assertEquals(result.getValue, "test")
    assertEquals(result.getType, "String")
    
  test("toC7VariableValue should convert CInteger to VariableValueDto"):
    val cInteger = CInteger(123)
    val result = InOutC7VariableMapper.toC7VariableValue(cInteger)
    
    assertEquals(result.getValue, 123.asInstanceOf[AnyRef])
    assertEquals(result.getType, "Integer")
    
  test("toC7VariableValue should convert CBoolean to VariableValueDto"):
    val cBoolean = CBoolean(true)
    val result = InOutC7VariableMapper.toC7VariableValue(cBoolean)
    
    assertEquals(result.getValue, true.asInstanceOf[AnyRef])
    assertEquals(result.getType, "Boolean")
    
  test("toC7VariableValue should convert CJson to VariableValueDto"):
    val jsonStr = """{"key":"value"}"""
    val cJson = CJson(jsonStr)
    val result = InOutC7VariableMapper.toC7VariableValue(cJson)
    
    assertEquals(result.getValue, jsonStr)
    assertEquals(result.getType, "Json")

end InOutC7VariableMapperTest

case class TestInput(
  stringValue: String = "hello",
  intValue: Int = 42,
  boolValue: Boolean = true,
  nestedValue: Option[NestedValue] = Some(NestedValue())
)

object TestInput:
  given ApiSchema[TestInput] = deriveApiSchema
  given InOutCodec[TestInput] = deriveInOutCodec

case class NestedValue(value: String = "nested")

object NestedValue:
  given ApiSchema[NestedValue] = deriveApiSchema
  given InOutCodec[NestedValue] = deriveInOutCodec