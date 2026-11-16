package orchescala.domain

import java.time.{LocalDate, LocalDateTime}

/** Generic type mappers - the conversions Scala does not have as a method of its own, for every
  * project: a mapping of Orch Spec calls them as extensions (`in.amount.toBigDecimal`), the worker
  * imports `orchescala.domain.StandardTypeMappers.*`. What Scala has (`x.toString`, `"42".toLong`) needs
  * none. Orch Spec knows them as its standard mappers (04-orch-spec/src/standardMappers.ts).
  */
object StandardTypeMappers:

  /** String → BigDecimal - `"100.50"` */
  extension (x: String) def toBigDecimal: BigDecimal = BigDecimal(x)

  /** Int → BigDecimal */
  extension (x: Int) def toBigDecimal: BigDecimal = BigDecimal(x)

  /** Long → BigDecimal */
  extension (x: Long) def toBigDecimal: BigDecimal = BigDecimal(x)

  /** Double → BigDecimal */
  extension (x: Double) def toBigDecimal: BigDecimal = BigDecimal(x)

  /** String → LocalDate - ISO, `2026-11-16` */
  extension (x: String) def toLocalDate: LocalDate = LocalDate.parse(x)

  /** String → LocalDateTime - ISO, `2026-11-16T08:15:30` */
  extension (x: String) def toLocalDateTime: LocalDateTime = LocalDateTime.parse(x)

end StandardTypeMappers
