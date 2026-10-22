// Data model → Orchescala domain (Scala 3).
//
// Generates exactly the idioms found in the globex projects:
//
//   case class In(@description("…") feld: Option[String] = None)
//   object In:
//     given ApiSchema[In]  = deriveApiSchema
//     given InOutCodec[In] = deriveInOutCodec
//     lazy val example        = In(…)
//     lazy val exampleMinimal = example.copy(optionalesFeld = None, …)
//   end In
//
// The `In` belongs in the process object, the other types each in their own
// file under `schema/`. The generator deliberately does **not** create
// `InConfig` and `InitIn` — those are implementation details.

import { evaluate, FeelDate, FeelDateTime, FeelDuration } from 'feelin';
import type { DomainDefault, EnumValue, Field, Interaction, Model, ProcessSpec, TypeDef } from './types.ts';
import { INTERACTION_META, SCALA_TYPES, isAdt } from './types.ts';
import { interactionOrigin, loopSettings, mockableSteps } from './interactions.ts';
import { DOMAIN_PREFIX, deriveObject, objectOf } from './serviceTypes.ts';
import { allSteps, blockIndex, blockStart, mockFieldOf } from './bpmn.ts';
import { isFixedCaseDefault } from './scalaTypes.ts';
import {
  domainNameOf, domainTypeOf, parseDomainRef, parseServiceRef, serviceTypeOf,
  type ServiceType,
} from './serviceTypes.ts';
import type { DomainType } from './types.ts';

const isScalar = (t: string): boolean => (SCALA_TYPES as readonly string[]).includes(t);

/** Number-like? Determines which constraints and examples fit. */
export const isNumeric = (t: string): boolean =>
  ['Int', 'Long', 'Double', 'BigDecimal'].includes(t);

/**
 * Which kind of constraint fits this type — `null` means: none at all.
 * `Boolean` and the date types carry no refinement; `Iban` and
 * `Iso8601Duration` are strings and behave like `String`.
 */
export function constraintKind(t: string): 'text' | 'zahl' | null {
  if (isNumeric(t)) return 'zahl';
  if (['String', 'Iban', 'Iso8601Duration'].includes(t)) return 'text';
  return null;
}

export interface TypeIndex {
  byId: Map<string, TypeDef>;
  /** Name of the type — scalar, custom or service object */
  nameOf: (typeRef: string) => string;
  /** Service object behind an `svc:` reference */
  serviceOf: (typeRef: string) => ServiceType | null;
  /** Catalog type behind a `dom:` reference */
  domainOf: (typeRef: string) => DomainType | null;
  /** Example value from the domain for the field (`clientKey` → `defaultClientKey`) — only with a matching type */
  defaultOf: (f: Field) => DomainDefault | null;
  /** Classes of the data model that already exist in another domain — per TypeDef id (see `referencedClass`) */
  referenced: Map<string, DomainType>;
  /** Package of the own project (`valiant.product`) */
  home: string;
  /** Package of the process (`valiant.product.domain.lilaSet.v2`) — empty if unknown */
  ownPkg: string;
  /** An example value of the domain by name (`defaultValidUntil`) — with the same precedence as `defaultOf` */
  defaultNamed: (name: string) => DomainDefault | null;
  /** Object and package of a service or process — from the catalog, otherwise derived (`objectOf`) */
  objectOf: (ref: string) => { object: string; pkg: string; uncertain: boolean };
}

/** A custom class of the data model (`schema/`) — not the In / Out of the process or of an interaction. */
const isSchemaClass = (t: TypeDef) => !t.root && !t.processOut && !t.initIn && !t.inConfig && !t.interactionId && !t.inProcessObject;

/**
 * A class of the data model that **already exists** in the domain — by its
 * name in the catalog (classes, enums, aliases; not the In / Out of an object).
 * Only new classes and the free-standing ones of the own process belong in
 * the data model; everything else is referenced — imported, not exported:
 * - defined in an object of the own process (`ResolveTimerDueDateWithOverwrite.DueDateSpec`,
 *   `OrderCard.CustomProcessStatus`) — the export would write it a second time as `schema/`
 * - in exactly one other package; with several, one in the same project wins
 *   (`PoaResult` → `valiant.product.domain.loadPoas.v1.schema`). If several remain: new, to be checked.
 */
export function referencedClass(t: TypeDef, model: Model | null, ownPkg: string): { type?: DomainType; ambiguous?: string[] } {
  if (!isSchemaClass(t) || !t.name?.trim()) return {};
  // imported from the domain of this process (free in the package or in schema/) —
  // an older catalog that still lists it in an object changes nothing about that
  if (t.domainId && (t.domainId === `${ownPkg}.${t.name}` || t.domainId === `${ownPkg}.schema.${t.name}`)) return {};
  const inOwn = (d: DomainType) => d.pkg === ownPkg || d.pkg.startsWith(`${ownPkg}.`);
  const hits = (model?.domainTypes ?? []).filter(d =>
    (d.kind === 'case' || d.kind === 'enum' || d.kind === 'alias') &&
    (d.owner ? d.name === `${d.owner}.${t.name}` : d.name === t.name));
  if (hits.some(d => inOwn(d) && !d.owner)) return {};
  // in the own process object (`OrderCard.CustomProcessStatus`): belongs to the specification
  if (hits.some(d => inOwn(d) && d.owner && d.processName)) return {};
  const nestedOwn = hits.find(d => inOwn(d) && d.owner);
  if (nestedOwn) return { type: nestedOwn };
  const foreign = [...new Map(hits.filter(d => !inOwn(d)).map(d => [d.pkg, d] as [string, DomainType])).values()];
  const stem = ownPkg.replace(/\.domain\..*$/, '.domain');
  const sameProject = foreign.filter(d => d.pkg.startsWith(`${stem}.`));
  const pick = sameProject.length === 1 ? sameProject[0] : foreign.length === 1 ? foreign[0] : undefined;
  if (pick) return { type: pick };
  return foreign.length ? { ambiguous: foreign.map(d => d.pkg).sort() } : {};
}

/**
 * Is the class in the own process object (`OrderCard.CustomProcessStatus`)?
 * According to the import (`inProcessObject`) or according to the domain — then the
 * export writes it there and not to `schema/`.
 */
export function inProcessObject(t: TypeDef, model: Model | null, ownPkg: string): boolean {
  if (t.inProcessObject) return true;
  if (!isSchemaClass({ ...t, inProcessObject: false }) || !t.name?.trim()) return false;
  return (model?.domainTypes ?? []).some(d => !!d.owner && !!d.processName && d.pkg === ownPkg
    && (d.kind === 'case' || d.kind === 'enum') && d.name === `${d.owner}.${t.name}`);
}

/**
 * Packages every project sees without an import — the same as in the `-Yimports`
 * of the helper: `orchescala.domain` and the company library `<firma>.orchescala.domain`.
 */
export const isAutoImported = (pkg: string): boolean => pkg === 'orchescala.domain' || /^\w+\.orchescala\.domain$/.test(pkg);

const typeKey = (t: string): string => {
  const clean = t.replace(/\s+/g, ' ').trim();
  // `valiant.orchescala.domain.Iban` → `Iban`; composite types stay as they are
  return /^[\w.]+$/.test(clean) ? clean.split('.').pop()! : clean;
};

/**
 * @param home package of the own project (`valiant.product`) — for example values
 *             with the same name, the own project comes first after the company library.
 */
export function indexTypes(types: TypeDef[] = [], model: Model | null = null, home = '', ownPkg?: string): TypeIndex {
  const byId = new Map(types.map(t => [t.id, t]));
  // with the own package: the classes of other domains — imported, not created
  const referenced = new Map<string, DomainType>();
  if (ownPkg) for (const t of types) {
    const ref = referencedClass(t, model, ownPkg).type;
    if (ref) referenced.set(t.id, ref);
  }
  const serviceOf = (ref: string) => serviceTypeOf(ref, model);
  const domainOf = (ref: string) => domainTypeOf(ref, model);
  const nameOf = (ref: string): string => {
    if (isScalar(ref)) return ref;
    // A catalog type stays readable even without a loaded catalog
    if (parseDomainRef(ref)) return domainOf(ref)?.name ?? domainNameOf(ref);
    const svc = serviceOf(ref);
    if (svc) return svc.name;
    // a referenced class is named as in the catalog — `ResolveTimerDueDateWithOverwrite.DueDateSpec`
    return referenced.get(ref)?.name ?? byId.get(ref)?.name ?? ref;
  };
  // Precedence: company library (without import), own project, then the order of the catalog
  const rank = (d: DomainDefault) => (isAutoImported(d.pkg) ? 0 : home && d.pkg.startsWith(`${home}.`) ? 1 : 2);
  const ranked = (model?.domainDefaults ?? [])
    .map((d, i) => ({ d, i })).sort((a, b) => rank(a.d) - rank(b.d) || a.i - b.i).map(x => x.d);
  const defaults = ranked.filter(d => d.type);
  const defaultOf = (f: Field): DomainDefault | null => {
    if (!f.name?.trim() || f.enumCase) return null;
    const name = `default${f.name.charAt(0).toUpperCase()}${f.name.slice(1)}`;
    const wanted = typeKey(f.constraint?.trim() ? `${nameOf(f.type)} :| ${f.constraint.trim()}` : nameOf(f.type));
    return defaults.find(d => d.name === name && typeKey(d.type!) === wanted) ?? null;
  };
  return {
    byId,
    serviceOf,
    domainOf,
    defaultOf,
    nameOf,
    referenced,
    objectOf: (ref: string) => objectOf(ref, model),
    defaultNamed: (name: string) => ranked.find(d => d.name === name) ?? null,
    home,
    ownPkg: ownPkg ?? '',
  };
}

// ── Default ──────────────────────────────────────────────────────────────────
//
// The default of a field is FEEL if it starts with «=» — as everywhere in
// Orch Spec. On export it is evaluated and written to Scala according to the
// type of the field:
//
//   Seq[Int]            = [90, 110, 140]          → Seq(90, 110, 140)
//   Option[String]      = "CH"                    → Some("CH")
//   Long / BigDecimal   = 3                       → 3L / BigDecimal("3")
//   LocalDate           = date("2026-01-01")      → LocalDate.parse("2026-01-01")
//   Sprache (enum)      = "de"                    → Sprache.de
//   Adresse (class)     = {ort: "Bern"}           → Adresse(ort = "Bern", …)
//   Map[String, Int]    = {a: 1}                  → Map("a" -> 1)
//
// Without «=» the default stays what it was: a Scala expression, verbatim.

type FieldShape = Pick<Field, 'type' | 'optional' | 'collection' | 'map' | 'enumCase' | 'constraint'>;

class DefaultError extends Error {}

const isContext = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
  && !(v instanceof FeelDate) && !(v instanceof FeelDateTime) && !(v instanceof FeelDuration);
/** An identifier as written in Scala — in backticks if it is reserved or no plain name (see scalaName) */
const scalaIdent = (name: string) => scalaName(name);
const scalaString = (v: string) => JSON.stringify(v);

/**
 * A pure path in FEEL (`clientKeyDescr`, `processLabels.de`): FEEL does not know
 * the value, Scala does — it stays a reference. So the same rule applies
 * to default, example and description, without a list of exceptions.
 */
const FEEL_PATH = /^(?!(?:true|false|null)$)[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/;

/** The default as a Scala expression — or why that is not possible. Without a default: `{ scala: null }`. */
export function scalaDefault(f: Field, idx: TypeIndex): { scala: string | null; issue?: string } {
  const d = f.default?.trim();
  if (!d) return { scala: null };
  if (!d.startsWith('=')) return { scala: d };
  const body = d.slice(1).trim();
  if (!body) return { scala: null, issue: 'Nach «=» fehlt der FEEL-Ausdruck.' };
  if (FEEL_PATH.test(body)) return { scala: wrapExample(f, body) };
  let value: unknown;
  try {
    value = evaluate(body, {}).value;
  } catch {
    return { scala: null, issue: `Vorgabe «${d}» ist kein gültiges FEEL.` };
  }
  try {
    return { scala: feelToScala(value, f, idx) };
  } catch (e) {
    return { scala: null, issue: `Vorgabe «${d}»: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * ` = …` for the parameter list. A default that cannot be translated is not
 * taken over: `???` with a TODO containing the FEEL expression — the
 * project compiles, and the spot can be found. As a block comment because
 * the comma for the next field follows after it.
 */
function defaultClause(f: Field, idx: TypeIndex): string {
  const r = scalaDefault(f, idx);
  if (r.scala != null) return ` = ${r.scala}`;
  return r.issue ? ` = ??? /* TODO ${r.issue.replace(/\*\//g, '* /')} */` : '';
}

function feelToScala(v: unknown, f: FieldShape, idx: TypeIndex): string {
  if (v === null || v === undefined) {
    if (f.optional) return 'None';
    throw new DefaultError('null geht nur bei einem optionalen Feld.');
  }
  if (f.optional) return `Some(${feelToScala(v, { ...f, optional: false }, idx)})`;
  if (f.collection) {
    if (!Array.isArray(v)) throw new DefaultError('erwartet eine Liste, z. B. [1, 2].');
    return v.length ? `Seq(${v.map(x => feelToScala(x, { ...f, collection: false }, idx)).join(', ')})` : 'Seq.empty';
  }
  if (f.map) {
    if (!isContext(v)) throw new DefaultError('erwartet einen Kontext, z. B. {schluessel: 1}.');
    const entries = Object.entries(v).map(([k, x]) => `${scalaString(k)} -> ${feelToScala(x, { ...f, map: false }, idx)}`);
    return entries.length ? `Map(${entries.join(', ')})` : 'Map.empty';
  }
  return singleToScala(v, f, idx);
}

function singleToScala(v: unknown, f: FieldShape, idx: TypeIndex): string {
  const type = f.type;
  // a literal that has to satisfy a refinement needs `refineUnsafe` — as with the example
  const refined = (lit: string) => (f.constraint?.trim() ? `${lit}.refineUnsafe` : lit);
  const number = (what: string): number => {
    if (typeof v !== 'number') throw new DefaultError(`erwartet ${what}.`);
    return v;
  };
  if (isScalar(type)) {
    switch (type) {
      case 'String':
      case 'Iban':
        if (typeof v !== 'string') throw new DefaultError('erwartet einen Text in Anführungszeichen.');
        return refined(scalaString(v));
      case 'Iso8601Duration':
        if (v instanceof FeelDuration || typeof v === 'string') return scalaString(String(v));
        throw new DefaultError('erwartet eine Dauer, z. B. duration("PT1M") oder "PT1M".');
      case 'Boolean':
        if (typeof v !== 'boolean') throw new DefaultError('erwartet true oder false.');
        return String(v);
      case 'Int': {
        const n = number('eine ganze Zahl');
        if (!Number.isInteger(n)) throw new DefaultError('erwartet eine ganze Zahl.');
        return refined(String(n));
      }
      case 'Long': {
        const n = number('eine ganze Zahl');
        if (!Number.isInteger(n)) throw new DefaultError('erwartet eine ganze Zahl.');
        return refined(`${n}L`);
      }
      case 'Double': {
        const n = number('eine Zahl');
        return refined(Number.isInteger(n) ? `${n}.0` : String(n));
      }
      case 'BigDecimal':
        return `BigDecimal(${scalaString(String(number('eine Zahl')))})`;
      case 'LocalDate':
        if (v instanceof FeelDate || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v))) return `LocalDate.parse(${scalaString(String(v))})`;
        throw new DefaultError('erwartet ein Datum, z. B. date("2026-01-01").');
      case 'LocalDateTime': {
        const text = v instanceof FeelDateTime || typeof v === 'string' ? String(v) : '';
        if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(text)) return `LocalDateTime.parse(${scalaString(text)})`;
        throw new DefaultError('erwartet Datum und Zeit ohne Zeitzone, z. B. date and time("2026-01-01T08:00:00").');
      }
      // a point in time — with time zone or `Z` (UTC)
      case 'Instant': {
        const text = v instanceof FeelDateTime || typeof v === 'string' ? String(v) : '';
        if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(text)) return `Instant.parse(${scalaString(text)})`;
        throw new DefaultError('erwartet einen Zeitpunkt mit Zeitzone, z. B. date and time("2026-01-01T08:00:00Z").');
      }
    }
    throw new DefaultError(`für ${type} gibt es keine Übersetzung — ohne «=» als Scala-Ausdruck angeben.`);
  }
  const own = idx.byId.get(type);
  if (!own || f.enumCase) throw new DefaultError('für diesen Typ ohne «=» als Scala-Ausdruck angeben.');
  if (own.kind === 'enum') {
    if (isAdt(own)) throw new DefaultError('für eine Auswahl mit Fällen ohne «=» als Scala-Ausdruck angeben.');
    // an imported value may carry its backticks (`` `Ohne Angabe` ``) — FEEL names it without
    const values = (own.values ?? []).map(x => caseName(x.name)).filter(Boolean);
    if (typeof v !== 'string' || !values.includes(caseName(v))) throw new DefaultError(`erwartet einen Wert von ${own.name}: ${values.map(x => `"${x}"`).join(', ')}.`);
    return `${own.name}.${caseIdent(v)}`;
  }
  // a class from a context: missing optional fields are None
  if (!isContext(v)) throw new DefaultError(`erwartet einen Kontext für ${own.name}, z. B. {feld: 1}.`);
  const fields = finished(own.fields, idx);
  const unknown = Object.keys(v).filter(k => !fields.some(x => x.name === k));
  if (unknown.length) throw new DefaultError(`${own.name} hat kein Feld ${unknown.map(k => `«${k}»`).join(', ')}.`);
  const args = fields.flatMap(x => {
    if (x.name in v) return [`${x.name} = ${feelToScala(v[x.name], x, idx)}`];
    if (x.default?.trim()) return [];
    if (x.optional) return [`${x.name} = None`];
    throw new DefaultError(`für ${own.name} fehlt «${x.name}».`);
  });
  return `${own.name}(${args.join(', ')})`;
}

// ── Unfinished ───────────────────────────────────────────────────────────────
/**
 * A field only gets into the code once it is finished: with a name, with a type and —
 * for a custom type — one that still exists and has a name.
 * Otherwise `: String` or an internal id would be in the code, and the project
 * would not compile. The checks in the class builder keep reporting it.
 */
export function isFinished(f: Field, idx: TypeIndex): boolean {
  const type = f.type?.trim();
  if (!f.name?.trim() || !type) return false;
  return isScalar(type) || !!parseDomainRef(type) || !!parseServiceRef(type) || !!idx.byId.get(type)?.name?.trim()
    || isScalaTypeExpression(type)
    // a simple name with a type behind it — from the catalog or built in (`IdentityCorrelation`)
    || !!idx.domainOf(type);
}

/**
 * A Scala type from the domain that the app does not resolve — qualified
 * (`GetClient.Out`) or generic (`MockedServiceResponse[GetClient.Out]`):
 * it is taken over verbatim instead of missing from the export. A simple name
 * (`Adresse`) without a type behind it stays unfinished (see isFinished).
 */
export const isScalaTypeExpression = (type: string): boolean =>
  /^[A-Z]\w*(?:\.\w+)+$/.test(type) || /^[A-Z][\w.]*\[.+\]$/.test(type);

const finished = (fields: Field[] | undefined, idx: TypeIndex): Field[] => (fields ?? []).filter(f => isFinished(f, idx));

// ── Type expression ──────────────────────────────────────────────────────────
/** `Option[Seq[String :| ValidEmail]]` — nested in this order. */
export function fieldType(f: Field, idx: TypeIndex): string {
  let t = idx.nameOf(f.type);
  // a simple enum case is a singleton type (`ProcessStatus.canceled.type`), an ADT case a class
  if (f.enumCase) t = isSimpleEnum(f.type, idx) ? `${t}.${caseIdent(f.enumCase)}.type` : `${t}.${caseIdent(f.enumCase)}`;
  if (f.constraint?.trim()) t = `${t} :| ${f.constraint.trim()}`;
  if (f.map) t = `Map[String, ${t}]`;
  if (f.collection) t = `Seq[${t}]`;
  if (f.optional) t = `Option[${t}]`;
  return t;
}

// ── Example values ───────────────────────────────────────────────────────────
const SCALAR_EXAMPLE: Record<string, string> = {
  String: '"Beispiel"',
  Boolean: 'true',
  Int: '1',
  Long: '1L',
  Double: '1.0',
  BigDecimal: 'BigDecimal("100.00")',
  LocalDate: 'LocalDate.now()',
  LocalDateTime: 'LocalDateTime.now()',
  Instant: 'Instant.now()',
  Iso8601Duration: '"PT1M"',
  Iban: 'defaultIban',
};

/** Example value of a field — an explicit value beats the derivation. */
const LITERAL = /^(".*"|-?\d+(\.\d+)?L?)$/s;

/**
 * An explicit example with the wrapper of the field (`None`, `Some(…)`,
 * `Seq(a, b)`, `Seq.empty`, `Map(…)`) is already the whole value — that is how it comes
 * from the domain when it cannot be reduced to an inner value.
 */
function isWholeExample(f: Field, example: string): boolean {
  // `Option("…")` already is the wrapper — otherwise `Some(Option("…"))`
  if (f.optional) return /^(None\b|Some\s*\(|Option\s*\(|Option\.empty\b)/.test(example);
  if (f.collection) return /^(Seq|List|Vector|Set)\b/.test(example);
  if (f.map) return /^Map\b/.test(example);
  return false;
}

/** The wrapper of the field around an inner value: `Map("key" -> …)`, `Seq(…)`, `Some(…)` */
function wrapExample(f: FieldShape, inner: string): string {
  const mapped = f.map ? `Map("key" -> ${inner})` : inner;
  const seq = f.collection ? `Seq(${mapped})` : mapped;
  return f.optional ? `Some(${seq})` : seq;
}

/**
 * An example in FEEL (`= …`) as Scala — like the default (see
 * scalaDefault). A single value for a field with a wrapper (`= "CH"` for
 * `Seq[String]`) gets the wrapper like a Scala example; a list, a
 * context or `null` is already the whole value. No FEEL: `{ scala: null }`.
 */
export function scalaExample(f: Field, idx: TypeIndex): { scala: string | null; issue?: string } {
  const e = f.example?.trim();
  if (!e?.startsWith('=')) return { scala: null };
  const body = e.slice(1).trim();
  if (!body) return { scala: null, issue: 'Beispiel: nach «=» fehlt der FEEL-Ausdruck.' };
  if (FEEL_PATH.test(body)) return { scala: wrapExample(f, body) };
  let value: unknown;
  try {
    value = evaluate(body, {}).value;
  } catch {
    return { scala: null, issue: `Beispiel «${e}» ist kein gültiges FEEL.` };
  }
  try {
    return { scala: feelToScala(value, f, idx) };
  } catch (whole) {
    if (f.optional || f.collection || f.map) {
      try {
        return { scala: wrapExample(f, feelToScala(value, { ...f, optional: false, collection: false, map: false }, idx)) };
      } catch { /* not even as a single value — the whole one is reported */ }
    }
    return { scala: null, issue: `Beispiel «${e}»: ${whole instanceof Error ? whole.message : String(whole)}` };
  }
}

/**
 * An example without «=» for a text field: a text needs no
 * quotes (`rot` → `"rot"`). What looks like Scala stays Scala —
 * that is how it comes from the domain (see looksLikeScala).
 */
function textExample(f: Field, own: string): string {
  if (!['String', 'Iban'].includes(f.type) || f.enumCase) return own;
  return looksLikeScala(own, 'example') ? own : scalaString(own);
}

/**
 * Does a text look like Scala rather than prose? Following the conventions of the
 * domain: a literal (`"CH"`, `s"…${x}"`), a reference (`Defaults.street`,
 * `processLabels.de`, `UUID.randomUUID().toString`), a call
 * (`serviceOrProcessMockDescr(…)`) — and a single name only if it is named like
 * a value of the domain: `defaultClientKey` in the example, `clientKeyDescr`
 * in the description. `eBanking` or `www.example.ch` are text.
 */
export function looksLikeScala(text: string, kind: 'example' | 'description'): boolean {
  const t = text.trim();
  if (kind === 'example' ? /^(s|f|raw)?"/.test(t) : /^s".*\$/.test(t)) return true;
  if (kind === 'example' ? /^default[A-Z]\w*$/.test(t) : /^[a-z]\w*Descr$/.test(t)) return true;
  // also with backticks: `SubStatusKeyDocuments.\`documents-prepared\`.toString`
  return /^([A-Z]\w*|[a-z]+[A-Z]\w*)(\.(\w+|`[^`]+`)(\(\))?)+$/.test(t)
    || /^[A-Za-z_][\w.]*\(.*\)$/.test(t);
}

export function exampleValue(f: Field, idx: TypeIndex): string {
  const own = f.example?.trim();
  // FEEL: translated — otherwise the derived example with a TODO, so that it compiles
  if (own?.startsWith('=')) {
    const r = scalaExample(f, idx);
    if (r.scala != null) return r.scala;
    return `${exampleValue({ ...f, example: undefined }, idx)} /* TODO ${(r.issue ?? '').replace(/\*\//g, '* /')} */`;
  }
  if (own && isWholeExample(f, own)) return own;
  let inner = own ? textExample(f, own) : baseExample(f, idx);
  // A literal that has to satisfy a refinement needs `refineUnsafe`
  if (f.example?.trim() && f.constraint?.trim() && LITERAL.test(inner)) inner = `${inner}.refineUnsafe`;
  const mapped = f.map ? `Map("key" -> ${inner})` : inner;
  const seq = f.collection ? `Seq(${mapped})` : mapped;
  return f.optional ? `Some(${seq})` : seq;
}

function baseExample(f: Field, idx: TypeIndex): string {
  // a variant: its companion has its own example
  if (f.enumCase) {
    return isSimpleEnum(f.type, idx)
      ? `${idx.nameOf(f.type)}.${caseIdent(f.enumCase)}`
      : `${idx.nameOf(f.type)}.${caseIdent(f.enumCase)}.example`;
  }
  // `clientKey = defaultClientKey` — as the projects do by hand
  const fromDomain = idx.defaultOf(f);
  if (fromDomain) return fromDomain.name;
  // a simple enum from the catalog does not always have an example — its first case
  const domEnum = idx.domainOf(f.type);
  if (domEnum && isSimpleEnum(f.type, idx) && domEnum.values?.length) return `${domEnum.name}.${caseIdent(domEnum.values[0])}`;
  if (parseDomainRef(f.type)) return `${idx.nameOf(f.type)}.example`;
  const svc = idx.serviceOf(f.type);
  if (svc) return `${svc.name}.example`;
  if (isScalar(f.type)) {
    const v = SCALAR_EXAMPLE[f.type] ?? '???';
    // A refinement needs a refineUnsafe for string literals
    return f.constraint?.trim() && f.type === 'String' ? `${v}.refineUnsafe` : v;
  }
  const t = idx.byId.get(f.type);
  if (!t) return '???';
  if (t.kind === 'enum' && !isAdt(t)) return `${t.name}.${t.values?.[0]?.name ?? 'example'}`;
  return `${t.name}.example`;
}

// ── Case Class ───────────────────────────────────────────────────────────────
const indent = (text: string, by = '  ') =>
  text.split('\n').map(l => (l ? by + l : l)).join('\n');

function descriptionLine(text: string): string {
  const clean = text.trim();
  if (!clean) return '';
  if (!clean.includes('\n')) return `@description(${scalaKey(clean)})`;
  // the first line stands after `"""`, the others with `|` below it — in
  // `"""…"""` nothing is escaped
  const [first, ...rest] = clean.split('\n');
  const lines = rest.map(l => `  |${tripleText(l, clean)}`).join('\n');
  return `@description(\n  ${tripleOpen(clean)}${tripleText(first, clean)}\n${lines ? `${lines}\n` : ''}  |""".stripMargin\n)`;
}

const escape = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
/**
 * A value from Scala in the text (`valiant-cancel-${SignalEvent.Dynamic_ProcessInstance}`,
 * `… ${OrderCard.processName} …`): then the literal is interpolated (`s"…"`) —
 * otherwise the placeholder would be in it verbatim, and e.g. no signal would arrive.
 * Only if every `${…}` is a path: `${execution.processInstanceId}` (JUEL
 * in the text) stays text. This does not apply in comments — there it stays as it is.
 */
export function interpolated(text: string): boolean {
  const refs = [...text.matchAll(/\$\{([^}]*)\}/g)].map(m => m[1].trim());
  return refs.length > 0 && refs.every(r => /^[A-Za-z_][\w.]*$/.test(r) && !/^execution\b/.test(r));
}
/** A single `$` in an `s"…"` is written `$$` */
const dollars = (text: string) => text.replace(/\$(?!\{)/g, '$$$$');
/** A text as a Scala literal — interpolated where it names values from Scala (see interpolated) */
export const scalaKey = (text: string): string => (interpolated(text) ? `s"${dollars(escape(text))}"` : `"${escape(text)}"`);
/** Multi-line: `"""…"""` or `s"""…"""` — nothing is escaped in it */
const tripleOpen = (text: string) => (interpolated(text) ? 's"""' : '"""');
const tripleText = (text: string, all: string) => (interpolated(all) ? dollars(text) : text);

/**
 * The description of a field in FEEL (`= …`) as text — like the example,
 * except that a text must come out at the end; a pure path (`= clientKeyDescr`)
 * stays a reference (`expr`). No FEEL: `{ text: null }`.
 */
export function feelDescription(f: Field): { text: string | null; expr?: string; issue?: string } {
  const d = f.description?.trim();
  if (!d?.startsWith('=')) return { text: null };
  const body = d.slice(1).trim();
  if (!body) return { text: null, issue: 'Beschreibung: nach «=» fehlt der FEEL-Ausdruck.' };
  if (FEEL_PATH.test(body)) return { text: null, expr: body };
  let value: unknown;
  try {
    value = evaluate(body, {}).value;
  } catch {
    return { text: null, issue: `Beschreibung «${d}» ist kein gültiges FEEL.` };
  }
  if (typeof value === 'string') return { text: value };
  return { text: null, issue: `Beschreibung «${d}» ergibt keinen Text.` };
}

/**
 * `@description` of a field — an expression from the domain (`clientKeyDescr`)
 * stays one, FEEL becomes text; what cannot be translated is there
 * with a TODO.
 */
function fieldDescription(f: Field): string {
  const expr = f.descriptionExpr?.trim();
  if (expr) return `@description(${expr})`;
  if (!f.description) return '';
  const feel = feelDescription(f);
  if (feel.expr) return `@description(${feel.expr})`;
  if (feel.text != null) return descriptionLine(feel.text);
  if (feel.issue) return `@description("TODO ${escape(feel.issue)}")`;
  return descriptionLine(f.description);
}

/** Description of a type as Scaladoc — `@description` only applies to fields. */
function scaladoc(text: string): string {
  const lines = text.trim().split('\n');
  return lines.length === 1 ? `/** ${lines[0]} */` : `/**\n${lines.map(l => ` * ${l}`).join('\n')}\n */`;
}

/**
 * `inConfig: Option[InConfig] = None` — as in Orchescala (`bpmnDsl.md`): the
 * default `None` is in the class, in `example` and `exampleMinimal` the field is missing.
 */
const isInConfigField = (f: Field, idx: TypeIndex) =>
  f.name === 'inConfig' && /^Option\[(?:[\w.]+\.)?InConfig\]$/.test(fieldType(f, idx));

/** The fields of the example — without `inConfig` (see above), unless it has its own (`Some(InConfig.example)`) */
const exampleFields = (fields: Field[], idx: TypeIndex) =>
  fields.filter(f => !isInConfigField(f, idx) || !!f.example?.trim() && f.example.trim() !== 'None');

function caseClass(t: TypeDef, idx: TypeIndex): string {
  const fields = finished(t.fields, idx);
  const params = fields.map(f => {
    const d = fieldDescription(f) ? `${fieldDescription(f)}\n` : '';
    // a fixed enum case has exactly one value; InitIn initializes process variables — defaults as in the InConfig
    const fixed = fixedCaseValue(f, idx);
    const def = fixed ? ` = ${fixed}` : isInConfigField(f, idx) ? ' = None' : t.initIn ? defaultClause(f, idx) || (f.optional ? ' = None' : '') : '';
    return `${d}${scalaName(f.name)}: ${fieldType(f, idx)}${def}`;
  });
  const body = params.length ? `\n${indent(params.join(',\n'), '    ')}\n` : '';
  return `case class ${t.name}(${body})`;
}

function companion(t: TypeDef, idx: TypeIndex): string {
  const fields = exampleFields(finished(t.fields, idx), idx);
  const args = fields.map(f => `${scalaName(f.name)} = ${exampleValue(f, idx)}`);
  // exampleMinimal leaves out everything that may be missing
  const optional = fields.filter(f => f.optional);
  const minimal = optional.length
    ? `lazy val exampleMinimal = example.copy(\n${indent(optional.map(f => `${scalaName(f.name)} = None`).join(',\n'), '    ')}\n  )`
    : 'lazy val exampleMinimal = example';

  return [
    `object ${t.name}:`,
    `  given ApiSchema[${t.name}]  = deriveApiSchema`,
    `  given InOutCodec[${t.name}] = deriveInOutCodec`,
    '',
    args.length
      ? `  lazy val example = ${t.name}(\n${indent(args.join(',\n'), '    ')}\n  )`
      : `  lazy val example = ${t.name}()`,
    `  ${minimal}`,
    `end ${t.name}`,
  ].join('\n');
}

/** Parameter list of a class or of an ADT case. */
function paramList(fields: Field[], idx: TypeIndex, by: string): string {
  const params = fields.map(f => {
    const d = fieldDescription(f) ? `${fieldDescription(f)}\n` : '';
    return `${d}${scalaName(f.name)}: ${fieldType(f, idx)}${isInConfigField(f, idx) ? ' = None' : ''}`;
  });
  return params.length ? `\n${indent(params.join(',\n'), by)}\n` : '';
}

/**
 * The fields of a case: its own in the order of Orch Spec (they can be reordered
 * there), the shared ones in between at their place in the code (`order`) — those without `order`
 * first. An own field that is not listed there takes the place of a name that no
 * longer exists (renamed); otherwise it counts as new, after the others.
 */
export function inCodeOrder(common: Field[], own: Field[], order: string[] | undefined): Field[] {
  if (!order?.length) return [...common, ...own];
  const pos = new Map(order.map((n, i) => [n, i] as const));
  const names = new Set([...common, ...own].map(f => f.name));
  const free = order.filter(n => !names.has(n)).map(n => pos.get(n)!);
  let k = 0;
  const ownAt = new Map(own.map(f => [f.name, pos.get(f.name) ?? (k < free.length ? free[k++] : Infinity)] as const));
  const commonAt = (f: Field) => pos.get(f.name) ?? -1;
  const out: Field[] = [...own];
  for (const c of [...common].sort((a, b) => commonAt(a) - commonAt(b))) {
    const at = out.findIndex(e => (ownAt.has(e.name) ? ownAt.get(e.name)! : commonAt(e)) > commonAt(c));
    out.splice(at < 0 ? out.length : at, 0, c);
  }
  return out;
}

/**
 * Choice with fields per case — like `enum In` of the depot domain: each case
 * a class, the companion with an `example` per case and one for the type.
 */
function adtDef(t: TypeDef, idx: TypeIndex): string {
  const cases = (t.values ?? []).filter(v => v.name);
  const first = cases[0] ? caseIdent(cases[0].name) : 'unknown';
  // Shared fields: required as `def` in the body, first in every case
  const common = finished(t.fields, idx);
  // The meaning of a shared field is stated **once** — on the `def`, not
  // again in every case
  const commonDefs = common.map(f => {
    const d = fieldDescription(f) ? `${indent(fieldDescription(f), '  ')}\n` : '';
    return `${d}  def ${scalaName(f.name)}: ${fieldType(f, idx)}`;
  });
  const commonBare = common.map(f => ({ ...f, description: undefined, descriptionExpr: undefined }));
  const fieldsOf = (v: EnumValue): Field[] =>
    inCodeOrder(commonBare, finished(v.fields, idx).filter(f => !common.some(c => c.name === f.name)), v.order);
  const caseLines = cases.map(v => {
    const d = v.description ? `${indent(descriptionLine(v.description), '  ')}\n` : '';
    const fields = fieldsOf(v);
    return fields.length ? `${d}  case ${caseIdent(v.name)}(${paramList(fields, idx, '      ')}  )` : `${d}  case ${caseIdent(v.name)}`;
  });
  const companions = cases.filter(v => fieldsOf(v).length).map(v => {
    const fields = exampleFields(fieldsOf(v), idx);
    const args = fields.map(f => `${scalaName(f.name)} = ${exampleValue(f, idx)}`);
    const optional = fields.filter(f => f.optional);
    const minimal = optional.length
      ? `lazy val exampleMinimal = example.copy(\n${indent(optional.map(f => `${scalaName(f.name)} = None`).join(',\n'), '      ')}\n    )`
      : 'lazy val exampleMinimal = example';
    return [
      `  object ${caseIdent(v.name)}:`,
      args.length
        ? `    lazy val example: ${t.name}.${caseIdent(v.name)} = ${t.name}.${caseIdent(v.name)}(\n${indent(args.join(',\n'), '      ')}\n    )`
        : `    lazy val example: ${t.name}.${caseIdent(v.name)} = ${t.name}.${caseIdent(v.name)}()`,
      `    ${minimal}`,
      `  end ${caseIdent(v.name)}`,
    ].join('\n');
  });
  return [
    `enum ${t.name}:`,
    ...(commonDefs.length ? [...commonDefs, ''] : []),
    ...caseLines,
    `end ${t.name}`,
    '',
    `object ${t.name}:`,
    `  given ApiSchema[${t.name}]  = deriveApiSchema`,
    `  given InOutCodec[${t.name}] = deriveInOutCodec`,
    ...(companions.length ? ['', companions.join('\n\n')] : []),
    '',
    `  lazy val example = ${cases[0] && fieldsOf(cases[0]).length ? `${first}.example` : `${t.name}.${first}`}`,
    `end ${t.name}`,
  ].join('\n');
}

function enumDef(t: TypeDef, idx: TypeIndex): string {
  const cases = (t.values ?? []).map(v => v.name).filter(Boolean);
  const first = cases[0] ?? 'unknown';
  // Cases that appear somewhere as a fixed type (`X.fall.type`) need their own givens
  const fixed = fixedCasesOf(t.id, idx).filter(c => cases.includes(c));
  return [
    `enum ${t.name}:`,
    `  case ${cases.length ? cases.map(caseIdent).join(', ') : 'unknown'}`,
    '',
    `object ${t.name}:`,
    `  given ApiSchema[${t.name}]  = deriveEnumApiSchema`,
    ...fixed.map(c => `  given ApiSchema[${t.name}.${caseIdent(c)}.type] = deriveEnumApiSchema`),
    `  given InOutCodec[${t.name}] = deriveEnumInOutCodec`,
    ...fixed.map(c => `  given InOutCodec[${t.name}.${caseIdent(c)}.type] = deriveEnumValueInOutCodec`),
    '',
    `  lazy val example = ${t.name}.${caseIdent(first)}`,
    `end ${t.name}`,
  ].join('\n');
}

/** A type as Scala source code (without package/imports). */
export function renderType(t: TypeDef, idx: TypeIndex): string {
  const head = t.description ? `${scaladoc(t.description)}\n` : '';
  return t.kind === 'enum'
    ? `${head}${isAdt(t) ? adtDef(t, idx) : enumDef(t, idx)}`
    : `${head}${caseClass(t, idx)}\n\n${companion(t, idx)}`;
}

// ── Interactions ─────────────────────────────────────────────────────────────
//
// Each interaction becomes its own object with the matching DSL trait; `In`
// and `Out` live in it, not in `schema/`. If a type is missing, it says
// `NoInput` — just as the domain writes it too.
/**
 * The Scala name behind an alias of In or Out (see Interaction.inAlias):
 * `OrderCardUT.In` — the member of another interaction or a type of the domain.
 */
export function aliasName(ref: string | undefined, spec: ProcessSpec, idx: TypeIndex): string | null {
  if (!ref?.trim()) return null;
  if (ref.startsWith(DOMAIN_PREFIX)) return idx.domainOf(ref)?.name ?? null;
  const dot = ref.lastIndexOf('.');
  const other = (spec.interactions ?? []).find(i => i.id === ref.slice(0, dot));
  return other?.name ? `${other.name}.${ref.slice(dot + 1)}` : null;
}

/** `X.example` with differing values: `X.example.copy(a = false)` */
const withCopy = (expr: string, values: Record<string, string> | undefined): string => {
  const entries = Object.entries(values ?? {}).filter(([k, v]) => k.trim() && v.trim());
  return entries.length ? `${expr}.copy(${entries.map(([k, v]) => `${k} = ${v.trim()}`).join(', ')})` : expr;
};

export function renderInteraction(ia: Interaction, spec: ProcessSpec, idx: TypeIndex): string {
  const meta = INTERACTION_META[ia.kind];
  const types = spec.types ?? [];
  const typeOf = (id: string | undefined) => types.find(t => t.id === id) ?? null;
  const inType = typeOf(ia.inTypeId);
  const outType = meta.hasOut ? typeOf(ia.outTypeId) : null;

  const lines: string[] = [];
  if (ia.descr) lines.push(scaladoc(ia.descr));
  lines.push(`object ${ia.name} extends ${meta.dsl}:`);
  lines.push('');
  lines.push(`  val ${meta.keyName} = ${scalaKey(ia.key ?? ia.name ?? '')}`);
  // the DSL requires `descr` (BpmnDsl) — empty if there is none
  lines.push(descrLine(ia));
  lines.push('');

  const member = (t: TypeDef | null, name: 'In' | 'Out') => {
    const values = name === 'In' ? ia.inExample : ia.outExample;
    // another type: `type In = OrderCardUT.In` — its example, with the differing values
    const alias = aliasName(name === 'In' ? ia.inAlias : ia.outAlias, spec, idx);
    if (alias) {
      lines.push(`  type ${name} = ${alias}`);
      lines.push('');
      return withCopy(`${alias}.example`, values);
    }
    if (!t) {
      lines.push(`  type ${name} = NoInput`);
      lines.push('');
      return `NoInput()`;
    }
    lines.push(indent(renderType({ ...t, name }, idx), '  '));
    lines.push('');
    return withCopy(`${name}.example`, values);
  };

  const inExpr = member(inType, 'In');
  let factory = meta.factory;
  let outExpr: string | null;
  if (ia.kind === 'decision') {
    // DMN Decision (Orchescala, BpmnDecisionDsl): the factory by the
    // result shape — a simple value is the one field of the Out
    const form = ia.decisionResult ?? 'singleResult';
    factory = form;
    const value = dmnValueField(outType);
    if ((form === 'singleEntry' || form === 'collectEntries') && value) {
      const bare = { ...value, optional: false, collection: false, map: false };
      lines.push(`  type Out = ${fieldType(bare, idx)}`);
      lines.push('');
      const ex = exampleValue(bare, idx);
      outExpr = form === 'collectEntries' ? `Seq(${ex})` : ex;
    } else {
      const ex = member(outType, 'Out');
      outExpr = form === 'resultList' ? `Seq(${ex})` : ex;
    }
  } else {
    outExpr = meta.hasOut ? member(outType, 'Out') : null;
  }

  lines.push(`  lazy val example = ${factory}(`);
  lines.push(`    ${inExpr}${outExpr ? `,\n    ${outExpr}` : ''}`);
  lines.push('  )');
  lines.push(`end ${ia.name}`);
  return lines.join('\n');
}

/** The one field of the Out of a DMN Decision that returns a simple value — otherwise null. */
function dmnValueField(out: TypeDef | null): Field | null {
  const fields = (out?.fields ?? []).filter(f => f.name?.trim());
  return out?.kind === 'case' && fields.length === 1 ? fields[0] : null;
}

/** Simple values of a DMN column (DmnValueType in Orchescala) — plus a choice (enum) */
const DMN_VALUE_TYPES = new Set(['String', 'Boolean', 'Int', 'Long', 'Double', 'LocalDate', 'LocalDateTime']);

/**
 * What a DMN Decision requires (Orchescala, BpmnDecisionDsl): every field of the
 * `In` is a simple value (a column of the table) — likewise those of the
 * `Out`; with `singleEntry` / `collectEntries` the `Out` has exactly one field.
 */
export function dmnIssues(ia: Interaction, types: TypeDef[]): string[] {
  if (ia.kind !== 'decision') return [];
  const byId = new Map(types.map(t => [t.id, t]));
  const simple = (f: Field) => !f.collection && !f.map
    && (DMN_VALUE_TYPES.has(f.type) || (byId.get(f.type)?.kind === 'enum' && !isAdt(byId.get(f.type)!)));
  const out: string[] = [];
  const check = (t: TypeDef | undefined, member: 'In' | 'Out') => {
    for (const f of (t?.fields ?? []).filter(x => x.name?.trim())) {
      if (!simple(f)) out.push(`${member}.${f.name}: in einer DMN geht nur ein einfacher Wert (String, Boolean, Int, Long, Double, LocalDate, LocalDateTime oder eine Auswahl).`);
    }
  };
  const inT = ia.inTypeId ? byId.get(ia.inTypeId) : undefined;
  const outT = ia.outTypeId ? byId.get(ia.outTypeId) : undefined;
  check(inT, 'In');
  check(outT, 'Out');
  const form = ia.decisionResult ?? 'singleResult';
  if ((form === 'singleEntry' || form === 'collectEntries') && outT && !dmnValueField(outT)) {
    out.push(`${form}: das Out ist ein einfacher Wert — es braucht genau ein Feld (sein Typ ist der Wert).`);
  }
  return out;
}

// ── InConfig and InitIn ──────────────────────────────────────────────────────
//
// Neither belongs in the specification — they follow from it:
//
//  · `InConfig` from the loops (timer, counter, maximum) and from every
//    step whose result can be overridden for tests (`…Mock`) —
//    plus the own adjustment knobs that the class builder maintains as the type
//    `inConfig`; they come first and win on equal names.
//  · `InitIn` from the outputs of the init worker — the step whose topic
//    is the process itself.
//
// That is why the generator creates them instead of having them entered.
const DEFAULT_BY_KIND: Record<'timer' | 'max' | 'counter', { type: string; value: string; descr: string }> = {
  timer:   { type: 'Iso8601Duration', value: '"PT1M"', descr: 'Wartezeit vor dem nächsten Versuch (ISO 8601).' },
  counter: { type: 'Int', value: '1', descr: 'Zähler der Versuche — mit `1` initialisieren.' },
  max:     { type: 'Int', value: '10', descr: 'Höchstzahl der Versuche.' },
};

export function renderInConfig(spec: ProcessSpec, imports: Set<string>, idx?: TypeIndex): string {
  const own = (spec.types ?? []).find(t => t.inConfig);
  const ownFields = own && idx ? finished(own.fields, idx) : [];
  const seen = new Set<string>(ownFields.map(f => f.name));
  if (own && idx) for (const l of importsOf(own, idx)) imports.add(l);
  const params: string[] = ownFields.map(f => {
    const d = fieldDescription(f) ? `${fieldDescription(f)}\n` : '';
    const fixed = fixedCaseValue(f, idx!);
    const def = fixed ? ` = ${fixed}` : defaultClause(f, idx!) || (f.optional ? ' = None' : '');
    return `${d}${scalaName(f.name)}: ${fieldType(f, idx!)}${def}`;
  });
  for (const { name, kind, default: given, timerKind } of loopSettings(spec)) {
    if (seen.has(name)) continue;
    seen.add(name);
    const d = DEFAULT_BY_KIND[kind];
    // a timer of an event: its default from the specification (`P7D`) — a
    // point in time or cycle is not a duration, so text
    const type = timerKind && timerKind !== 'duration' ? 'String' : d.type;
    const value = given ? JSON.stringify(given) : d.value;
    const descr = timerKind
      ? `${{ duration: 'Wartezeit', date: 'Zeitpunkt', cycle: 'Zyklus' }[timerKind]} des Timers (ISO 8601)${given ? '' : ' — Vorgabe prüfen'}.`
      : d.descr;
    params.push(`${descriptionLine(descr)}\n${name}: ${type} = ${value}`);
  }
  for (const step of mockableSteps(spec)) {
    // Only steps with a chosen mock. The type is the `Out` of the called
    // object or the service response — derived from the identifier, including the import.
    if (!step.mockKind) continue;
    const ref = step.serviceId ?? step.calledProcess ?? step.topic;
    if (!ref) continue;
    const { object, pkg, uncertain } = idx ? idx.objectOf(ref) : deriveObject(ref);
    const field = mockFieldOf(step);
    const importLine = `import ${pkg}.${object}${uncertain ? '  // Pfad prüfen' : ''}`;
    // an own field (from the domain) comes first — it needs the import if it names the object
    const ownField = ownFields.find(f => f.name === field);
    if (ownField && idx && fieldType(ownField, idx).includes(`${object}.`)) imports.add(importLine);
    if (seen.has(field)) continue;
    seen.add(field);
    imports.add(importLine);
    const type = step.mockKind === 'service' ? `MockedServiceResponse[${object}.ServiceOut]` : `${object}.Out`;
    // as in the projects: the description shows an example of the mock as JSON — for a
    // service the response from its `example` (every ServiceTask has it, `ServiceOut.mock` not always)
    const example = step.mockKind === 'service' ? `${object}.example.defaultServiceOutMock` : `${object}.Out.example`;
    params.push(`@description(serviceOrProcessMockDescr(${example}))\n`
      + `${field}: Option[${type}] = None`);
  }
  if (!params.length) return '';
  return [
    'case class InConfig(',
    indent(params.join(',\n'), '    '),
    ')',
    '',
    'object InConfig:',
    '  given ApiSchema[InConfig]  = deriveApiSchema',
    '  given InOutCodec[InConfig] = deriveInOutCodec',
    'end InConfig',
  ].join('\n');
}

/**
 * Default values are never in a class — only in the `InConfig`, where they are
 * configurations. For the `In` of the process a default only makes sense for an
 * **optional** field: the field stays `Option[…]`, and the init worker
 * sets the same field in the `InitIn` — mandatory there — to the value from the `In`
 * or the default:
 *
 *   In      debitAccountForFee: Option[Int]
 *   InitIn  debitAccountForFee: Int
 *   Worker  InitIn(debitAccountForFee = in.debitAccountForFee.getOrElse(90))
 */
export function defaultsForInit(spec: ProcessSpec, idx: TypeIndex): Field[] {
  const root = (spec.types ?? []).find(t => t.root && t.kind === 'case');
  return finished(root?.fields, idx)
    .filter(f => f.optional && f.default?.trim())
    .map(f => ({ ...f, optional: false }));
}

/** Where a default is used: in the InConfig, and for optional fields of the process input. */
export function defaultIsUsed(t: TypeDef, f: Field): boolean {
  return !!t.inConfig || !!t.initIn || (!!t.root && t.kind === 'case' && !!f.optional);
}

/**
 * `InitIn` — the fields follow from the outputs of the init worker, but the
 * **types** are not there. That is why the class builder creates a
 * type for it (`initIn`) that is edited like any other. Plus the
 * fields with a default from the `In` (see `defaultsForInit`).
 */
export function renderInitIn(spec: ProcessSpec, idx: TypeIndex): string {
  const t = (spec.types ?? []).find(t => t.initIn);
  const own = finished(t?.fields, idx);
  const fromIn = defaultsForInit(spec, idx).filter(f => !own.some(o => o.name === f.name));
  if (!own.length && !fromIn.length) return '';
  return renderType({ ...(t ?? { id: 'initIn', kind: 'case' as const }), name: 'InitIn', fields: [...own, ...fromIn] }, idx);
}

/**
 * What the init worker returns in `customInit` when the `In` has defaults —
 * the other fields of the InitIn are `???` until the worker sets them. `null`: no defaults.
 */
export function initInExpression(spec: ProcessSpec, idx: TypeIndex): string | null {
  const fromIn = defaultsForInit(spec, idx);
  if (!fromIn.length) return null;
  const own = finished((spec.types ?? []).find(t => t.initIn)?.fields, idx);
  const args = fromIn.map(f => {
    const r = scalaDefault(f, idx);
    const value = r.scala ?? `??? /* TODO ${(r.issue ?? '').replace(/\*\//g, '* /')} */`;
    return `  ${scalaName(f.name)} = in.${scalaName(f.name)}.getOrElse(${value})`;
  });
  // the worker computes the other fields of the InitIn — `???` instead of the example values:
  // so it fails until it is implemented
  const rest = own.filter(o => !fromIn.some(f => f.name === o.name))
    .map(o => `  ${o.name} = ??? /* TODO im InitWorker setzen */`);
  return `InitIn(\n${[...args, ...rest].join(',\n')}\n)`;
}

/**
 * `val descr` of an interaction: an expression from the domain verbatim, otherwise the
 * text — multi-line as `"""…""".stripMargin`, as usual in the domain.
 */
function descrLine(ia: Interaction): string {
  if (ia.descrExpr?.trim()) return `  val descr: String = ${ia.descrExpr.trim()}`;
  const text = (ia.descr ?? '').trim();
  if (!text.includes('\n')) return `  val descr: String = ${scalaKey(text)}`;
  const [first, ...rest] = text.split('\n');
  return [`  val descr: String =`, `    ${tripleOpen(text)}${tripleText(first, text)}`, ...rest.map(l => `      |${tripleText(l, text)}`), '      |""".stripMargin'].join('\n');
}

/** The description of the process for the helper: `// descr: erste Zeile`, then `// descr| …` per line. */
export function descrComment(text: string | undefined): string[] {
  const lines = (text ?? '').trim().split('\n').map(l => escape(l.trimEnd()));
  if (!lines[0]) return [];
  return [`// descr: ${lines[0]}`, ...lines.slice(1).map(l => (l ? `// descr| ${l}` : '// descr|'))];
}

// ── Files ────────────────────────────────────────────────────────────────────
export interface ScalaFile {
  /** Path relative to the project */
  path: string;
  content: string;
  /** true = insert into the existing process object, not as a new file */
  insert?: boolean;
  /** Bracket: the own block or event subprocess the interaction belongs to */
  section?: string;
}

// Only what the type really needs: Iron refinements and service objects
// bring their imports along, everything else Orchescala provides via the
// package export.
/** All fields of a type — for an ADT the shared ones and those of all cases. */
export function allFields(t: TypeDef): Field[] {
  return t.kind === 'enum' ? [...(t.fields ?? []), ...(t.values ?? []).flatMap(v => v.fields ?? [])] : (t.fields ?? []);
}

/**
 * The package lines of a file: split at `domain` — `package valiant.product.domain`
 * and `package lilaSet.v2` —, so that everything from `valiant.product.domain` is visible
 * without an import, as in the hand-written domain files. Without `domain` one line.
 */
export function packageClause(pkg: string): string {
  const parts = pkg.split('.');
  const at = parts.indexOf('domain');
  return at >= 0 && at < parts.length - 1
    ? `package ${parts.slice(0, at + 1).join('.')}\npackage ${parts.slice(at + 1).join('.')}`
    : `package ${pkg}`;
}

/** The package of the first package line (`valiant.product.domain`) — its content needs no import */
const domainStem = (pkg: string): string | null => {
  const parts = pkg.split('.');
  const at = parts.indexOf('domain');
  return at >= 0 && at < parts.length - 1 ? parts.slice(0, at + 1).join('.') : null;
};

export function importsOf(t: TypeDef, idx: TypeIndex): string[] {
  const lines: string[] = [];
  const fields = allFields(t).filter(f => isFinished(f, idx));
  if (fields.some(f => f.constraint?.trim())) {
    lines.push('import io.github.iltotore.iron.*', 'import io.github.iltotore.iron.constraint.all.*');
  }
  const external = new Map<string, string>(); // importPath → note
  for (const f of fields) {
    // the example value from another project needs its import — derived
    // (`clientKey` → `defaultClientKey`) or named in the example (`defaultValidUntil`)
    const d = f.example?.trim() ? null : idx.defaultOf(f);
    if (d && !isAutoImported(d.pkg)) external.set(`${d.pkg}.${d.name}`, '');
    // the objects of a description from the domain (`SendProcessEvent.processName`, `Escalation.*`)
    if (f.descriptionExpr) for (const i of f.descriptionImports ?? []) external.set(i, '');
    for (const name of f.example?.match(/\bdefault[A-Z]\w*/g) ?? []) {
      // from the domain: the import of its file — or none if the value was visible there without one
      if (f.exampleImports) {
        const own = f.exampleImports.filter(i => i.endsWith(`.${name}`));
        for (const i of own) external.set(i, '');
        // … except via nested packages (`package valiant.product` / `package domain`):
        // the export only splits the package line at `domain` (see packageClause) — a value
        // of the own project elsewhere needs the import (below it is dropped if visible)
        const named = own.length ? null : idx.defaultNamed(name);
        if (named && idx.home && (named.pkg === idx.home || named.pkg.startsWith(`${idx.home}.`))) external.set(`${named.pkg}.${named.name}`, '');
        continue;
      }
      // entered by hand: the value from the catalog
      const named = idx.defaultNamed(name);
      if (named && !isAutoImported(named.pkg)) external.set(`${named.pkg}.${named.name}`, '');
    }
    const dom = idx.domainOf(f.type);
    // what Orchescala brings along without an import (`ProcessStatus`) needs none
    if (dom) { if (!isAutoImported(dom.pkg)) external.set(dom.importPath, ''); continue; }
    // a class of another domain: imported there instead of created here
    const ref = idx.referenced.get(f.type);
    if (ref) { external.set(ref.importPath, ''); continue; }
    const svc = idx.serviceOf(f.type);
    if (svc) external.set(svc.importPath, svc.uncertain ? '  // Pfad prüfen — aus dem Service-Namen abgeleitet' : '');
  }
  // what lives directly in `valiant.product.domain` the file sees via its first package line
  const stem = domainStem(idx.ownPkg);
  for (const [path, note] of [...external.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (stem && path.slice(0, path.lastIndexOf('.')) === stem) continue;
    lines.push(`import ${path}${note}`);
  }
  return lines;
}

function imports(t: TypeDef, idx: TypeIndex): string {
  const lines = importsOf(t, idx);
  return lines.length ? `\n${lines.join('\n')}\n` : '\n';
}

/**
 * Package path from project and process name: `globex.savings.domain.openSavings.v1`.
 *
 * If the process name carries no version and only repeats the project
 * (`globex-ordercard`), its last segment remains — a
 * hyphen would not be allowed in a package name.
 */
export function packageOf(spec: ProcessSpec, model: Model | null = null): string {
  const echt = domainHome(spec, model);
  if (echt) return echt.pkg;
  const project = (spec.project ?? '').split('-').filter(Boolean);
  const bare = spec.project && spec.name.startsWith(`${spec.project}-`)
    ? spec.name.slice(spec.project.length + 1)
    : spec.name;
  const m = /^([A-Za-z][A-Za-z0-9]*?)V(\d+)$/.exec(bare);
  const parts = bare.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const proc = m
    ? m[1]
    : parts.length > 1 && parts.join('-') === (spec.project ?? '')
      ? parts[parts.length - 1]
      : parts.map((x, i) => (i === 0 ? x : x.replace(/^(.)/, c => c.toUpperCase()))).join('') || 'process';
  const version = m ? `v${m[2]}` : 'v1';
  return [...project, 'domain', proc, version].join('.');
}

/**
 * Where this process really lives in the domain — recognizable by the
 * `val processName` of its object. Without a catalog entry only the
 * derivation from the process ID remains, and that is a guess:
 * `globex-ordercard` yields `ordercard`, but in the domain the
 * package is called `orderCard`.
 */
function domainHome(spec: ProcessSpec, model: Model | null): { pkg: string; object: string } | null {
  const id = spec.processId ?? spec.name;
  const treffer = (model?.domainTypes ?? []).find(t => t.processName === id && t.owner);
  return treffer ? { pkg: treffer.pkg, object: treffer.owner! } : null;
}

/** The Scala name of the process object: `OpenSavingsV1`, `OrderCard`. */
export function processObject(spec: ProcessSpec, model: Model | null = null): string {
  const echt = domainHome(spec, model);
  if (echt) return echt.object;
  const teil = packageOf(spec).split('.');
  const proc = teil[teil.length - 2] ?? spec.name;
  // without version — that is in the package (`openSavings.v1` → `OpenSavings`)
  return proc.replace(/^(.)/, c => c.toUpperCase());
}

function srcDir(spec: ProcessSpec, model: Model | null): string {
  return `01-domain/src/main/scala/${packageOf(spec, model).replace(/\./g, '/')}`;
}

/** Package of the own project: `valiant-product` → `valiant.product`. */
export const homeOf = (spec: ProcessSpec): string => (spec.project ?? '').split('-').filter(Boolean).join('.');

/** The imports of an interaction — those of its `In` and `Out` (catalog types, example values). */
function interactionImports(ia: Interaction, spec: ProcessSpec, idx: TypeIndex, pkg: string): string {
  const typeOf = (id: string | undefined) => (spec.types ?? []).find(t => t.id === id);
  // an alias does not need the fields — only its object, if it lives elsewhere
  const aliasImport = (ref: string | undefined): string[] => {
    const d = ref?.startsWith(DOMAIN_PREFIX) ? idx.domainOf(ref) : null;
    const owner = d ? d.owner ?? d.name.split('.')[0] : null;
    return d && owner && d.pkg !== pkg ? [`import ${d.pkg}.${owner}`] : [];
  };
  const lines = [...new Set([
    ...(ia.inAlias ? aliasImport(ia.inAlias) : typeOf(ia.inTypeId) ? importsOf(typeOf(ia.inTypeId)!, idx) : []),
    ...(ia.outAlias ? aliasImport(ia.outAlias) : typeOf(ia.outTypeId) ? importsOf(typeOf(ia.outTypeId)!, idx) : []),
    // the objects in a `descr` expression
    ...(ia.descrExpr ? (ia.descrImports ?? []).map(i => `import ${i}`) : []),
  ])];
  return lines.length ? `\n${lines.join('\n')}\n` : '';
}

/** All files that result from the data model. */
export function scalaFiles(spec: ProcessSpec, model: Model | null = null): ScalaFile[] {
  const types = spec.types ?? [];
  if (!types.length && !(spec.interactions ?? []).length) return [];
  const pkg = packageOf(spec, model);
  const idx = indexTypes(types, model, homeOf(spec), pkg);
  const dir = srcDir(spec, model);
  const out: ScalaFile[] = [];

  // Process object in the order of the domain: In, InitIn, InConfig, Out —
  // then whatever else is in the object (`enum CustomProcessStatus`)
  const objectName = processObject(spec, model);
  const processParts: string[] = [];
  const processImports = new Set<string>();
  const member = (t: TypeDef, name = t.name) => {
    for (const l of importsOf(t, idx)) processImports.add(l);
    processParts.push(indent(renderType({ ...t, name }, idx)));
  };
  for (const t of types.filter(t => t.root)) member(t, 'In');
  const initIn = renderInitIn(spec, idx);
  if (initIn) processParts.push(indent(initIn));
  // the own fields of the InitIn bring their imports along — those from the In the In already has
  const initInType = types.find(t => t.initIn);
  if (initIn && initInType) for (const l of importsOf(initInType, idx)) processImports.add(l);
  const inConfig = renderInConfig(spec, processImports, idx);
  if (inConfig) processParts.push(indent(inConfig));
  for (const t of types.filter(t => t.processOut && !t.root)) member(t, 'Out');
  // what is in the process object itself — there, not in schema/
  const inObject = (t: TypeDef) => inProcessObject(t, model, pkg);
  for (const t of types.filter(t => inObject(t) && t.name?.trim())) member(t);
  const customInit = initInExpression(spec, idx);
  // the pattern «Prozess-Bezeichnung» — without values there is nothing to write
  const labels = spec.processLabels?.de?.trim() || spec.processLabels?.fr?.trim() ? spec.processLabels : undefined;

  if (processParts.length) {
    out.push({
      path: `${dir}/${objectName}.scala`,
      insert: true,
      content: [
        ...(processImports.size
          ? ['// oben in der Datei ergänzen:', ...[...processImports].map(l => `// ${l}`), '']
          : []),
        // belongs in the worker, not in the domain — the helper inserts it there
        ...(customInit
          ? ['// im InitWorker (customInit):', ...customInit.split('\n').map(l => `// ${l}`), '']
          : []),
        // for a new process object — an existing one keeps its `descr`
        // the whole description: the first line `// descr: …`, every further one `// descr| …`
        // (an older helper only reads the first)
        ...descrComment(spec.description),
        ...(labels ? [`// processLabels: ${escape(labels.de)} | ${escape(labels.fr)}`] : []),
        ...(spec.description?.trim() || labels ? [''] : []),
        `// in object ${objectName} einfügen`,
        '// (InConfig und InitIn werden aus dem Ablauf erzeugt — nicht von Hand pflegen)',
        '',
        processParts.join('\n\n'),
      ].join('\n'),
    });
  }

  // One file per interaction. The same signal at two places in the
  // flow is **one** object — otherwise the file would appear twice in the export.
  // First the main flow, then a bracket per own block or event subprocess
  // — the same as in the tree and in the data model.
  const blocks = blockIndex(spec.steps);
  const sectionOf = (ia: Interaction): string | undefined => {
    const ref = blocks.get(ia.stepId);
    if (!ref) return undefined;
    return ref.eventSub ? `Ereignis-Subprozess «${ref.head.name}»` : `Eigener Block «${ref.head.name}» — ${blockStart(ref.head)}`;
  };
  const geschrieben = new Set<string>();
  const sorted = [...(spec.interactions ?? [])].map((ia, i) => ({ ia, i, section: sectionOf(ia) }))
    .sort((a, b) => (a.section ? 1 : 0) - (b.section ? 1 : 0) || (a.section ?? '').localeCompare(b.section ?? '') || a.i - b.i);
  // an interaction whose step is no longer in the flow does not get into the code
  const stepIds = new Set(allSteps(spec.steps).map(s => s.id));
  for (const { ia, section } of sorted) {
    // without a name there would be `object  extends …` — only once it has one
    if (!ia.name?.trim() || geschrieben.has(ia.name) || !stepIds.has(ia.stepId)) continue;
    // already in another domain (other process, other project): referenced —
    // not created anew, otherwise the helper would create object and worker a second time
    if (interactionOrigin(ia, model, pkg).foreign) continue;
    geschrieben.add(ia.name);
    out.push({
      path: `${dir}/${ia.name}.scala`,
      content: `${packageClause(pkg)}\n${interactionImports(ia, spec, idx, pkg)}\n${section ? `// ${section}\n` : ''}${renderInteraction(ia, spec, idx)}\n`,
      ...(section ? { section } : {}),
    });
  }

  // a class of another domain is imported (see importsOf), not created
  for (const t of types.filter(t => t.name?.trim() && isSchemaClass(t) && !inObject(t) && !idx.referenced.has(t.id))) {
    out.push({
      path: `${dir}/schema/${t.name}.scala`,
      content: `${packageClause(`${pkg}.schema`)}\n${imports(t, idx)}\n${renderType(t, idx)}\n`,
    });
  }
  return out;
}

/** All files as one text — for checking, copying and for the AI. */
export function scalaBundle(spec: ProcessSpec, model: Model | null = null): string {
  const files = scalaFiles(spec, model);
  if (!files.length) return '// Noch kein Datenmodell — im Klassenbauer anlegen.';
  // Bracket: a heading as soon as an own block begins — and again
  // one when the shared classes (schema/) follow afterwards
  let section: string | undefined;
  return files.map(f => {
    const head = f.section !== section ? `// ${'═'.repeat(72)}\n// ${f.section ?? 'Gemeinsame Klassen'}\n// ${'═'.repeat(72)}\n\n` : '';
    section = f.section;
    return `${head}// ${'─'.repeat(72)}\n// ${f.path}${f.insert ? '  (in die bestehende Datei einfügen)' : ''}\n// ${'─'.repeat(72)}\n\n${f.content}`;
  }).join('\n\n');
}

// ── Checks ───────────────────────────────────────────────────────────────────
export interface TypeIssue {
  typeId: string; field?: string; message: string;
  /** a hint, not a defect — shown amber, does not mark the type as faulty */
  warn?: boolean;
  /** a better name, to take over with one click — for the field, the type or the enum value `value` */
  suggestion?: string;
  /** the enum value the suggestion is for */
  value?: string;
}

/**
 * A plain Scala name from what was typed: `Mein value` → `meinValue` (field),
 * `meine Klasse` → `MeineKlasse` (type), `ONLY GAMIFICATION` → `ONLY_GAMIFICATION`
 * (enum value in capitals), `Ohne Angabe` → `OhneAngabe`. `undefined` if none
 * is better (e.g. `type` — a word, but reserved).
 */
export function nameSuggestion(kind: 'field' | 'type' | 'value', raw: string): string | undefined {
  const name = raw.replace(/^`|`$/g, '');
  const words = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (!words.length) return undefined;
  const pascal = words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
  const lowerFirst = pascal.charAt(0).toLowerCase() + pascal.slice(1);
  const out = kind === 'type' ? pascal
    : kind === 'field' ? lowerFirst
      : words.every(w => w === w.toUpperCase()) ? words.join('_')
        : /^[a-z]/.test(words[0]) ? lowerFirst : pascal;
  return out !== name && /^[A-Za-z_]\w*$/.test(out) && !/^\d/.test(out) && !RESERVED.has(out) ? out : undefined;
}

const SCALA_NAME = /^[a-z][A-Za-z0-9]*$/;
/** a line break or other control character — a name in backticks ends on its line */
const CONTROL = /[\u0000-\u001f\u007f]/;
const TYPE_NAME = /^[A-Z][A-Za-z0-9]*$/;
/**
 * A field name as written in Scala: a reserved word (`type`) or a name that is
 * no plain identifier goes in backticks — the domain writes it so, the import
 * reads it without them.
 */
export function scalaName(name: string): string {
  return RESERVED.has(name) || !/^[A-Za-z_]\w*$/.test(name) ? `\`${name}\`` : name;
}

const RESERVED = new Set(['type', 'val', 'var', 'def', 'class', 'object', 'case', 'match', 'new', 'with', 'given', 'end', 'for', 'if', 'else', 'true', 'false', 'null', 'import', 'package', 'extends', 'lazy', 'implicit', 'private', 'sealed', 'trait', 'enum', 'then', 'do', 'while', 'yield', 'return', 'this', 'super', 'try', 'catch', 'finally', 'throw', 'abstract', 'final', 'override', 'protected', 'forSome']);

/** What would break the generated Scala code — directly in the UI. */
/** The cases of a choice with fields (own or from the catalog) — null if the type is not one. */
export function casesOf(typeRef: string, idx: TypeIndex): string[] | null {
  // ADT case = own class, simple case = singleton type — both selectable
  const own = idx.byId.get(typeRef);
  if (own) return own.kind === 'enum' ? (own.values ?? []).map(v => v.name).filter(Boolean) : null;
  const dom = idx.domainOf(typeRef);
  if (dom) return dom.kind === 'enum' && dom.values?.length ? dom.values.slice() : null;
  return null;
}

/** An enum without fields — its cases are values, not an ADT. */
export function isSimpleEnum(typeRef: string, idx: TypeIndex): boolean {
  const own = idx.byId.get(typeRef);
  if (own) return own.kind === 'enum' && !isAdt(own);
  const dom = idx.domainOf(typeRef);
  return !!dom && dom.kind === 'enum' && !dom.cases?.length && !dom.fields?.length;
}

/** Name of a case without backticks — as it appears in `values`. */
export const caseName = (c: string): string => c.replace(/^`|`$/g, '');
/** A case as a Scala identifier: `canceled`, but `` `output-mocked` `` */
const caseIdent = (c: string): string => scalaIdent(caseName(c));

/**
 * The value of a fixed enum case (`ProcessStatus.canceled`) — it is the
 * default of the field, since the type allows no other. Only a single
 * value (not multiple, no map); optional stays without a default (`None`).
 */
export function fixedCaseValue(f: Field, idx: TypeIndex): string | null {
  if (!f.enumCase || f.collection || f.map || f.optional || !isSimpleEnum(f.type, idx)) return null;
  return `${idx.nameOf(f.type)}.${caseIdent(f.enumCase)}`;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Rename the value or case `index` of the enum `typeId` — and the fields that use it
 * as a fixed case (`enumCase`) or name it in a default or example, so that they keep pointing to it.
 */
export function renameEnumValue(types: TypeDef[], typeId: string, index: number, name: string): TypeDef[] {
  const en = types.find(t => t.id === typeId);
  const old = en?.values?.[index]?.name;
  if (en == null || old == null) return types;
  // only to a name that can be written and is still free
  const bad = !name.trim() || name !== name.trim() || name.includes('`') || CONTROL.test(name);
  if (bad || en.values!.some((v, k) => k !== index && caseName(v.name) === name)) return types;
  // a default or example naming the value: FEEL (`= "ONLY GAMIFICATION"`) or Scala (`ReceivingSystem.\`ONLY GAMIFICATION\``)
  const path = new RegExp(`${escapeRegExp(`${en.name}.`)}(?:${escapeRegExp(caseIdent(old))}|${escapeRegExp(caseName(old))})(?![\\w\`])`, 'g');
  const rewrite = (expr: string | undefined) => {
    if (!expr) return expr;
    return expr.trim().startsWith('=')
      ? expr.replace(/"((?:[^"\\]|\\.)*)"/g, (m, v: string) => (caseName(v) === caseName(old) ? JSON.stringify(name) : m))
      : expr.replace(path, () => `${en.name}.${caseIdent(name)}`);
  };
  const follow = (fs: Field[] | undefined) => fs?.map(f => {
    if (f.type !== typeId) return f;
    const next = { ...f, default: rewrite(f.default), example: rewrite(f.example) };
    if (f.enumCase && caseName(f.enumCase) === caseName(old)) next.enumCase = name;
    // no keys that were not there
    for (const k of ['default', 'example'] as const) if (next[k] === undefined) delete next[k];
    return next;
  });
  return types.map(t => {
    const values = t.id === typeId ? t.values!.map((v, k) => (k === index ? { ...v, name } : v)) : t.values;
    return {
      ...t,
      ...(t.fields ? { fields: follow(t.fields) } : {}),
      ...(values ? { values: values.map(v => (v.fields ? { ...v, fields: follow(v.fields) } : v)) } : {}),
    };
  });
}

/** The cases of an own enum that some field uses as a fixed type. */
function fixedCasesOf(typeId: string, idx: TypeIndex): string[] {
  const out = new Set<string>();
  const visit = (fs: Field[] | undefined) => { for (const f of fs ?? []) if (f.type === typeId && f.enumCase) out.add(caseName(f.enumCase)); };
  for (const t of idx.byId.values()) {
    visit(t.fields);
    for (const v of t.values ?? []) visit(v.fields);
  }
  return [...out];
}

export function checkTypes(types: TypeDef[] = [], model: Model | null = null): TypeIssue[] {
  const issues: TypeIssue[] = [];
  const idxAll = indexTypes(types, model);
  // a fixed case or a variant: does it exist, is it usable as a type?
  const enumCaseIssues = (t: TypeDef, f: Field) => {
    if (!f.enumCase) return;
    const cases = casesOf(f.type, idxAll);
    const simple = isSimpleEnum(f.type, idxAll);
    const fixedOk = idxAll.domainOf(f.type)?.fixedCases;
    if (!cases) issues.push({ typeId: t.id, field: f.id, message: `«${f.name}»: der Typ ist keine Auswahl mit Fällen — «${f.enumCase}» kann keine Ausprägung sein.` });
    else if (!cases.includes(caseName(f.enumCase))) issues.push({ typeId: t.id, field: f.id, message: `«${f.name}»: die Ausprägung «${f.enumCase}» gibt es in ${idxAll.nameOf(f.type)} nicht.` });
    else if (simple && (f.collection || f.map)) issues.push({ typeId: t.id, field: f.id, message: `«${f.name}»: ein fester Fall ist ein einzelner Wert — nicht mehrfach und keine Map.` });
    else if (simple && fixedOk && !fixedOk.includes(caseName(f.enumCase))) {
      issues.push({ typeId: t.id, field: f.id, message: `«${f.name}»: für ${idxAll.nameOf(f.type)}.${caseName(f.enumCase)}.type gibt es keine Givens (ApiSchema / InOutCodec) — einen anderen Fall wählen: ${fixedOk.join(', ')}.` });
    }
  };
  const names = new Map<string, number>();
  const ids = new Set(types.map(t => t.id));
  // without a catalog the service reference is not checked (instead of being reported wrongly)
  const services = model ? new Set(model.services.map(s => s.id)) : null;

  /** a suggestion only if the name is still free — taking it over must not create a duplicate */
  const free = (suggestion: string | undefined, taken: Iterable<string>) =>
    suggestion && ![...taken].some(n => caseName(n) === suggestion) ? suggestion : undefined;

  for (const t of types) {
    names.set(t.name, (names.get(t.name) ?? 0) + 1);
    const otherTypes = types.filter(o => o.id !== t.id).map(o => o.name);
    // Types of an interaction are called «Objekt.In» — that is the display name;
    // what gets generated from it is `In` inside the object.
    const displayName = t.interactionId ? (t.name.split('.').pop() ?? t.name) : t.name;
    // a type becomes a file, an object and an import — it needs a plain name; what only
    // deviates from the convention (lowercase first, underscore) is a hint
    if (!/^[A-Za-z_]\w*$/.test(displayName) || RESERVED.has(displayName)) {
      const suggestion = displayName === t.name ? free(nameSuggestion('type', t.name), otherTypes) : undefined;
      issues.push({ typeId: t.id, ...(suggestion ? { suggestion } : {}), message: `«${t.name || '(leer)'}» ist kein gültiger Scala-Typname (Buchstaben, Ziffern, _ — keine Leer- oder Sonderzeichen: daraus werden Datei und Objekt).` });
    } else if (!TYPE_NAME.test(displayName)) {
      const suggestion = displayName === t.name ? free(nameSuggestion('type', t.name), otherTypes) : undefined;
      issues.push({ typeId: t.id, warn: true, ...(suggestion ? { suggestion } : {}), message: `«${t.name}»: Typnamen beginnen nach Konvention mit einem Grossbuchstaben, ohne _.` });
    }
    if (t.kind === 'enum') {
      const vals = (t.values ?? []).map(v => v.name);
      if (!vals.length) issues.push({ typeId: t.id, message: 'Enumeration ohne Werte.' });
      // `Foo` and `` `Foo` `` are the same case
      if (new Set(vals.map(caseName)).size !== vals.length) issues.push({ typeId: t.id, message: 'Doppelte Werte in der Enumeration.' });
      for (const [k, v] of vals.entries()) {
        const name = caseName(v);
        const plain = /^[A-Za-z_]\w*$/.test(name) && !RESERVED.has(name);
        if (!name.trim() || name !== name.trim() || name.includes('`') || CONTROL.test(name)) {
          issues.push({ typeId: t.id, message: `Wert «${v || '(leer)'}» ist kein gültiger Name (kein Backtick oder Zeilenumbruch darin, kein Leerzeichen am Rand).` });
        } else if (!plain) {
          // valid — the export writes it in backticks (`ONLY GAMIFICATION`, a case with fields
          // like `QR-Rechnung`(…) with its object and end too), but every use in Scala needs them
          const suggestion = free(nameSuggestion(isAdt(t) ? 'type' : 'value', name), vals.filter((_, m) => m !== k));
          issues.push({ typeId: t.id, warn: true, value: v, ...(suggestion ? { suggestion } : {}), message: `Wert «${name}» steht in Scala in Backticks (${scalaName(name)}) — ${RESERVED.has(name) ? 'ein Scala-Schlüsselwort' : 'mit Leer- oder Sonderzeichen'}. Wenn möglich einen einfachen Namen wählen.` });
        }
      }
      // An ADT: the fields per case are checked like class fields
      if (!isAdt(t)) continue;
      const common = new Set((t.fields ?? []).map(f => caseName(f.name)));
      for (const v of t.values ?? []) {
        const inCase = new Set<string>();
        for (const f of v.fields ?? []) {
          if (common.has(caseName(f.name))) issues.push({ typeId: t.id, field: f.id, message: `«${f.name}» ist schon ein gemeinsames Feld — im Fall «${v.name}» nicht nochmals.` });
          if (inCase.has(caseName(f.name))) issues.push({ typeId: t.id, field: f.id, message: `Feld «${f.name}» kommt im Fall «${v.name}» doppelt vor.` });
          inCase.add(caseName(f.name));
        }
      }
    }
    const fields = t.kind === 'enum' ? allFields(t) : (t.fields ?? []);
    // InitIn and InConfig may be empty — then they do not exist in the export
    // (NoInput); «leer» in the list stays as a hint
    if (!fields.length && t.kind === 'case' && !t.initIn && !t.inConfig) issues.push({ typeId: t.id, message: 'Klasse ohne Felder.' });
    const seen = new Set<string>();
    // the names next to a field — common fields of an ADT stand in every case
    const siblings = (f: Field): string[] => {
      const lists = t.kind !== 'enum' ? [t.fields ?? []]
        : (t.fields ?? []).includes(f) ? [t.fields ?? [], ...(t.values ?? []).map(v => v.fields ?? [])]
          : [t.fields ?? [], (t.values ?? []).find(v => v.fields?.includes(f))?.fields ?? []];
      return lists.flat().filter(o => o !== f).map(o => o.name);
    };
    for (const f of fields) {
      // a plain name follows the convention (lowercase first); any other goes in backticks
      // (`display name`) — then only a backtick or a space at the edge cannot be written
      const quoted = !/^[A-Za-z_]\w*$/.test(f.name);
      if (quoted ? !f.name.trim() || f.name !== f.name.trim() || f.name.includes('`') || CONTROL.test(f.name) : !SCALA_NAME.test(f.name)) {
        const suggestion = free(nameSuggestion('field', f.name), siblings(f));
        issues.push({ typeId: t.id, field: f.id, ...(suggestion ? { suggestion } : {}), message: `«${f.name || '(leer)'}» ist kein gültiger Feldname (Kleinbuchstabe am Anfang; mit Leer- oder Sonderzeichen ohne Backtick, ohne Zeilenumbruch und ohne Leerzeichen am Rand).` });
      } else if (scalaName(f.name) !== f.name) {
        // valid, but every use in Scala needs the backticks — and FEEL cannot name it plainly
        const suggestion = free(nameSuggestion('field', f.name), siblings(f));
        issues.push({ typeId: t.id, field: f.id, warn: true, ...(suggestion ? { suggestion } : {}), message: `«${f.name}» steht in Scala in Backticks (${scalaName(f.name)}) — ${RESERVED.has(f.name) ? 'ein Scala-Schlüsselwort' : 'mit Leer- oder Sonderzeichen'}. Wenn möglich einen einfachen Namen wählen.` });
      }
      // in an ADT the same field name may appear in several cases
      if (t.kind === 'case' && seen.has(caseName(f.name))) issues.push({ typeId: t.id, field: f.id, message: `Feld «${f.name}» kommt doppelt vor.` });
      seen.add(caseName(f.name));
      // a default exists only in the InConfig and for optional fields of the
      // process input — and a FEEL default must be translatable to Scala
      // for a fixed case the default is the case itself — it follows from the type
      if (f.default?.trim() && !defaultIsUsed(t, f) && !isFixedCaseDefault(f.enumCase, f.default)) {
        issues.push({ typeId: t.id, field: f.id, message: t.root
          ? `Vorgabe von «${f.name}» wird nicht verwendet — nur bei einem optionalen Feld (der Init-Worker setzt es dann im InitIn).`
          : `Vorgabe von «${f.name}» wird nicht verwendet — Vorgaben gibt es nur im InConfig, im InitIn und bei optionalen Feldern der Prozess-Eingabe.` });
      } else {
        const dflt = isFinished(f, idxAll) ? scalaDefault(f, idxAll) : null;
        if (dflt?.issue) issues.push({ typeId: t.id, field: f.id, message: dflt.issue });
      }
      const ex = isFinished(f, idxAll) ? scalaExample(f, idxAll) : null;
      if (ex?.issue) issues.push({ typeId: t.id, field: f.id, message: ex.issue });
      const descr = f.descriptionExpr ? null : feelDescription(f);
      if (descr?.issue) issues.push({ typeId: t.id, field: f.id, message: descr.issue });
      const domId = parseDomainRef(f.type);
      if (domId) {
        if (model?.domainTypes && !model.domainTypes.some(d => d.id === domId)) {
          issues.push({ typeId: t.id, field: f.id, message: `«${f.name}»: der Typ «${domainNameOf(f.type)}» steht nicht (mehr) im Domain-Katalog.` });
        }
        enumCaseIssues(t, f);
        continue;
      }
      const svcRef = parseServiceRef(f.type);
      if (svcRef) {
        if (services && !services.has(svcRef.serviceId)) {
          issues.push({ typeId: t.id, field: f.id, message: `Der Service «${svcRef.serviceId}» steht nicht (mehr) im Katalog — Import von «${f.name}» prüfen.` });
        }
      } else if (!isScalar(f.type) && !ids.has(f.type) && !idxAll.domainOf(f.type) && !isScalaTypeExpression(f.type)) {
        issues.push({ typeId: t.id, field: f.id, message: `Typ von «${f.name}» ist nicht (mehr) vorhanden${model?.domainTypes?.length ? '' : ' — kein Katalog geladen (Admin → Katalog)'}.` });
      }
      enumCaseIssues(t, f);
      if (f.constraint?.trim() && !constraintKind(f.type)) {
        const label = isScalar(f.type) ? f.type : 'zusammengesetzten Typen';
        issues.push({ typeId: t.id, field: f.id, message: `Auf ${label} gibt es keine Einschränkung — sie gilt nur für Text und Zahlen.` });
      }
    }
  }
  for (const [name, n] of names) {
    if (n > 1) issues.push({ typeId: '', message: `Der Typname «${name}» ist ${n}× vergeben.` });
  }
  // Cycles over mandatory fields — those could never be built
  for (const t of types.filter(t => t.kind === 'case')) {
    const path = new Set<string>();
    const hit = (id: string): boolean => {
      if (path.has(id)) return true;
      path.add(id);
      const cur = types.find(x => x.id === id);
      for (const f of cur?.fields ?? []) {
        if (f.optional || f.collection || isScalar(f.type)) continue;
        if (parseServiceRef(f.type) || parseDomainRef(f.type)) continue;
        if (hit(f.type)) return true;
      }
      path.delete(id);
      return false;
    };
    if (hit(t.id)) issues.push({ typeId: t.id, message: `«${t.name}» enthält sich selbst über Pflichtfelder — das lässt sich nicht bauen.` });
  }
  return issues;
}
