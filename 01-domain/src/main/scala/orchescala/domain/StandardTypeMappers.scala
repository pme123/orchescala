package orchescala.domain

import java.time.{LocalDate, LocalDateTime}
import java.time.format.DateTimeParseException

/** Generic type mappers - the conversions Scala does not have as a method of its own, for every
  * project: a mapping of Orch Spec calls them as extensions (`in.amount.toBigDecimal`), the worker
  * imports `orchescala.domain.StandardTypeMappers.*`. What Scala has (`x.toString`, `"42".toLong`) needs
  * none. Orch Spec knows them as its standard mappers (04-orch-spec/src/standardMappers.ts).
  */
object StandardTypeMappers:

  // a value that is none of the type fails with what it was - not a bare NumberFormatException
  private def parsed[A](x: String, to: String)(parse: => A): A =
    try parse
    catch case e: (NumberFormatException | DateTimeParseException) => throw IllegalArgumentException(s"'$x' is no $to: ${e.getMessage}", e)

  /** String → BigDecimal - `"100.50"` */
  extension (x: String) def toBigDecimal: BigDecimal = parsed(x, "BigDecimal")(BigDecimal(x))

  /** Int → BigDecimal */
  extension (x: Int) def toBigDecimal: BigDecimal = BigDecimal(x)

  /** Long → BigDecimal */
  extension (x: Long) def toBigDecimal: BigDecimal = BigDecimal(x)

  /** Double → BigDecimal - its shortest decimal (`0.1` → `0.1`, as `Double.toString`) */
  extension (x: Double) def toBigDecimal: BigDecimal = BigDecimal(x)

  /** String → LocalDate - ISO, `2026-11-16` */
  extension (x: String) def toLocalDate: LocalDate = parsed(x, "LocalDate")(LocalDate.parse(x))

  /** String → LocalDateTime - ISO, `2026-11-16T08:15:30` */
  extension (x: String) def toLocalDateTime: LocalDateTime = parsed(x, "LocalDateTime")(LocalDateTime.parse(x))

end StandardTypeMappers
