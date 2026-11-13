// Type mappers: conversions of one type into another, defined once in the model (Administration)
// and used by every mapping - a line from a `ClientMainType` onto a `ClientType` converts with
// the mapper between them. Four kinds:
//
//   table    ClientMainType → ClientType     case by case        x match { case ClientMainType.Person => ClientType.PERSON … }
//   field    BigDecimalWrapper → BigDecimal  a field of it        x.value
//   scala    TypeDateWrapper → LocalDate     an expression        LocalDate.parse(x.date)
//   decoder  ClientMainType → ClientType     the code's decoder   x.asJson.as[ClientType]
//
// In the worker each mapper used is a method of its own; an Option or a list of it is mapped along.
import type { VarNode } from './feel';
import type { Converter } from './fieldMapping';
import type { TypeIndex } from './scala';
import type { TypeMapper } from './types';

export const MAPPER_KINDS: Array<{ kind: TypeMapper['kind']; label: string; hint: string }> = [
  { kind: 'table', label: 'Tabelle', hint: 'Ein Enum in ein Enum - Fall für Fall' },
  { kind: 'field', label: 'Feld', hint: 'Ein Feld davon - der Wert eines Wrappers (value)' },
  { kind: 'scala', label: 'Scala', hint: 'Ein Scala-Ausdruck über x' },
  { kind: 'decoder', label: 'Deserialisierer', hint: 'Der Deserialisierer des Ziels im Code liest es (x.asJson.as[Ziel])' },
];

/** the name of a type without the package - what a mapping shows (`ClientType`) */
const short = (n: string) => n.replace(/^.*\./, '');

/** The mapper from one type into another - by reference, otherwise by name (`ClientMainType`). */
export function findMapper(mappers: TypeMapper[] | undefined, from: string, to: string, nameOf: (ref: string) => string): TypeMapper | undefined {
  if (!mappers?.length || !from || !to) return undefined;
  const exact = mappers.find(m => m.from === from && m.to === to);
  if (exact) return exact;
  const [f, t] = [short(nameOf(from)), short(nameOf(to))];
  return mappers.find(m => short(nameOf(m.from)) === f && short(nameOf(m.to)) === t);
}

/** The mapper between two types by their names (as the variables of a mapping show them). */
export function mapperByName(mappers: TypeMapper[] | undefined, from: string, to: string, nameOf: (ref: string) => string): TypeMapper | undefined {
  return (mappers ?? []).find(m => short(nameOf(m.from)) === short(from) && short(nameOf(m.to)) === short(to));
}

/** The cases of an enum - of the model's classes or the catalog. */
export function enumCases(ref: string, idx: TypeIndex): string[] | null {
  const own = idx.byId.get(ref);
  if (own?.kind === 'enum') return (own.values ?? []).map(v => v.name);
  const dom = idx.domainOf(ref);
  if (dom?.kind === 'enum') return dom.values?.length ? dom.values : (dom.cases ?? []).map(c => c.name);
  return null;
}

const norm = (n: string) => n.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * The case of `to` alike to `f`: the same name (`Person` → `PERSON`), otherwise the only one whose
 * name the other ends with (`CLIENT_MAIN_TYPE_PERSON` → `PERSON`, `Person` → `CLIENT_TYPE_PERSON`).
 */
function alike(f: string, to: string[]): string {
  const exact = to.find(t => norm(t) === norm(f));
  if (exact) return exact;
  const ends = to.filter(t => norm(t) && norm(f) && (norm(f).endsWith(norm(t)) || norm(t).endsWith(norm(f))));
  return ends.length === 1 ? ends[0] : '';
}

/** The table filled where the names are alike (see alike) - what is set stays. */
export function prefilledCases(from: string[], to: string[], set: TypeMapper['cases'] = []): NonNullable<TypeMapper['cases']> {
  return from.map(f => set.find(c => c.from === f && c.to) ?? { from: f, to: alike(f, to) });
}

/** The name of its method in the worker - `clientMainTypeToClientType`. */
export function mapperMethod(m: TypeMapper, nameOf: (ref: string) => string): string {
  const name = (ref: string) => short(nameOf(ref)).replace(/[^A-Za-z0-9]/g, '');
  const from = name(m.from);
  return `${from.charAt(0).toLowerCase()}${from.slice(1)}To${name(m.to)}`;
}

/** The body of its method over `x` - in Scala. */
export function mapperBody(m: TypeMapper, nameOf: (ref: string) => string): string {
  const from = short(nameOf(m.from));
  const to = short(nameOf(m.to));
  const fail = (what: string) => `throw IllegalArgumentException(${what})`;
  switch (m.kind) {
    case 'table': {
      const rows = (m.cases ?? []).filter(c => c.from && c.to);
      const all = (m.cases ?? []).length > 0 && rows.length === (m.cases ?? []).length;
      return [
        'x match',
        ...rows.map(c => `  case ${from}.${c.from} => ${to}.${c.to}`),
        ...(all ? [] : [`  case other => ${fail(`s"${from} $other: kein Fall in ${to}"`)}`]),
      ].join('\n');
    }
    case 'field': return m.path?.trim() ? `x.${m.path.trim()}` : `??? /* TODO ${from} → ${to}: welches Feld? */`;
    case 'scala': return m.scala?.trim() || `??? /* TODO ${from} → ${to} */`;
    case 'decoder': return `x.asJson.as[${to}].fold(e => ${fail(`s"${from} → ${to}: \${e.getMessage}"`)}, identity)`;
  }
}

/** What its method needs imported beyond the types. */
export const mapperImports = (m: TypeMapper): string[] =>
  [...(m.kind === 'decoder' ? ['import io.circe.syntax.*'] : []), ...(m.imports ?? []).map(i => i.trim()).filter(Boolean).map(i => (i.startsWith('import ') ? i : `import ${i}`))];

/** What is wrong with a mapper. */
export function mapperIssues(m: TypeMapper, all: TypeMapper[], idx: TypeIndex): string[] {
  const out: string[] = [];
  if (!m.from || !m.to) return ['Von und Nach brauchen einen Typ.'];
  if (m.from === m.to) out.push('Von und Nach sind derselbe Typ.');
  if (all.some(o => o.id !== m.id && o.from === m.from && o.to === m.to)) out.push('Diesen Mapper gibt es zweimal.');
  if (m.kind === 'table') {
    const from = enumCases(m.from, idx);
    const to = enumCases(m.to, idx);
    if (!from || !to) out.push('Eine Tabelle braucht zwei Enums.');
    else {
      const open = from.filter(f => !(m.cases ?? []).some(c => c.from === f && c.to));
      if (open.length) out.push(`Ohne Fall: ${open.join(', ')} - zur Laufzeit ein Fehler.`);
      const unknown = (m.cases ?? []).filter(c => c.to && !to.includes(c.to)).map(c => c.to);
      if (unknown.length) out.push(`Gibt es in ${short(idx.nameOf(m.to))} nicht: ${unknown.join(', ')}.`);
    }
  }
  if (m.kind === 'field' && !m.path?.trim()) out.push('Welches Feld?');
  if (m.kind === 'scala' && !m.scala?.trim()) out.push('Der Ausdruck fehlt.');
  return out;
}

/** a type's label without `Option[…]` and `Seq[…]` - and whether it is a list */
function element(label: string): { name: string; list: boolean } {
  let t = label.replace(/^Option\[(.*)\]$/, '$1');
  const list = /^Seq\[.*\]$/.test(t);
  if (list) t = t.replace(/^Seq\[(.*)\]$/, '$1').replace(/^Option\[(.*)\]$/, '$1');
  return { name: t, list };
}

/**
 * Which mapper a line from one node onto another uses (see Converter): between their types, a
 * list onto a list (each element), an Option along. Its name, e.g. `ClientMainType → ClientType`.
 */
export function converter(mappers: TypeMapper[] | undefined, nameOf: (ref: string) => string): Converter {
  return (from: VarNode, to: VarNode) => {
    if (!mappers?.length) return null;
    const a = element(from.label);
    const b = element(to.label);
    if (a.list !== b.list || a.name === b.name) return null;
    const m = mapperByName(mappers, a.name, b.name, nameOf);
    return m ? `${short(nameOf(m.from))} → ${short(nameOf(m.to))}` : null;
  };
}
