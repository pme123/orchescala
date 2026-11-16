// The standard type mappers: generic conversions every project has - no project defines them, none
// copies their logic. What Scala has as a method of its own (`x.toString`, `"42".toLong`) the
// worker calls as it is; the others are extensions of `orchescala.domain.StandardTypeMappers`
// (01-domain), which the worker imports. A mapper of the model or of the code with the same names
// goes before one of these.
import type { TypeMapper } from './types';

/** the object of orchescala with the generic extensions (01-domain/…/StandardTypeMappers.scala) - not `TypeMappers`, the name of a project's */
export const ORCHESCALA_MAPPERS = { pkg: 'orchescala.domain', object: 'StandardTypeMappers' };

/** a method of the type itself - nothing to import */
const MEMBER = { pkg: '', object: '' };

const std = (from: string, to: string, method: string, home: { pkg: string; object: string }, description?: string): TypeMapper => ({
  id: `std:${from}→${to}`, from, to, kind: 'decoder', code: { ...home, method }, ...(description ? { description } : {}),
});

const TO_STRING = ['Int', 'Long', 'Double', 'BigDecimal', 'Boolean', 'LocalDate', 'LocalDateTime'];

export const STANDARD_MAPPERS: TypeMapper[] = [
  ...TO_STRING.map(t => std(t, 'String', 'toString', MEMBER)),
  std('String', 'Int', 'toInt', MEMBER, 'wirft, wenn es keine Zahl ist'),
  std('String', 'Long', 'toLong', MEMBER, 'wirft, wenn es keine Zahl ist'),
  std('String', 'Double', 'toDouble', MEMBER, 'wirft, wenn es keine Zahl ist'),
  std('String', 'Boolean', 'toBoolean', MEMBER, '`true` oder `false`'),
  std('Int', 'Long', 'toLong', MEMBER),
  std('Int', 'Double', 'toDouble', MEMBER),
  std('Long', 'Int', 'toInt', MEMBER, 'schneidet ab, was nicht in ein Int passt'),
  std('Long', 'Double', 'toDouble', MEMBER),
  std('BigDecimal', 'Double', 'toDouble', MEMBER),
  std('BigDecimal', 'Long', 'toLong', MEMBER, 'ohne Nachkommastellen'),
  std('BigDecimal', 'Int', 'toInt', MEMBER, 'ohne Nachkommastellen'),
  std('LocalDateTime', 'LocalDate', 'toLocalDate', MEMBER),
  std('String', 'BigDecimal', 'toBigDecimal', ORCHESCALA_MAPPERS, '`"100.50"`'),
  std('Int', 'BigDecimal', 'toBigDecimal', ORCHESCALA_MAPPERS),
  std('Long', 'BigDecimal', 'toBigDecimal', ORCHESCALA_MAPPERS),
  std('Double', 'BigDecimal', 'toBigDecimal', ORCHESCALA_MAPPERS),
  std('String', 'LocalDate', 'toLocalDate', ORCHESCALA_MAPPERS, 'ISO, `2026-11-16`'),
  std('String', 'LocalDateTime', 'toLocalDateTime', ORCHESCALA_MAPPERS, 'ISO, `2026-11-16T08:15:30`'),
];

/** a standard mapper that is a method of the type itself - no object to import, never called on one */
export const isMember = (m: TypeMapper): boolean => !!m.code && !m.code.object;

/** one of the standard mappers - steps back behind the project's of the same name */
export const isStandard = (m: TypeMapper): boolean => m.id.startsWith('std:');
