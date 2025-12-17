package orchescala.engine.c8

import orchescala.domain.*
import orchescala.domain.CamundaVariable.*
import orchescala.engine.domain.EngineError
import zio.*
import zio.test.*

import scala.jdk.CollectionConverters.*

object MapToC8VariablesSpec extends ZIOSpecDefault:

  def spec = suite("mapToC8Variables")(
    suite("with None input")(
      test("should return empty Java map when variables is None") {
        for
          result <- mapToC8Variables(None)
        yield assertTrue(
          result.isEmpty,
          result.isInstanceOf[java.util.Map[String, Any]]
        )
      }
    ),
    
    suite("with empty map")(
      test("should return empty Java map when variables is Some(Map.empty)") {
        for
          result <- mapToC8Variables(Some(Map.empty))
        yield assertTrue(
          result.isEmpty,
          result.isInstanceOf[java.util.Map[String, Any]]
        )
      }
    ),
    
    suite("with simple variable types")(
      test("should convert CString variable") {
        val variables = Some(Map("name" -> CString("John Doe")))
        for
          result <- mapToC8Variables(variables)
        yield assertTrue(
          result.get("name") == "John Doe",
          result.size() == 1
        )
      },
      
      test("should convert CInteger variable") {
        val variables = Some(Map("age" -> CInteger(42)))
        for
          result <- mapToC8Variables(variables)
        yield assertTrue(
          result.get("age") == 42,
          result.size() == 1
        )
      },
      
      test("should convert CLong variable") {
        val variables = Some(Map("id" -> CLong(123456789L)))
        for
          result <- mapToC8Variables(variables)
        yield assertTrue(
          result.get("id") == 123456789L,
          result.size() == 1
        )
      },
      
      test("should convert CBoolean variable") {
        val variables = Some(Map("active" -> CBoolean(true)))
        for
          result <- mapToC8Variables(variables)
        yield assertTrue(
          result.get("active") == true,
          result.size() == 1
        )
      },
      
      test("should convert CDouble variable") {
        val variables = Some(Map("price" -> CDouble(99.99)))
        for
          result <- mapToC8Variables(variables)
        yield assertTrue(
          result.get("price") == 99.99,
          result.size() == 1
        )
      }
    ),
    
    suite("with CJson variables")(
      test("should convert CJson with valid JSON object") {
        val jsonStr = """{"city":"Zurich","country":"Switzerland"}"""
        val variables = Some(Map("address" -> CJson(jsonStr)))
        for
          result <- mapToC8Variables(variables)
          jsonResult = result.get("address").asInstanceOf[Json]
        yield assertTrue(
          jsonResult.isObject,
          jsonResult.asObject.get.apply("city").get.asString.contains("Zurich"),
          result.size() == 1
        )
      },
      
      test("should convert CJson with valid JSON array") {
        val jsonStr = """["apple","banana","cherry"]"""
        val variables = Some(Map("fruits" -> CJson(jsonStr)))
        for
          result <- mapToC8Variables(variables)
          jsonResult = result.get("fruits").asInstanceOf[Json]
        yield assertTrue(
          jsonResult.isArray,
          jsonResult.asArray.get.size == 3,
          result.size() == 1
        )
      },
      
      test("should fail with invalid JSON in CJson") {
        val jsonStr = """{"invalid": json}"""
        val variables = Some(Map("data" -> CJson(jsonStr)))
        for
          result <- mapToC8Variables(variables).exit
        yield assertTrue(
          result.isFailure
        )
      },
      
      test("should skip CJson with null value") {
        val variables = Some(Map(
          "validData" -> CJson("""{"key":"value"}"""),
          "nullData" -> CJson(null)
        ))
        for
          result <- mapToC8Variables(variables)
        yield assertTrue(
          result.size() == 1,
          result.containsKey("validData"),
          !result.containsKey("nullData")
        )
      }
    ),
    
    suite("with multiple variables")(
      test("should convert multiple variables of different types") {
        val variables = Some(Map(
          "name" -> CString("Alice"),
          "age" -> CInteger(30),
          "salary" -> CDouble(75000.50),
          "active" -> CBoolean(true),
          "employeeId" -> CLong(987654321L)
        ))
        for
          result <- mapToC8Variables(variables)
        yield assertTrue(
          result.size() == 5,
          result.get("name") == "Alice",
          result.get("age") == 30,
          result.get("salary") == 75000.50,
          result.get("active") == true,
          result.get("employeeId") == 987654321L
        )
      },

      test("should convert mix of CJson and simple types") {
        val jsonStr = """{"nested":{"value":123}}"""
        val variables = Some(Map(
          "config" -> CJson(jsonStr),
          "enabled" -> CBoolean(false),
          "count" -> CInteger(5)
        ))
        for
          result <- mapToC8Variables(variables)
        yield assertTrue(
          result.size() == 3,
          result.get("enabled") == false,
          result.get("count") == 5,
          result.get("config").asInstanceOf[Json].isObject
        )
      }
    ),

    suite("with null values")(
      test("should skip CString variables with null values") {
        val variables = Some(Map(
          "validKey" -> CString("value"),
          "nullKey" -> CString(null)
        ))
        for
          result <- mapToC8Variables(variables)
        yield assertTrue(
          result.size() == 1,
          result.get("validKey") == "value",
          !result.containsKey("nullKey")
        )
      },

      test("should skip all variable types with null values") {
        val variables = Some(Map(
          "validString" -> CString("test"),
          "nullString" -> CString(null),
          "validInt" -> CInteger(42),
          "validJson" -> CJson("""{"test":true}"""),
          "nullJson" -> CJson(null)
        ))
        for
          result <- mapToC8Variables(variables)
        yield assertTrue(
          result.size() == 3,
          result.containsKey("validString"),
          result.containsKey("validInt"),
          result.containsKey("validJson"),
          !result.containsKey("nullString"),
          !result.containsKey("nullJson")
        )
      }
    ),

    suite("error handling")(
      test("should return EngineError.ProcessError for invalid JSON") {
        val variables = Some(Map("bad" -> CJson("{invalid json")))
        for
          result <- mapToC8Variables(variables).flip
        yield assertTrue(
          result.isInstanceOf[EngineError.ProcessError],
          result.asInstanceOf[EngineError.ProcessError].errorMsg.contains("Problem parsing Json")
        )
      },

      test("should include variable key in error message") {
        val variables = Some(Map("myVariable" -> CJson("not valid json")))
        for
          result <- mapToC8Variables(variables).flip
        yield assertTrue(
          result.asInstanceOf[EngineError.ProcessError].errorMsg.contains("myVariable")
        )
      }
    ),

    suite("Java interop")(
      test("should return java.util.Map type") {
        val variables = Some(Map("test" -> CString("value")))
        for
          result <- mapToC8Variables(variables)
        yield assertTrue(
          result.isInstanceOf[java.util.Map[?, ?]]
        )
      },

      test("should be compatible with Java collections") {
        val variables = Some(Map(
          "key1" -> CString("value1"),
          "key2" -> CInteger(42)
        ))
        for
          result <- mapToC8Variables(variables)
          scalaMap = result.asScala.toMap
        yield assertTrue(
          scalaMap.size == 2,
          scalaMap("key1") == "value1",
          scalaMap("key2") == 42
        )
      }
    ),

    suite("edge cases")(
      test("should handle empty string in CString") {
        val variables = Some(Map("empty" -> CString("")))
        for
          result <- mapToC8Variables(variables)
        yield assertTrue(
          result.get("empty") == "",
          result.size() == 1
        )
      },

      test("should handle zero values") {
        val variables = Some(Map(
          "zeroInt" -> CInteger(0),
          "zeroLong" -> CLong(0L),
          "zeroDouble" -> CDouble(0.0)
        ))
        for
          result <- mapToC8Variables(variables)
        yield assertTrue(
          result.get("zeroInt") == 0,
          result.get("zeroLong") == 0L,
          result.get("zeroDouble") == 0.0,
          result.size() == 3
        )
      },

      test("should handle negative numbers") {
        val variables = Some(Map(
          "negInt" -> CInteger(-42),
          "negLong" -> CLong(-123456L),
          "negDouble" -> CDouble(-99.99)
        ))
        for
          result <- mapToC8Variables(variables)
        yield assertTrue(
          result.get("negInt") == -42,
          result.get("negLong") == -123456L,
          result.get("negDouble") == -99.99
        )
      },

      test("should handle special characters in keys") {
        val variables = Some(Map(
          "key-with-dash" -> CString("value1"),
          "key_with_underscore" -> CString("value2"),
          "key.with.dot" -> CString("value3")
        ))
        for
          result <- mapToC8Variables(variables)
        yield assertTrue(
          result.size() == 3,
          result.get("key-with-dash") == "value1",
          result.get("key_with_underscore") == "value2",
          result.get("key.with.dot") == "value3"
        )
      }
    )
  )

end MapToC8VariablesSpec
