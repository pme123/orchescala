package orchescala.domain

import orchescala.domain.StandardTypeMappers.*

import java.time.{LocalDate, LocalDateTime}

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

  test("a method of the type itself needs none - the import does not hide it"):
    assertEquals(42.toString, "42")
    assertEquals("42".toLong, 42L)

end StandardTypeMappersTest
