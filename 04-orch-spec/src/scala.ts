// Datenmodell → Orchescala-Domain (Scala 3).
//
// Erzeugt genau die Idiome, die in den globex-Projekten stehen:
//
//   case class In(@description("…") feld: Option[String] = None)
//   object In:
//     given ApiSchema[In]  = deriveApiSchema
//     given InOutCodec[In] = deriveInOutCodec
//     lazy val example        = In(…)
//     lazy val exampleMinimal = example.copy(optionalesFeld = None, …)
//   end In
//
// Das `In` gehört ins Prozess-Objekt, die übrigen Typen je in eine eigene
// Datei unter `schema/`. `InConfig` und `InitIn` erzeugt der Generator
// bewusst **nicht** — das sind Implementations-Details.

import { evaluate, FeelDate, FeelDateTime, FeelDuration } from 'feelin';
import type { EnumValue, Field, Interaction, Model, ProcessSpec, TypeDef } from './types.ts';
import { INTERACTION_META, SCALA_TYPES, isAdt } from './types.ts';
import { loopSettings, mockableSteps } from './interactions.ts';
import { deriveObject } from './serviceTypes.ts';
import { blockIndex, blockStart, mockField } from './bpmn.ts';
import {
  domainNameOf, domainTypeOf, parseDomainRef, parseServiceRef, serviceTypeOf,
  type ServiceType,
} from './serviceTypes.ts';
import type { DomainType } from './types.ts';

const isScalar = (t: string): boolean => (SCALA_TYPES as readonly string[]).includes(t);

/** Zahl-artig? Bestimmt, welche Constraints und Beispiele passen. */
export const isNumeric = (t: string): boolean =>
  ['Int', 'Long', 'Double', 'BigDecimal'].includes(t);

/**
 * Welche Art Einschränkung passt zu diesem Typ — `null` heisst: gar keine.
 * `Boolean` und die Datumstypen tragen kein Refinement; `Iban` und
 * `Iso8601Duration` sind Zeichenketten und verhalten sich wie `String`.
 */
export function constraintKind(t: string): 'text' | 'zahl' | null {
  if (isNumeric(t)) return 'zahl';
  if (['String', 'Iban', 'Iso8601Duration'].includes(t)) return 'text';
  return null;
}

export interface TypeIndex {
  byId: Map<string, TypeDef>;
  /** Name des Typs — skalar, eigener oder Service-Objekt */
  nameOf: (typeRef: string) => string;
  /** Service-Objekt hinter einem `svc:`-Verweis */
  serviceOf: (typeRef: string) => ServiceType | null;
  /** Katalog-Typ hinter einem `dom:`-Verweis */
  domainOf: (typeRef: string) => DomainType | null;
}

export function indexTypes(types: TypeDef[] = [], model: Model | null = null): TypeIndex {
  const byId = new Map(types.map(t => [t.id, t]));
  const serviceOf = (ref: string) => serviceTypeOf(ref, model);
  const domainOf = (ref: string) => domainTypeOf(ref, model);
  return {
    byId,
    serviceOf,
    domainOf,
    nameOf: (ref: string) => {
      if (isScalar(ref)) return ref;
      // Ein Katalog-Typ bleibt auch ohne geladenen Katalog lesbar
      if (parseDomainRef(ref)) return domainOf(ref)?.name ?? domainNameOf(ref);
      const svc = serviceOf(ref);
      if (svc) return svc.name;
      return byId.get(ref)?.name ?? ref;
    },
  };
}

// ── Vorgabe ──────────────────────────────────────────────────────────────────
//
// Die Vorgabe eines Feldes ist FEEL, wenn sie mit «=» beginnt — wie überall in
// Orch Spec. Beim Export wird sie ausgewertet und nach dem Typ des Feldes in
// Scala geschrieben:
//
//   Seq[Int]            = [90, 110, 140]          → Seq(90, 110, 140)
//   Option[String]      = "CH"                    → Some("CH")
//   Long / BigDecimal   = 3                       → 3L / BigDecimal("3")
//   LocalDate           = date("2026-01-01")      → LocalDate.parse("2026-01-01")
//   Sprache (enum)      = "de"                    → Sprache.de
//   Adresse (Klasse)    = {ort: "Bern"}           → Adresse(ort = "Bern", …)
//   Map[String, Int]    = {a: 1}                  → Map("a" -> 1)
//
// Ohne «=» bleibt die Vorgabe, was sie war: ein Scala-Ausdruck, wörtlich.

type FieldShape = Pick<Field, 'type' | 'optional' | 'collection' | 'map' | 'enumCase' | 'constraint'>;

class DefaultError extends Error {}

const isContext = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
  && !(v instanceof FeelDate) && !(v instanceof FeelDateTime) && !(v instanceof FeelDuration);
const scalaIdent = (name: string) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `\`${name}\``);
const scalaString = (v: string) => JSON.stringify(v);

/** Die Vorgabe als Scala-Ausdruck — oder warum es nicht geht. Ohne Vorgabe: `{ scala: null }`. */
export function scalaDefault(f: Field, idx: TypeIndex): { scala: string | null; issue?: string } {
  const d = f.default?.trim();
  if (!d) return { scala: null };
  if (!d.startsWith('=')) return { scala: d };
  const body = d.slice(1).trim();
  if (!body) return { scala: null, issue: 'Nach «=» fehlt der FEEL-Ausdruck.' };
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
 * ` = …` für die Parameterliste. Eine unübersetzbare Vorgabe wird nicht
 * übernommen: `???` mit einem TODO, in dem der FEEL-Ausdruck steht — das
 * Projekt kompiliert, und die Stelle ist zu finden. Als Blockkommentar, weil
 * das Komma zum nächsten Feld dahinter folgt.
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
  // ein Literal, das ein Refinement erfüllen muss, braucht `refineUnsafe` — wie beim example
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
    }
    throw new DefaultError(`für ${type} gibt es keine Übersetzung — ohne «=» als Scala-Ausdruck angeben.`);
  }
  const own = idx.byId.get(type);
  if (!own || f.enumCase) throw new DefaultError('für diesen Typ ohne «=» als Scala-Ausdruck angeben.');
  if (own.kind === 'enum') {
    if (isAdt(own)) throw new DefaultError('für eine Auswahl mit Fällen ohne «=» als Scala-Ausdruck angeben.');
    const values = (own.values ?? []).map(x => x.name).filter(Boolean);
    if (typeof v !== 'string' || !values.includes(v)) throw new DefaultError(`erwartet einen Wert von ${own.name}: ${values.map(x => `"${x}"`).join(', ')}.`);
    return `${own.name}.${scalaIdent(v)}`;
  }
  // eine Klasse aus einem Kontext: fehlende optionale Felder sind None
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

// ── Unfertiges ───────────────────────────────────────────────────────────────
/**
 * Ein Feld kommt erst in den Code, wenn es fertig ist: mit Namen, mit Typ und —
 * bei einem eigenen Typ — einem, den es noch gibt und der einen Namen hat.
 * Sonst stünde `: String` oder eine interne id im Code, und das Projekt
 * kompiliert nicht. Die Prüfungen im Klassenbauer melden es weiterhin.
 */
export function isFinished(f: Field, idx: TypeIndex): boolean {
  const type = f.type?.trim();
  if (!f.name?.trim() || !type) return false;
  return isScalar(type) || !!parseDomainRef(type) || !!parseServiceRef(type) || !!idx.byId.get(type)?.name?.trim();
}

const finished = (fields: Field[] | undefined, idx: TypeIndex): Field[] => (fields ?? []).filter(f => isFinished(f, idx));

// ── Typ-Ausdruck ─────────────────────────────────────────────────────────────
/** `Option[Seq[String :| ValidEmail]]` — in dieser Reihenfolge geschachtelt. */
export function fieldType(f: Field, idx: TypeIndex): string {
  let t = idx.nameOf(f.type);
  if (f.enumCase) t = `${t}.${f.enumCase}`;
  if (f.constraint?.trim()) t = `${t} :| ${f.constraint.trim()}`;
  if (f.map) t = `Map[String, ${t}]`;
  if (f.collection) t = `Seq[${t}]`;
  if (f.optional) t = `Option[${t}]`;
  return t;
}

// ── Beispielwerte ────────────────────────────────────────────────────────────
const SCALAR_EXAMPLE: Record<string, string> = {
  String: '"Beispiel"',
  Boolean: 'true',
  Int: '1',
  Long: '1L',
  Double: '1.0',
  BigDecimal: 'BigDecimal("100.00")',
  LocalDate: 'LocalDate.now()',
  LocalDateTime: 'LocalDateTime.now()',
  Iso8601Duration: '"PT1M"',
  Iban: 'defaultIban',
};

/** Beispielwert eines Feldes — eigene Angabe schlägt die Ableitung. */
const LITERAL = /^(".*"|-?\d+(\.\d+)?L?)$/s;

export function exampleValue(f: Field, idx: TypeIndex): string {
  let inner = f.example?.trim() || baseExample(f, idx);
  // Ein Literal, das ein Refinement erfüllen muss, braucht `refineUnsafe`
  if (f.example?.trim() && f.constraint?.trim() && LITERAL.test(inner)) inner = `${inner}.refineUnsafe`;
  const mapped = f.map ? `Map("key" -> ${inner})` : inner;
  const seq = f.collection ? `Seq(${mapped})` : mapped;
  return f.optional ? `Some(${seq})` : seq;
}

function baseExample(f: Field, idx: TypeIndex): string {
  // eine Ausprägung: ihr Companion hat ein eigenes example
  if (f.enumCase) return `${idx.nameOf(f.type)}.${f.enumCase}.example`;
  if (parseDomainRef(f.type)) return `${idx.nameOf(f.type)}.example`;
  const svc = idx.serviceOf(f.type);
  if (svc) return `${svc.name}.example`;
  if (isScalar(f.type)) {
    const v = SCALAR_EXAMPLE[f.type] ?? '???';
    // Ein Refinement braucht bei String-Literalen ein refineUnsafe
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
  if (!clean.includes('\n')) return `@description("${escape(clean)}")`;
  const lines = clean.split('\n').map(l => `  |${l}`).join('\n');
  return `@description(\n  """${escape(clean.split('\n')[0])}\n${lines}\n  |""".stripMargin\n)`;
}

const escape = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/** Beschreibung eines Typs als Scaladoc — `@description` gilt nur für Felder. */
function scaladoc(text: string): string {
  const lines = text.trim().split('\n');
  return lines.length === 1 ? `/** ${lines[0]} */` : `/**\n${lines.map(l => ` * ${l}`).join('\n')}\n */`;
}

function caseClass(t: TypeDef, idx: TypeIndex): string {
  const fields = finished(t.fields, idx);
  const params = fields.map(f => {
    const d = f.description ? `${descriptionLine(f.description)}\n` : '';
    return `${d}${f.name}: ${fieldType(f, idx)}`;
  });
  const body = params.length ? `\n${indent(params.join(',\n'), '    ')}\n` : '';
  return `case class ${t.name}(${body})`;
}

function companion(t: TypeDef, idx: TypeIndex): string {
  const fields = finished(t.fields, idx);
  const args = fields.map(f => `${f.name} = ${exampleValue(f, idx)}`);
  // exampleMinimal lässt alles weg, was fehlen darf
  const optional = fields.filter(f => f.optional);
  const minimal = optional.length
    ? `lazy val exampleMinimal = example.copy(\n${indent(optional.map(f => `${f.name} = None`).join(',\n'), '    ')}\n  )`
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

/** Parameterliste einer Klasse bzw. eines ADT-Falls. */
function paramList(fields: Field[], idx: TypeIndex, by: string): string {
  const params = fields.map(f => {
    const d = f.description ? `${descriptionLine(f.description)}\n` : '';
    return `${d}${f.name}: ${fieldType(f, idx)}`;
  });
  return params.length ? `\n${indent(params.join(',\n'), by)}\n` : '';
}

/**
 * Auswahl mit Feldern je Fall — wie `enum In` der Depot-Domain: jeder Fall
 * eine Klasse, das Companion mit `example` je Fall und einem für den Typ.
 */
function adtDef(t: TypeDef, idx: TypeIndex): string {
  const cases = (t.values ?? []).filter(v => v.name);
  const first = cases[0]?.name ?? 'unknown';
  // Gemeinsame Felder: als `def` im Rumpf verlangt, in jedem Fall zuerst
  const common = finished(t.fields, idx);
  // Die Bedeutung eines gemeinsamen Feldes steht **einmal** — am `def`, nicht
  // in jedem Fall nochmals
  const commonDefs = common.map(f => {
    const d = f.description ? `${indent(descriptionLine(f.description), '  ')}\n` : '';
    return `${d}  def ${f.name}: ${fieldType(f, idx)}`;
  });
  const commonBare = common.map(f => ({ ...f, description: undefined }));
  const fieldsOf = (v: EnumValue): Field[] => [...commonBare, ...finished(v.fields, idx).filter(f => !common.some(c => c.name === f.name))];
  const caseLines = cases.map(v => {
    const d = v.description ? `${indent(descriptionLine(v.description), '  ')}\n` : '';
    const fields = fieldsOf(v);
    return fields.length ? `${d}  case ${v.name}(${paramList(fields, idx, '      ')}  )` : `${d}  case ${v.name}`;
  });
  const companions = cases.filter(v => fieldsOf(v).length).map(v => {
    const fields = fieldsOf(v);
    const args = fields.map(f => `${f.name} = ${exampleValue(f, idx)}`);
    const optional = fields.filter(f => f.optional);
    const minimal = optional.length
      ? `lazy val exampleMinimal = example.copy(\n${indent(optional.map(f => `${f.name} = None`).join(',\n'), '      ')}\n    )`
      : 'lazy val exampleMinimal = example';
    return [
      `  object ${v.name}:`,
      `    lazy val example: ${t.name}.${v.name} = ${t.name}.${v.name}(\n${indent(args.join(',\n'), '      ')}\n    )`,
      `    ${minimal}`,
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
    ...(companions.length ? ['', ...companions] : []),
    '',
    `  lazy val example = ${cases[0] && fieldsOf(cases[0]).length ? `${first}.example` : `${t.name}.${first}`}`,
    `end ${t.name}`,
  ].join('\n');
}

function enumDef(t: TypeDef): string {
  const cases = (t.values ?? []).map(v => v.name).filter(Boolean);
  const first = cases[0] ?? 'unknown';
  return [
    `enum ${t.name}:`,
    `  case ${cases.length ? cases.join(', ') : 'unknown'}`,
    '',
    `object ${t.name}:`,
    `  given ApiSchema[${t.name}]  = deriveEnumApiSchema`,
    `  given InOutCodec[${t.name}] = deriveEnumInOutCodec`,
    '',
    `  lazy val example = ${t.name}.${first}`,
    `end ${t.name}`,
  ].join('\n');
}

/** Ein Typ als Scala-Quelltext (ohne Package/Imports). */
export function renderType(t: TypeDef, idx: TypeIndex): string {
  const head = t.description ? `${scaladoc(t.description)}\n` : '';
  return t.kind === 'enum'
    ? `${head}${isAdt(t) ? adtDef(t, idx) : enumDef(t)}`
    : `${head}${caseClass(t, idx)}\n\n${companion(t, idx)}`;
}

// ── Interaktionen ────────────────────────────────────────────────────────────
//
// Jede Interaktion wird ein eigenes Objekt mit dem passenden DSL-Trait; `In`
// und `Out` liegen darin, nicht in `schema/`. Fehlt ein Typ, steht dort
// `NoInput` — so wie es die Domain auch schreibt.
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
  lines.push(`  val ${meta.keyName} = "${escape(ia.key ?? ia.name ?? '')}"`);
  if (ia.descr) lines.push(`  val descr = "${escape(firstLine(ia.descr))}"`);
  lines.push('');

  const member = (t: TypeDef | null, name: 'In' | 'Out') => {
    if (!t) {
      lines.push(`  type ${name} = NoInput`);
      lines.push('');
      return `NoInput()`;
    }
    lines.push(indent(renderType({ ...t, name }, idx), '  '));
    lines.push('');
    return `${name}.example`;
  };

  const inExpr = member(inType, 'In');
  const outExpr = meta.hasOut ? member(outType, 'Out') : null;

  lines.push(`  lazy val example = ${meta.factory}(`);
  lines.push(`    ${inExpr}${outExpr ? `,\n    ${outExpr}` : ''}`);
  lines.push('  )');
  lines.push(`end ${ia.name}`);
  return lines.join('\n');
}

// ── InConfig und InitIn ──────────────────────────────────────────────────────
//
// Beide gehören **nicht** in die Spezifikation — sie ergeben sich aus ihr:
//
//  · `InConfig` aus den Schleifen (Timer, Zähler, Höchstzahl) und aus jedem
//    Schritt, dessen Ergebnis sich für Tests überschreiben lässt (`…Mock`) —
//    dazu kommen die eigenen Stellschrauben, die der Klassenbauer als Typ
//    `inConfig` pflegt; sie stehen vorne und gewinnen bei gleichem Namen.
//  · `InitIn` aus den Ausgaben des Init-Workers — der Schritt, dessen Topic
//    der Prozess selbst ist.
//
// Deshalb erzeugt der Generator sie, statt sie erfassen zu lassen.
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
    const d = f.description ? `${descriptionLine(f.description)}\n` : '';
    const def = defaultClause(f, idx!) || (f.optional ? ' = None' : '');
    return `${d}${f.name}: ${fieldType(f, idx!)}${def}`;
  });
  for (const { name, kind } of loopSettings(spec)) {
    if (seen.has(name)) continue;
    seen.add(name);
    const d = DEFAULT_BY_KIND[kind];
    params.push(`${descriptionLine(d.descr)}\n${name}: ${d.type} = ${d.value}`);
  }
  for (const step of mockableSteps(spec)) {
    // Nur Schritte mit gewähltem Mock. Der Typ ist das `Out` des gerufenen
    // Objekts bzw. die Service-Antwort — aus der Kennung abgeleitet, samt Import.
    if (!step.mockKind) continue;
    const ref = step.serviceId ?? step.calledProcess ?? step.topic;
    if (!ref) continue;
    const { object, pkg, uncertain } = deriveObject(ref);
    const field = mockField(step.name);
    if (seen.has(field)) continue;
    seen.add(field);
    imports.add(`import ${pkg}.${object}${uncertain ? '  // Pfad prüfen' : ''}`);
    const type = step.mockKind === 'service' ? `MockedServiceResponse[${object}.ServiceOut]` : `${object}.Out`;
    params.push(`${descriptionLine(`For testing you can mock the Process ${step.name} _${ref}_.`)}\n`
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
 * Vorgabewerte stehen nie in einer Klasse — einzig im `InConfig`, wo es
 * Konfigurationen sind. Beim `In` des Prozesses hat eine Vorgabe nur bei einem
 * **optionalen** Feld Sinn: das Feld bleibt `Option[…]`, und der Init-Worker
 * setzt dasselbe Feld im `InitIn` — dort Pflicht — auf den Wert aus dem `In`
 * oder die Vorgabe:
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

/** Wo eine Vorgabe verwendet wird: im InConfig, und bei optionalen Feldern der Prozess-Eingabe. */
export function defaultIsUsed(t: TypeDef, f: Field): boolean {
  return !!t.inConfig || (!!t.root && t.kind === 'case' && !!f.optional);
}

/**
 * `InitIn` — die Felder ergeben sich aus den Ausgaben des Init-Workers, die
 * **Typen** stehen dort aber nicht. Deshalb legt der Klassenbauer dafür einen
 * Typ an (`initIn`), der wie jeder andere bearbeitet wird. Dazu kommen die
 * Felder mit Vorgabe aus dem `In` (siehe `defaultsForInit`).
 */
export function renderInitIn(spec: ProcessSpec, idx: TypeIndex): string {
  const t = (spec.types ?? []).find(t => t.initIn);
  const own = finished(t?.fields, idx);
  const fromIn = defaultsForInit(spec, idx).filter(f => !own.some(o => o.name === f.name));
  if (!own.length && !fromIn.length) return '';
  return renderType({ ...(t ?? { id: 'initIn', kind: 'case' as const }), name: 'InitIn', fields: [...own, ...fromIn] }, idx);
}

/**
 * Was der Init-Worker im `customInit` zurückgibt, wenn das `In` Vorgaben hat —
 * die übrigen Felder des InitIn kommen (noch) aus dem Beispiel. `null`: keine Vorgaben.
 */
export function initInExpression(spec: ProcessSpec, idx: TypeIndex): string | null {
  const fromIn = defaultsForInit(spec, idx);
  if (!fromIn.length) return null;
  const own = finished((spec.types ?? []).find(t => t.initIn)?.fields, idx);
  const args = fromIn.map(f => {
    const r = scalaDefault(f, idx);
    const value = r.scala ?? `??? /* TODO ${(r.issue ?? '').replace(/\*\//g, '* /')} */`;
    return `  ${f.name} = in.${f.name}.getOrElse(${value})`;
  });
  const rest = own.some(o => !fromIn.some(f => f.name === o.name));
  return `${rest ? 'InitIn.example.copy' : 'InitIn'}(\n${args.join(',\n')}\n)`;
}

function firstLine(text: string): string {
  return text.trim().split('\n')[0];
}

// ── Dateien ──────────────────────────────────────────────────────────────────
export interface ScalaFile {
  /** Pfad relativ zum Projekt */
  path: string;
  content: string;
  /** true = ins bestehende Prozess-Objekt einfügen, nicht als neue Datei */
  insert?: boolean;
  /** Klammer: der eigene Block oder Ereignis-Subprozess, zu dem die Interaktion gehört */
  section?: string;
}

// Nur was der Typ wirklich braucht: Iron-Refinements und Service-Objekte
// bringen ihre Imports mit, alles Übrige stellt Orchescala über den
// Package-Export bereit.
/** Alle Felder eines Typs — bei einem ADT die gemeinsamen und die aller Fälle. */
export function allFields(t: TypeDef): Field[] {
  return t.kind === 'enum' ? [...(t.fields ?? []), ...(t.values ?? []).flatMap(v => v.fields ?? [])] : (t.fields ?? []);
}

export function importsOf(t: TypeDef, idx: TypeIndex): string[] {
  const lines: string[] = [];
  const fields = allFields(t).filter(f => isFinished(f, idx));
  if (fields.some(f => f.constraint?.trim())) {
    lines.push('import io.github.iltotore.iron.*', 'import io.github.iltotore.iron.constraint.all.*');
  }
  const external = new Map<string, string>(); // importPath → Anmerkung
  for (const f of fields) {
    const dom = idx.domainOf(f.type);
    if (dom) { external.set(dom.importPath, ''); continue; }
    const svc = idx.serviceOf(f.type);
    if (svc) external.set(svc.importPath, svc.uncertain ? '  // Pfad prüfen — aus dem Service-Namen abgeleitet' : '');
  }
  for (const [path, note] of [...external.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`import ${path}${note}`);
  }
  return lines;
}

function imports(t: TypeDef, idx: TypeIndex): string {
  const lines = importsOf(t, idx);
  return lines.length ? `\n${lines.join('\n')}\n` : '\n';
}

/**
 * Package-Pfad aus Projekt und Prozessname: `globex.savings.domain.openSavings.v1`.
 *
 * Trägt der Prozessname keine Version und wiederholt er nur das Projekt
 * (`globex-ordercard`), bleibt sein letztes Segment übrig — ein
 * Bindestrich wäre in einem Package-Namen nicht erlaubt.
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
 * Wo dieser Prozess in der Domain wirklich liegt — erkennbar am
 * `val processName` seines Objekts. Ohne Katalog-Eintrag bleibt nur die
 * Ableitung aus der Prozess-ID, und die ist eine Vermutung:
 * `globex-ordercard` gibt `ordercard` her, in der Domain heisst das
 * Paket aber `orderCard`.
 */
function domainHome(spec: ProcessSpec, model: Model | null): { pkg: string; object: string } | null {
  const id = spec.processId ?? spec.name;
  const treffer = (model?.domainTypes ?? []).find(t => t.processName === id && t.owner);
  return treffer ? { pkg: treffer.pkg, object: treffer.owner! } : null;
}

/** Der Scala-Name des Prozess-Objekts: `OpenSavingsV1`, `OrderCard`. */
export function processObject(spec: ProcessSpec, model: Model | null = null): string {
  const echt = domainHome(spec, model);
  if (echt) return echt.object;
  const teil = packageOf(spec).split('.');
  const proc = teil[teil.length - 2] ?? spec.name;
  const version = teil[teil.length - 1];
  const name = proc.replace(/^(.)/, c => c.toUpperCase());
  // `openSavingsV1` trug die Version schon im Namen — dann nicht doppeln
  return /^([A-Za-z][A-Za-z0-9]*?)V(\d+)$/.test(spec.name) ? `${name}V${version.slice(1)}` : name;
}

function srcDir(spec: ProcessSpec, model: Model | null): string {
  return `01-domain/src/main/scala/${packageOf(spec, model).replace(/\./g, '/')}`;
}

/** Alle Dateien, die aus dem Datenmodell entstehen. */
export function scalaFiles(spec: ProcessSpec, model: Model | null = null): ScalaFile[] {
  const types = spec.types ?? [];
  if (!types.length && !(spec.interactions ?? []).length) return [];
  const idx = indexTypes(types, model);
  const dir = srcDir(spec, model);
  const pkg = packageOf(spec, model);
  const out: ScalaFile[] = [];

  // Prozess-Objekt: In, Out und die erzeugten InConfig / InitIn
  const objectName = processObject(spec, model);
  const processParts: string[] = [];
  const processImports = new Set<string>();
  for (const t of types.filter(t => t.root || t.processOut)) {
    for (const l of importsOf(t, idx)) processImports.add(l);
    processParts.push(indent(renderType({ ...t, name: t.root ? 'In' : 'Out' }, idx)));
  }
  const inConfig = renderInConfig(spec, processImports, idx);
  if (inConfig) processParts.push(indent(inConfig));
  const initIn = renderInitIn(spec, idx);
  if (initIn) processParts.push(indent(initIn));
  const customInit = initInExpression(spec, idx);

  if (processParts.length) {
    out.push({
      path: `${dir}/${objectName}.scala`,
      insert: true,
      content: [
        ...(processImports.size
          ? ['// oben in der Datei ergänzen:', ...[...processImports].map(l => `// ${l}`), '']
          : []),
        // gehört in den Worker, nicht in die Domain — der Helper setzt ihn dort ein
        ...(customInit
          ? ['// im InitWorker (customInit):', ...customInit.split('\n').map(l => `// ${l}`), '']
          : []),
        `// in object ${objectName} einfügen`,
        '// (InConfig und InitIn werden aus dem Ablauf erzeugt — nicht von Hand pflegen)',
        '',
        processParts.join('\n\n'),
      ].join('\n'),
    });
  }

  // Je Interaktion eine eigene Datei. Dasselbe Signal an zwei Stellen im
  // Ablauf ist **ein** Objekt — sonst stünde die Datei zweimal im Export.
  // Erst der Hauptablauf, dann je eigenem Block bzw. Ereignis-Subprozess
  // eine Klammer — dieselbe wie im Baum und im Datenmodell.
  const blocks = blockIndex(spec.steps);
  const sectionOf = (ia: Interaction): string | undefined => {
    const ref = blocks.get(ia.stepId);
    if (!ref) return undefined;
    return ref.eventSub ? `Ereignis-Subprozess «${ref.head.name}»` : `Eigener Block «${ref.head.name}» — ${blockStart(ref.head)}`;
  };
  const geschrieben = new Set<string>();
  const sorted = [...(spec.interactions ?? [])].map((ia, i) => ({ ia, i, section: sectionOf(ia) }))
    .sort((a, b) => (a.section ? 1 : 0) - (b.section ? 1 : 0) || (a.section ?? '').localeCompare(b.section ?? '') || a.i - b.i);
  for (const { ia, section } of sorted) {
    // ohne Namen gäbe es `object  extends …` — erst, wenn sie einen hat
    if (!ia.name?.trim() || geschrieben.has(ia.name)) continue;
    geschrieben.add(ia.name);
    out.push({
      path: `${dir}/${ia.name}.scala`,
      content: `package ${pkg}\n\n${section ? `// ${section}\n` : ''}${renderInteraction(ia, spec, idx)}\n`,
      ...(section ? { section } : {}),
    });
  }

  for (const t of types.filter(t => t.name?.trim() && !t.root && !t.processOut && !t.initIn && !t.inConfig && !t.interactionId)) {
    out.push({
      path: `${dir}/schema/${t.name}.scala`,
      content: `package ${pkg}.schema\n${imports(t, idx)}\n${renderType(t, idx)}\n`,
    });
  }
  return out;
}

/** Alle Dateien als ein Text — zum Prüfen, Kopieren und für die KI. */
export function scalaBundle(spec: ProcessSpec, model: Model | null = null): string {
  const files = scalaFiles(spec, model);
  if (!files.length) return '// Noch kein Datenmodell — im Klassenbauer anlegen.';
  // Klammer: eine Überschrift, sobald ein eigener Block beginnt — und wieder
  // eine, wenn danach die gemeinsamen Klassen (schema/) folgen
  let section: string | undefined;
  return files.map(f => {
    const head = f.section !== section ? `// ${'═'.repeat(72)}\n// ${f.section ?? 'Gemeinsame Klassen'}\n// ${'═'.repeat(72)}\n\n` : '';
    section = f.section;
    return `${head}// ${'─'.repeat(72)}\n// ${f.path}${f.insert ? '  (in die bestehende Datei einfügen)' : ''}\n// ${'─'.repeat(72)}\n\n${f.content}`;
  }).join('\n\n');
}

// ── Prüfungen ────────────────────────────────────────────────────────────────
export interface TypeIssue { typeId: string; field?: string; message: string }

const SCALA_NAME = /^[a-z][A-Za-z0-9]*$/;
const TYPE_NAME = /^[A-Z][A-Za-z0-9]*$/;
const RESERVED = new Set(['type', 'val', 'var', 'def', 'class', 'object', 'case', 'match', 'new', 'with', 'given', 'end', 'for', 'if', 'else', 'true', 'false', 'null', 'import', 'package', 'extends', 'lazy', 'implicit', 'private', 'sealed', 'trait', 'enum', 'then', 'do', 'while', 'yield', 'return', 'this', 'super', 'try', 'catch', 'finally', 'throw', 'abstract', 'final', 'override', 'protected', 'forSome']);

/** Was den generierten Scala-Code brechen würde — direkt in der Oberfläche. */
/** Die Fälle einer Auswahl mit Feldern (eigen oder aus dem Katalog) — null, wenn der Typ keine ist. */
export function casesOf(typeRef: string, idx: TypeIndex): string[] | null {
  const own = idx.byId.get(typeRef);
  if (own) return own.kind === 'enum' && isAdt(own) ? (own.values ?? []).map(v => v.name) : null;
  const dom = idx.domainOf(typeRef);
  if (dom) return dom.kind === 'enum' && (dom.cases?.length || dom.fields?.length) ? (dom.values ?? []).slice() : null;
  return null;
}

export function checkTypes(types: TypeDef[] = [], model: Model | null = null): TypeIssue[] {
  const issues: TypeIssue[] = [];
  const idxAll = indexTypes(types, model);
  const names = new Map<string, number>();
  const ids = new Set(types.map(t => t.id));
  // ohne Katalog wird der Service-Verweis nicht geprüft (statt falsch gemeldet)
  const services = model ? new Set(model.services.map(s => s.id)) : null;

  for (const t of types) {
    names.set(t.name, (names.get(t.name) ?? 0) + 1);
    // Typen einer Interaktion heissen «Objekt.In» — das ist der Anzeigename;
    // erzeugt wird daraus `In` innerhalb des Objekts.
    const displayName = t.interactionId ? (t.name.split('.').pop() ?? t.name) : t.name;
    if (!TYPE_NAME.test(displayName)) {
      issues.push({ typeId: t.id, message: `«${t.name || '(leer)'}» ist kein gültiger Scala-Typname (Grossbuchstabe, keine Sonderzeichen).` });
    }
    if (t.kind === 'enum') {
      const vals = (t.values ?? []).map(v => v.name);
      if (!vals.length) issues.push({ typeId: t.id, message: 'Enumeration ohne Werte.' });
      if (new Set(vals).size !== vals.length) issues.push({ typeId: t.id, message: 'Doppelte Werte in der Enumeration.' });
      for (const v of vals) if (!/^([A-Za-z][A-Za-z0-9]*|`[^`]+`)$/.test(v)) {
        issues.push({ typeId: t.id, message: `Wert «${v || '(leer)'}» ist kein gültiger Name (Sonderzeichen nur in Backticks: \`QI-Deklaration\`).` });
      }
      // Ein ADT: die Felder je Fall werden wie Klassenfelder geprüft
      if (!isAdt(t)) continue;
      const common = new Set((t.fields ?? []).map(f => f.name));
      for (const v of t.values ?? []) {
        const inCase = new Set<string>();
        for (const f of v.fields ?? []) {
          if (common.has(f.name)) issues.push({ typeId: t.id, field: f.id, message: `«${f.name}» ist schon ein gemeinsames Feld — im Fall «${v.name}» nicht nochmals.` });
          if (inCase.has(f.name)) issues.push({ typeId: t.id, field: f.id, message: `Feld «${f.name}» kommt im Fall «${v.name}» doppelt vor.` });
          inCase.add(f.name);
        }
      }
    }
    const fields = t.kind === 'enum' ? allFields(t) : (t.fields ?? []);
    if (!fields.length && t.kind === 'case') issues.push({ typeId: t.id, message: 'Klasse ohne Felder.' });
    const seen = new Set<string>();
    for (const f of fields) {
      if (!SCALA_NAME.test(f.name)) {
        issues.push({ typeId: t.id, field: f.id, message: `«${f.name || '(leer)'}» ist kein gültiger Feldname (Kleinbuchstabe am Anfang).` });
      }
      if (RESERVED.has(f.name)) {
        issues.push({ typeId: t.id, field: f.id, message: `«${f.name}» ist ein Scala-Schlüsselwort.` });
      }
      // in einem ADT darf derselbe Feldname in mehreren Fällen stehen
      if (t.kind === 'case' && seen.has(f.name)) issues.push({ typeId: t.id, field: f.id, message: `Feld «${f.name}» kommt doppelt vor.` });
      seen.add(f.name);
      // eine Vorgabe gibt es nur im InConfig und bei optionalen Feldern der
      // Prozess-Eingabe — und eine FEEL-Vorgabe muss sich nach Scala übersetzen lassen
      if (f.default?.trim() && !defaultIsUsed(t, f)) {
        issues.push({ typeId: t.id, field: f.id, message: t.root
          ? `Vorgabe von «${f.name}» wird nicht verwendet — nur bei einem optionalen Feld (der Init-Worker setzt es dann im InitIn).`
          : `Vorgabe von «${f.name}» wird nicht verwendet — Vorgaben gibt es nur im InConfig und bei optionalen Feldern der Prozess-Eingabe.` });
      } else {
        const dflt = isFinished(f, idxAll) ? scalaDefault(f, idxAll) : null;
        if (dflt?.issue) issues.push({ typeId: t.id, field: f.id, message: dflt.issue });
      }
      const domId = parseDomainRef(f.type);
      if (domId) {
        if (model?.domainTypes && !model.domainTypes.some(d => d.id === domId)) {
          issues.push({ typeId: t.id, field: f.id, message: `«${f.name}»: der Typ «${domainNameOf(f.type)}» steht nicht (mehr) im Domain-Katalog.` });
        }
        continue;
      }
      const svcRef = parseServiceRef(f.type);
      if (svcRef) {
        if (services && !services.has(svcRef.serviceId)) {
          issues.push({ typeId: t.id, field: f.id, message: `Der Service «${svcRef.serviceId}» steht nicht (mehr) im Katalog — Import von «${f.name}» prüfen.` });
        }
      } else if (!isScalar(f.type) && !ids.has(f.type) && !idxAll.domainOf(f.type)) {
        issues.push({ typeId: t.id, field: f.id, message: `Typ von «${f.name}» ist nicht (mehr) vorhanden${model?.domainTypes?.length ? '' : ' — kein Katalog geladen (Admin → Katalog)'}.` });
      }
      if (f.enumCase) {
        const cases = casesOf(f.type, idxAll);
        if (!cases) issues.push({ typeId: t.id, field: f.id, message: `«${f.name}»: der Typ ist keine Auswahl mit Fällen — «${f.enumCase}» kann keine Ausprägung sein.` });
        else if (!cases.includes(f.enumCase)) issues.push({ typeId: t.id, field: f.id, message: `«${f.name}»: die Ausprägung «${f.enumCase}» gibt es in ${idxAll.nameOf(f.type)} nicht.` });
      }
      if (f.constraint?.trim() && !constraintKind(f.type)) {
        const label = isScalar(f.type) ? f.type : 'zusammengesetzten Typen';
        issues.push({ typeId: t.id, field: f.id, message: `Auf ${label} gibt es keine Einschränkung — sie gilt nur für Text und Zahlen.` });
      }
    }
  }
  for (const [name, n] of names) {
    if (n > 1) issues.push({ typeId: '', message: `Der Typname «${name}» ist ${n}× vergeben.` });
  }
  // Zyklen über Pflichtfelder — die liessen sich nie bauen
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
