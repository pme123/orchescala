package orchescala.domain

import orchescala.domain.*
import orchescala.domain.CamundaVariable.*
import munit.FunSuite

import java.time.LocalDate

class CamundaVariableTest extends FunSuite:

  test("CamundaVariable valueToCamunda"):
    val variable = CamundaVariable.valueToCamunda(12L)
    assertEquals(variable, CLong(12))

  test("CamundaVariable valueToCamunda LocalDate"):
    val variable = CamundaVariable.valueToCamunda(LocalDate.parse("2021-12-12"))
    assertEquals(variable, CString("2021-12-12"))

  test("CamundaVariable toCamunda"):
    val variable = CamundaVariable.toCamunda(Out())
    assertEquals(
      variable,
      Map(
        "addressChangeCountryPolicy" -> CBoolean(true),
        "expiresInDays" -> CInteger(3),
        "staffMemberId" -> CLong(2L),
        "leadInstruction" -> CString("hello"),
        "other" -> CJson(
          """{
            |  "other" : true
            |}""".stripMargin
        )
      )
    )

  test("CamundaVariable toCamunda"):
    val variable = CamundaVariable.jsonToCamundaValue(Json.obj("other" -> Json.fromBoolean(true)))
    assertEquals(
      variable,
      Map(
        "other" -> CBoolean(true),
      )
    )  

end CamundaVariableTest

case class Out(
    addressChangeCountryPolicy: Boolean = true,
    expiresInDays: Int = 3,
    staffMemberId: Long = 2L,
    leadInstruction: String = "hello",
    other: Option[Other] = Some(Other())
)

object Out:
  given ApiSchema[Out] = deriveApiSchema
  given InOutCodec[Out] = deriveInOutCodec

case class Other(
    other: Boolean = true
)

object Other:
  given ApiSchema[Other] = deriveApiSchema
  given InOutCodec[Other] = deriveInOutCodec
