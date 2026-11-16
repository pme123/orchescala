package orchescala.domain

import orchescala.domain.StandardTypeMappers.*

import java.time.{LocalDate, LocalDateTime}
import java.time.format.DateTimeParseException

/** The extensions as the worker calls them - `x.toBigDecimal` for each type it has one for. */
class StandardTypeMappersTest extends munit.FunSuite:

  test("into BigDecimal - from a String, an Int, a Long, a Double"):
    assertEquals("100.50".toBigDecimal, BigDecimal("100.50"))
    assertEquals(42.toBigDecimal, BigDecimal(42))
    assertEquals(42L.toBigDecimal, BigDecimal(42L))
    assertEquals(1.5.toBigDecimal, BigDecimal(1.5))
    // as a mapping calls them: an Option or a list along
    assertEquals(Option("1").map(_.toBigDecimal), Some(BigDecimal(1)))
    assertEquals(Seq(1, 2).map(_.toBigDecimal), Seq(BigDecimal(1), BigDecimal(2)))

  test("into a date - ISO"):
    assertEquals("2026-11-16".toLocalDate, LocalDate.of(2026, 11, 16))
    assertEquals("2026-11-16T08:15:30".toLocalDateTime, LocalDateTime.of(2026, 11, 16, 8, 15, 30))

  test("a Double: its shortest decimal, not the binary value"):
    assertEquals(0.1.toBigDecimal, BigDecimal("0.1"))

  test("a value that is none of the type: fails with what it was, the parse error as its cause"):
    val number = intercept[IllegalArgumentException]("abc".toBigDecimal)
    assert(number.getMessage.startsWith("'abc' is no BigDecimal"), number.getMessage)
    assert(number.getCause.isInstanceOf[NumberFormatException], number.getCause)
    val date = intercept[IllegalArgumentException]("16.11.2026".toLocalDate)
    assert(date.getMessage.startsWith("'16.11.2026' is no LocalDate"), date.getMessage)
    assert(date.getCause.isInstanceOf[DateTimeParseException], date.getCause)
    val dateTime = intercept[IllegalArgumentException]("2026-11-16".toLocalDateTime)
    assert(dateTime.getMessage.startsWith("'2026-11-16' is no LocalDateTime"), dateTime.getMessage)
    assert(dateTime.getCause.isInstanceOf[DateTimeParseException], dateTime.getCause)
    // a Double without a decimal value, an empty text: the same
    val nan = intercept[IllegalArgumentException](Double.NaN.toBigDecimal)
    assert(nan.getMessage.startsWith("'NaN' is no BigDecimal"), nan.getMessage)
    val empty = intercept[IllegalArgumentException]("".toBigDecimal)
    assert(empty.getMessage.startsWith("'' is no BigDecimal"), empty.getMessage)

  test("a method of the type itself needs none - the import does not hide it"):
    assertEquals(42.toString, "42")
    assertEquals("42".toLong, 42L)

end StandardTypeMappersTest
