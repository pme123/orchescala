// Type mappers: conversions of one type into another, defined once in the model (Administration)
// and used by every mapping - a line from a `ClientMainType` onto a `ClientType` converts with
// the mapper between them. Four kinds:
//
//   table    ClientMainType → ClientType     case by case        x match { case ClientMainType.Person => ClientType.PERSON … }
//   field    BigDecimalWrapper → BigDecimal  a field of it        x.value
//   scala    TypeDateWrapper → LocalDate     an expression        LocalDate.parse(x.date)
//   decoder  ClientMainType → ClientType     the code's decoder   x.asJson.as[ClientType]
//
// In the code each mapper used is an extension (`existing.kind.toClientType`) of an object in the
// `schema` of the level both of its types share (see mapperHome) - the export brings the file, the
// worker imports it; an Option or a list of it is mapped along.
import type { VarNode } from './feel';
import type { Converter } from './fieldMapping';
import { caseIdent, type TypeIndex } from './scala.ts';
import type { DomainMapper, Model, TypeMapper } from './types';
import { STANDARD_MAPPERS } from './standardMappers.ts';

export const MAPPER_KINDS: Array<{ kind: TypeMapper['kind']; label: string; hint: string }> = [
  { kind: 'table', label: 'Tabelle', hint: 'Ein Enum in ein Enum - Fall für Fall' },
  { kind: 'field', label: 'Feld', hint: 'Ein Feld davon - der Wert eines Wrappers (value)' },
  { kind: 'scala', label: 'Scala', hint: 'Ein Scala-Ausdruck über x' },
  { kind: 'decoder', label: 'Deserialisierer', hint: 'Der Deserialisierer des Ziels im Code liest es (x.asJson.as[Ziel])' },
];

/** the name of a type without the package - what a mapping shows (`ClientType`) */
const short = (n: string) => n.replace(/^.*\./, '');

/**
 * The mapper from one type into another - by their names (`ClientMainType`), as the mapping
 * editor finds it too: a mapping knows only the names. Two with the same names find none.
 */
export function findMapper(mappers: TypeMapper[] | undefined, from: string, to: string, nameOf: (ref: string) => string): TypeMapper | undefined {
  if (!mappers?.length || !from || !to) return undefined;
  return mapperByName(mappers, nameOf(from), nameOf(to), nameOf, { from, to });
}

/** Two types the same? Both of the catalog (`dom:…`): by their reference - otherwise the names decide. */
const sameRef = (a: string, b: string | undefined) => !b || !a.startsWith('dom:') || !b.startsWith('dom:') || a === b;

/**
 * The mapper between two types by their names (as the variables of a mapping show them) - only
 * when it is the one: two with the same names (other packages) are no match, mapperIssues says so.
 */
export function mapperByName(mappers: TypeMapper[] | undefined, from: string, to: string, nameOf: (ref: string) => string, refs: { from?: string; to?: string } = {}): TypeMapper | undefined {
  // the same names of other packages (`ClientType` of two projects) are no match when both are known
  const hits = (mappers ?? []).filter(m => short(nameOf(m.from)) === short(from) && short(nameOf(m.to)) === short(to)
    && sameRef(m.from, refs.from) && sameRef(m.to, refs.to));
  return hits.length === 1 ? hits[0] : undefined;
}

/** The cases of an enum - of the model's classes or the catalog. */
export function enumCases(ref: string, idx: TypeIndex): string[] | null {
  const own = idx.byId.get(ref);
  if (own?.kind === 'enum') return (own.values ?? []).map(v => v.name);
  const dom = idx.domainOf(ref);
  if (dom?.kind === 'enum') return dom.values?.length ? dom.values : (dom.cases ?? []).map(c => c.name);
  return null;
}

/** The cases of an enum with cases (ADT: a case with fields) - null for any other type. */
export function adtCases(ref: string, idx: TypeIndex): string[] | null {
  const own = idx.byId.get(ref);
  if (own) return own.kind === 'enum' && ((own.values ?? []).some(v => !!v.fields?.length) || !!own.fields?.length) ? (own.values ?? []).map(v => v.name) : null;
  const dom = idx.domainOf(ref);
  return dom?.kind === 'enum' && (dom.cases ?? []).some(c => !!c.fields?.length) ? (dom.cases ?? []).map(c => c.name) : null;
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

/**
 * The cases of an enum with cases onto those of another (see CaseLink): by names alike, and where
 * none fits and both have as many cases, by their order (`Person` → `privateIndividual`,
 * `Company` → `companiesAndOther`) - a case of the target only once. What is set stays.
 */
export function prefilledAdtCases(from: string[], to: string[], set: Array<{ from: string; to: string }> = []): Array<{ from: string; to: string }> {
  const byName = prefilledCases(from, to, set);
  if (from.length !== to.length) return byName;
  // the cases still open take the targets not taken yet, in their order
  const free = to.filter(t => !byName.some(c => c.to === t));
  return byName.map(c => (c.to ? c : { from: c.from, to: free.shift() ?? '' }));
}

/** Its name from both types - `clientMainTypeToClientType`: two mappers with the same one cannot be told apart. */
export function mapperMethod(m: TypeMapper, nameOf: (ref: string) => string): string {
  const name = (ref: string) => short(nameOf(ref)).replace(/[^A-Za-z0-9]/g, '');
  const from = name(m.from);
  return `${from.charAt(0).toLowerCase()}${from.slice(1)}To${name(m.to)}`;
}

/** The name of its extension method - `toClientType`: `existing.kind.toClientType`; one of the code keeps its own. */
export function mapperExtension(m: TypeMapper, nameOf: (ref: string) => string): string {
  if (m.code) return m.code.method;
  const to = short(nameOf(m.to)).replace(/[^A-Za-z0-9]/g, '');
  // `toString` is a method of every type - Scala would call it, never the extension
  return to === 'String' ? 'asString' : `to${to}`;
}

/** A type mapper of the code (catalog) as one of the model - converting with its extension, not editable. */
export function codeMapper(d: DomainMapper): TypeMapper {
  return {
    id: `code:${d.id}`, from: d.from, to: d.to, kind: 'decoder',
    code: { pkg: d.pkg, object: d.object, method: d.method },
    ...(d.descr ? { description: d.descr } : {}),
  };
}

/**
 * The type mappers a mapping converts with: those of the model (Administration), then those of
 * the code (catalog), then the standard ones (`Int` → `String`, see standardMappers.ts) - one of the code with the names of one of the model steps back (the model's
 * is the definition, its export updates the code), of two of the code the one read first applies.
 */
export function modelMappers(model: Pick<Model, 'typeMappers' | 'domainMappers'> | null | undefined): TypeMapper[] {
  const own = model?.typeMappers ?? [];
  const key = (from: string, to: string) => `${short(from)}→${short(to)}`;
  const taken = new Set<string>();
  const code: TypeMapper[] = [];
  for (const d of model?.domainMappers ?? []) {
    const k = key(d.from, d.to);
    if (taken.has(k)) continue;
    taken.add(k);
    code.push(codeMapper(d));
  }
  // the model's name its types by reference - compared by the short names the code has
  const ownKeys = new Set(own.map(m => key(m.from.replace(/^dom:/, ''), m.to.replace(/^dom:/, ''))));
  const kept = [...own, ...code.filter(m => !ownKeys.has(key(m.from, m.to)))];
  // the standard ones last - one of the model or the code with the same names goes before
  const keptKeys = new Set(kept.map(m => key(m.from.replace(/^dom:/, ''), m.to.replace(/^dom:/, ''))));
  return [...kept, ...STANDARD_MAPPERS.filter(m => !keptKeys.has(key(m.from, m.to)))];
}

/** Where a mapper lives in the code - the package of a `schema` and the object in it. */
export interface MapperHome { pkg: string; object: string }

/**
 * Where a mapper lives in the code: the `schema` of the deepest level of the domain its types of
 * the project share (`acme.crm.domain.clientMaster.schema`) - the API's when they are in the API of
 * the export, never another API's; the project's (`acme.crm.domain.schema`) when they share none.
 * A type of another project or no class of the domain (`LocalDate`) does not count: `Mifid1` of
 * `clientMaster.v1` → `MifidCode` of another project lives in `clientMaster.v1`, `LocalDate` →
 * `String` in the project's. `typePkgs`: the packages of its two types - null for no class.
 * `root`: the domain of the project, `api`: the export's API below it (`client`, `v1`).
 */
export function mapperHome(typePkgs: Array<string | null>, root: string, api: string[]): MapperHome {
  // the levels below the domain of the project, without `schema`: `clientMaster`, `naturalPersons`, `v1`
  const levels = (pkg: string | null): string[] | null => {
    if (!pkg || (pkg !== root && !pkg.startsWith(`${root}.`))) return null;
    const rest = pkg.slice(root.length).split('.').filter(Boolean);
    const at = rest.indexOf('schema');
    return at >= 0 ? rest.slice(0, at) : rest;
  };
  const known = typePkgs.map(levels).filter((l): l is string[] => !!l);
  let common = known.length
    ? known.reduce((a, b) => { let k = 0; while (k < a.length && k < b.length && a[k] === b[k]) k++; return a.slice(0, k); })
    : [];
  const version = common.findIndex(x => /^v\d+$/.test(x));
  if (version >= 0) {
    // inside an API: its schema if it is the API of the export, otherwise the level above it
    const ofApi = common.slice(0, version + 1);
    common = ofApi.join('.') === api.join('.') ? ofApi : ofApi.slice(0, Math.max(0, version - 1));
  }
  const pascal = (x: string) => `${x.charAt(0).toUpperCase()}${x.slice(1)}`;
  const last = common[common.length - 1] ?? '';
  const object = !common.length ? 'TypeMappers'
    : /^v\d+$/.test(last) ? `${pascal(common[common.length - 2])}${last.toUpperCase()}TypeMappers`
      : `${pascal(last)}TypeMappers`;
  return { pkg: [root, ...common, 'schema'].join('.'), object };
}

/** A mapper as an extension of its object: its doc, the head on one line (the helper's merge keys it by that), its body. */
export function mapperCode(m: TypeMapper, nameOf: (ref: string) => string, fromCases?: string[] | null): string {
  const [from, to] = [short(nameOf(m.from)), short(nameOf(m.to))];
  const doc = m.description?.trim() ? `${from} → ${to}: ${m.description.trim().split('\n')[0]}` : `${from} → ${to}`;
  return [
    `  /** ${doc.replace(/\*\//g, '* /')} */`,
    `  extension (x: ${from}) def ${mapperExtension(m, nameOf)}: ${to} =`,
    mapperBody(m, nameOf, fromCases).replace(/^/gm, '    '),
  ].join('\n');
}

/**
 * The body of its method over `x` - in Scala. `fromCases`: the cases of the source enum - a table
 * covering only some of them gets the default that fails (without them: when a row is empty).
 */
export function mapperBody(m: TypeMapper, nameOf: (ref: string) => string, fromCases?: string[] | null): string {
  const from = short(nameOf(m.from));
  const to = short(nameOf(m.to));
  const fail = (what: string) => `throw IllegalArgumentException(${what})`;
  switch (m.kind) {
    case 'table': {
      // a row per case of the source that is still there - the first one counts
      const rows = (m.cases ?? []).filter((c, i, l) => c.from && c.to && (!fromCases || fromCases.includes(c.from))
        && l.findIndex(o => o.from === c.from) === i);
      const all = fromCases
        ? fromCases.length > 0 && fromCases.every(f => rows.some(c => c.from === f))
        : (m.cases ?? []).length > 0 && rows.length === (m.cases ?? []).length;
      return [
        'x match',
        ...rows.map(c => `  case ${from}.${caseIdent(c.from)} => ${to}.${caseIdent(c.to)}`),
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
  // other types with the same names (another package): a mapping shows only the names, the worker
  // method is named after them - neither tells them apart
  else if (all.some(o => o.id !== m.id && o.from && o.to && mapperMethod(o, idx.nameOf) === mapperMethod(m, idx.nameOf))) {
    out.push(`Ein anderer Mapper hat dieselben Namen (${mapperMethod(m, idx.nameOf)}) - im Mapping und im Code nicht zu unterscheiden; keiner der beiden wandelt.`);
  }
  if (m.kind === 'table') {
    const from = enumCases(m.from, idx);
    const to = enumCases(m.to, idx);
    if (!from || !to) out.push('Eine Tabelle braucht zwei Enums.');
    else {
      const open = from.filter(f => !(m.cases ?? []).some(c => c.from === f && c.to));
      if (open.length) out.push(`Ohne Fall: ${open.join(', ')} - zur Laufzeit ein Fehler.`);
      const unknown = (m.cases ?? []).filter(c => c.to && !to.includes(c.to)).map(c => c.to);
      if (unknown.length) out.push(`Gibt es in ${short(idx.nameOf(m.to))} nicht: ${unknown.join(', ')}.`);
      const gone = (m.cases ?? []).filter(c => c.from && !from.includes(c.from)).map(c => c.from);
      if (gone.length) out.push(`Gibt es in ${short(idx.nameOf(m.from))} nicht mehr: ${gone.join(', ')} - wird im Code weggelassen.`);
      const twice = (m.cases ?? []).map(c => c.from).filter((f, i, l) => f && l.indexOf(f) !== i);
      if (twice.length) out.push(`Mehrfach: ${[...new Set(twice)].join(', ')} - die erste Zeile gilt.`);
    }
  }
  if (m.kind === 'field' && !m.path?.trim()) out.push('Welches Feld?');
  else if (m.kind === 'field' && !/^[A-Za-z_]\w*(\.[A-Za-z_]\w*)*$/.test(m.path!.trim())) out.push(`«${m.path!.trim()}» ist kein Feldpfad - Namen mit Punkt dazwischen (value, amount.value).`);
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
    const m = mapperByName(mappers, a.name, b.name, nameOf, { from: from.field?.type, to: to.field?.type });
    return m ? `${short(nameOf(m.from))} → ${short(nameOf(m.to))}` : null;
  };
}

/** A mapper as it is stored - only what its kind uses, trimmed; null without both types */
export function cleanMapper(m: TypeMapper): TypeMapper | null {
  // read from a file: every field checked for its type - a wrong one counts as missing
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  if (!m || typeof m !== 'object' || !str(m.from) || !str(m.to) || !MAPPER_KINDS.some(k => k.kind === m.kind)) return null;
  const cases = (Array.isArray(m.cases) ? m.cases : [])
    .filter(x => x && typeof x === 'object' && str(x.from))
    .map(x => ({ from: str(x.from), to: str(x.to) }))
    // one row per case - the first one counts, as in the worker
    .filter((x, i, l) => l.findIndex(o => o.from === x.from) === i);
  const imports = (Array.isArray(m.imports) ? m.imports : []).map(str).filter(Boolean);
  return {
    id: str(m.id) || `tm-${str(m.from)}-${str(m.to)}`, from: str(m.from), to: str(m.to), kind: m.kind,
    ...(m.kind === 'table' ? { cases } : {}),
    ...(m.kind === 'field' && str(m.path) ? { path: str(m.path) } : {}),
    ...(m.kind === 'scala' && str(m.scala) ? { scala: str(m.scala) } : {}),
    ...(m.kind === 'scala' && imports.length ? { imports } : {}),
    ...(str(m.description) ? { description: str(m.description) } : {}),
  };
}

/** `base`, or numbered - an id none of `have` has */
function uniqueId(base: string, have: TypeMapper[]): string {
  let id = base;
  for (let i = 2; have.some(h => h.id === id); i++) id = `${base}-${i}`;
  return id;
}

/** The file of an export: `{version, typeMappers}` */
export const mapperFile = (all: TypeMapper[]): string =>
  JSON.stringify({ version: 1, typeMappers: all.map(cleanMapper).filter(Boolean) }, null, 2);

/**
 * An imported file added to the mappers there are: one with the same id or the same From → To
 * replaces it, new ones are added, the others stay. A file without mappers is an error.
 */
export function importedMappers(have: TypeMapper[], text: string): { all: TypeMapper[]; added: number; replaced: number } {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error('Kein JSON - keine Typ-Mapper-Datei.'); }
  const entries: unknown[] = Array.isArray(raw) ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { typeMappers?: unknown }).typeMappers) ? (raw as { typeMappers: unknown[] }).typeMappers : [];
  const same = (a: TypeMapper, b: TypeMapper) => a.id === b.id || (a.from === b.from && a.to === b.to);
  // within the file the last one per From → To wins
  const fromTo = entries
    .filter((m): m is TypeMapper => !!m && typeof m === 'object')
    .map(m => cleanMapper(m))
    .filter((m): m is TypeMapper => !!m)
    .filter((m, i, l) => !l.slice(i + 1).some(o => o.from === m.from && o.to === m.to));
  // its id, unless a mapper here has it for other types or one before in the file took it - then a new one
  const taken: TypeMapper[] = [...have];
  const list = fromTo.map(m => {
    const clash = taken.some(h => h.id === m.id && (h.from !== m.from || h.to !== m.to));
    const next = clash ? { ...m, id: uniqueId(`tm-${m.from}-${m.to}`, taken) } : m;
    taken.push(next);
    return next;
  });
  if (!list.length) throw new Error('Keine Typ-Mapper in der Datei.');
  const replaced = have.filter(a => list.some(b => same(a, b))).length;
  const added = list.filter(b => !have.some(a => same(a, b))).length;
  return { all: [...have.filter(a => !list.some(b => same(a, b))), ...list], added, replaced };
}
