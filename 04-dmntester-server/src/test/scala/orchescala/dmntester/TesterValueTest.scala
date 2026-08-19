package orchescala.dmntester

import io.circe.parser.decode
import io.circe.syntax.*
import munit.FunSuite
import orchescala.dmntester.TesterValue.*

/** An Input of a DMN may be an object - the DMN addresses its fields:
  * {{{ In(SelectedFond(id = 11393215, percentage = 50)) }}}
  */
class TesterValueTest extends FunSuite:

  private case class SelectedFond(id: Long, percentage: Int)

  test("a case class becomes an ObjectValue with its typed fields"):
    assertEquals(
      TesterValue.fromAny(SelectedFond(11393215L, 50)),
      ObjectValue("id" -> NumberValue(11393215L), "percentage" -> NumberValue(50))
    )

  test("the DMN engine gets an object as a Map - FEEL evaluates it as Context"):
    val value = TesterValue.fromAny(SelectedFond(11393215L, 50))
    assertEquals(
      value.value,
      Map("id" -> BigDecimal(11393215L), "percentage" -> BigDecimal(50))
    )
    assertEquals(value.valueStr, "{id: 11393215, percentage: 50}")
    assertEquals(value.valueType, "Object")

  test("objects nest - and their fields keep their types"):
    case class Nested(fond: SelectedFond, name: String, at: java.time.LocalDateTime)
    assertEquals(
      TesterValue.fromAny(
        Nested(
          SelectedFond(1L, 2),
          "Fondsdepot",
          java.time.LocalDateTime.parse("2021-12-23T00:00:00")
        )
      ),
      ObjectValue(
        "fond" -> ObjectValue("id" -> NumberValue(1L), "percentage" -> NumberValue(2)),
        "name" -> StringValue("Fondsdepot"),
        "at" -> DateValue("2021-12-23T00:00:00")
      )
    )

  test("an optional field is the value itself, None is null"):
    case class WithOption(fond: Option[SelectedFond], other: Option[String])
    assertEquals(
      TesterValue.fromAny(WithOption(Some(SelectedFond(1L, 2)), None)),
      ObjectValue(
        "fond" -> ObjectValue("id" -> NumberValue(1L), "percentage" -> NumberValue(2)),
        "other" -> NullValue
      )
    )

  test("a Map is an object as well"):
    assertEquals(
      TesterValue.fromAny(Map("percentage" -> 50)),
      ObjectValue("percentage" -> NumberValue(50))
    )

  test("a collection is not supported - and says so"):
    val ex = intercept[IllegalArgumentException](TesterValue.fromAny(Seq(1, 2)))
    assert(ex.getMessage.contains("Collections are not supported"), ex.getMessage)

  test("an ObjectValue survives the JSON round trip - server <-> client"):
    val value: TesterValue = TesterValue.fromAny(SelectedFond(11393215L, 50))
    assertEquals(decode[TesterValue](value.asJson.noSpaces), Right(value))

  test("a DmnConfig with an object Input survives the JSON round trip"):
    val config = DmnConfig(
      decisionId = "selected-fond",
      data = TesterData(
        inputs = List(
          TesterInput(
            "selectedFond",
            values = List(TesterValue.fromAny(SelectedFond(11393215L, 50)))
          )
        )
      ),
      dmnPath = "dmn/c7/selected-fond.dmn"
    )
    assertEquals(decode[DmnConfig](config.asJson.noSpaces), Right(config))

end TesterValueTest
