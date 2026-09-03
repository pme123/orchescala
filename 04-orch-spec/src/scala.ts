// Datenmodell → Orchescala-Domain (Scala 3).
//
// Erzeugt genau die Idiome, die in den valiant-Projekten stehen:
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

import type { Field, Interaction, Model, ProcessSpec, TypeDef } from './types.ts';
import { INTERACTION_META, SCALA_TYPES } from './types.ts';
import { loopSettings, mockableSteps } from './interactions.ts';
import { deriveObject } from './serviceTypes.ts';
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

// ── Typ-Ausdruck ─────────────────────────────────────────────────────────────
/** `Option[Seq[String :| ValidEmail]]` — in dieser Reihenfolge geschachtelt. */
export function fieldType(f: Field, idx: TypeIndex): string {
  let t = idx.nameOf(f.type);
  if (f.constraint?.trim()) t = `${t} :| ${f.constraint.trim()}`;
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
  const seq = f.collection ? `Seq(${inner})` : inner;
  return f.optional ? `Some(${seq})` : seq;
}

function baseExample(f: Field, idx: TypeIndex): string {
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
  if (t.kind === 'enum') return `${t.name}.${t.values?.[0]?.name ?? 'example'}`;
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
  const fields = t.fields ?? [];
  const params = fields.map(f => {
    const d = f.description ? `${descriptionLine(f.description)}\n` : '';
    const def = f.default?.trim() ? ` = ${f.default.trim()}` : '';
    return `${d}${f.name}: ${fieldType(f, idx)}${def}`;
  });
  const body = params.length ? `\n${indent(params.join(',\n'), '    ')}\n` : '';
  return `case class ${t.name}(${body})`;
}

function companion(t: TypeDef, idx: TypeIndex): string {
  const fields = t.fields ?? [];
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
    ? `${head}${enumDef(t)}`
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
  lines.push(`  val ${meta.keyName} = "${escape(ia.key)}"`);
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
//    Schritt, dessen Ergebnis sich für Tests überschreiben lässt (`…Mock`).
//  · `InitIn` aus den Ausgaben des Init-Workers — der Schritt, dessen Topic
//    der Prozess selbst ist.
//
// Deshalb erzeugt der Generator sie, statt sie erfassen zu lassen.
const DEFAULT_BY_KIND: Record<'timer' | 'max' | 'counter', { type: string; value: string; descr: string }> = {
  timer:   { type: 'Iso8601Duration', value: '"PT1M"', descr: 'Wartezeit vor dem nächsten Versuch (ISO 8601).' },
  counter: { type: 'Int', value: '1', descr: 'Zähler der Versuche — mit `1` initialisieren.' },
  max:     { type: 'Int', value: '10', descr: 'Höchstzahl der Versuche.' },
};

const lowerFirst = (s: string) => s.replace(/^(.)/, c => c.toLowerCase());

function mockField(name: string): string {
  return `${lowerFirst(name.replace(/[^A-Za-z0-9]/g, ''))}Mock`;
}

export function renderInConfig(spec: ProcessSpec, imports: Set<string>): string {
  const params: string[] = [];
  for (const { name, kind } of loopSettings(spec)) {
    const d = DEFAULT_BY_KIND[kind];
    params.push(`${descriptionLine(d.descr)}\n${name}: ${d.type} = ${d.value}`);
  }
  const seen = new Set<string>();
  for (const step of mockableSteps(spec)) {
    // Der Mock-Typ ist das `Out` des gerufenen Objekts — aus der Kennung des
    // Services bzw. des Prozesses abgeleitet, samt Import.
    const ref = step.serviceId ?? step.calledProcess ?? step.topic;
    if (!ref) continue;
    const { object, pkg, uncertain } = deriveObject(ref);
    const field = mockField(step.name);
    if (seen.has(field)) continue;
    seen.add(field);
    imports.add(`import ${pkg}.${object}${uncertain ? '  // Pfad prüfen' : ''}`);
    params.push(`${descriptionLine(`Ergebnis von «${step.name}» für Tests überschreiben.`)}\n`
      + `${field}: Option[${object}.Out] = None`);
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
 * `InitIn` — die Felder ergeben sich aus den Ausgaben des Init-Workers, die
 * **Typen** stehen dort aber nicht. Deshalb legt der Klassenbauer dafür einen
 * Typ an (`initIn`), der wie jeder andere bearbeitet wird; hier wird nur
 * gerendert, was dort steht.
 */
export function renderInitIn(spec: ProcessSpec, idx: TypeIndex): string {
  const t = (spec.types ?? []).find(t => t.initIn);
  if (!t || !(t.fields ?? []).length) return '';
  return renderType({ ...t, name: 'InitIn' }, idx);
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
}

// Nur was der Typ wirklich braucht: Iron-Refinements und Service-Objekte
// bringen ihre Imports mit, alles Übrige stellt Orchescala über den
// Package-Export bereit.
export function importsOf(t: TypeDef, idx: TypeIndex): string[] {
  const lines: string[] = [];
  if ((t.fields ?? []).some(f => f.constraint?.trim())) {
    lines.push('import io.github.iltotore.iron.*', 'import io.github.iltotore.iron.constraint.all.*');
  }
  const external = new Map<string, string>(); // importPath → Anmerkung
  for (const f of t.fields ?? []) {
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
 * Package-Pfad aus Projekt und Prozessname: `valiant.mkk.domain.openMkk.v1`.
 *
 * Trägt der Prozessname keine Version und wiederholt er nur das Projekt
 * (`valiant-addresschange`), bleibt sein letztes Segment übrig — ein
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
 * `valiant-addresschange` gibt `addresschange` her, in der Domain heisst das
 * Paket aber `addressChange`.
 */
function domainHome(spec: ProcessSpec, model: Model | null): { pkg: string; object: string } | null {
  const id = spec.processId ?? spec.name;
  const treffer = (model?.domainTypes ?? []).find(t => t.processName === id && t.owner);
  return treffer ? { pkg: treffer.pkg, object: treffer.owner! } : null;
}

/** Der Scala-Name des Prozess-Objekts: `OpenMkkV1`, `AddressChange`. */
export function processObject(spec: ProcessSpec, model: Model | null = null): string {
  const echt = domainHome(spec, model);
  if (echt) return echt.object;
  const teil = packageOf(spec).split('.');
  const proc = teil[teil.length - 2] ?? spec.name;
  const version = teil[teil.length - 1];
  const name = proc.replace(/^(.)/, c => c.toUpperCase());
  // `openMkkV1` trug die Version schon im Namen — dann nicht doppeln
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
  const inConfig = renderInConfig(spec, processImports);
  if (inConfig) processParts.push(indent(inConfig));
  const initIn = renderInitIn(spec, idx);
  if (initIn) processParts.push(indent(initIn));

  if (processParts.length) {
    out.push({
      path: `${dir}/${objectName}.scala`,
      insert: true,
      content: [
        ...(processImports.size
          ? ['// oben in der Datei ergänzen:', ...[...processImports].map(l => `// ${l}`), '']
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
  const geschrieben = new Set<string>();
  for (const ia of spec.interactions ?? []) {
    if (geschrieben.has(ia.name)) continue;
    geschrieben.add(ia.name);
    out.push({
      path: `${dir}/${ia.name}.scala`,
      content: `package ${pkg}\n\n${renderInteraction(ia, spec, idx)}\n`,
    });
  }

  for (const t of types.filter(t => !t.root && !t.processOut && !t.initIn && !t.interactionId)) {
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
  return files.map(f =>
    `// ${'─'.repeat(72)}\n// ${f.path}${f.insert ? '  (in die bestehende Datei einfügen)' : ''}\n// ${'─'.repeat(72)}\n\n${f.content}`
  ).join('\n\n');
}

// ── Prüfungen ────────────────────────────────────────────────────────────────
export interface TypeIssue { typeId: string; field?: string; message: string }

const SCALA_NAME = /^[a-z][A-Za-z0-9]*$/;
const TYPE_NAME = /^[A-Z][A-Za-z0-9]*$/;
const RESERVED = new Set(['type', 'val', 'var', 'def', 'class', 'object', 'case', 'match', 'new', 'with', 'given', 'end', 'for', 'if', 'else', 'true', 'false', 'null', 'import', 'package', 'extends', 'lazy', 'implicit', 'private', 'sealed', 'trait', 'enum', 'then', 'do', 'while', 'yield', 'return', 'this', 'super', 'try', 'catch', 'finally', 'throw', 'abstract', 'final', 'override', 'protected', 'forSome']);

/** Was den generierten Scala-Code brechen würde — direkt in der Oberfläche. */
export function checkTypes(types: TypeDef[] = [], model: Model | null = null): TypeIssue[] {
  const issues: TypeIssue[] = [];
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
      for (const v of vals) if (!/^[A-Za-z][A-Za-z0-9]*$/.test(v)) {
        issues.push({ typeId: t.id, message: `Wert «${v || '(leer)'}» ist kein gültiger Name.` });
      }
      continue;
    }
    const fields = t.fields ?? [];
    if (!fields.length) issues.push({ typeId: t.id, message: 'Klasse ohne Felder.' });
    const seen = new Set<string>();
    for (const f of fields) {
      if (!SCALA_NAME.test(f.name)) {
        issues.push({ typeId: t.id, field: f.id, message: `«${f.name || '(leer)'}» ist kein gültiger Feldname (Kleinbuchstabe am Anfang).` });
      }
      if (RESERVED.has(f.name)) {
        issues.push({ typeId: t.id, field: f.id, message: `«${f.name}» ist ein Scala-Schlüsselwort.` });
      }
      if (seen.has(f.name)) issues.push({ typeId: t.id, field: f.id, message: `Feld «${f.name}» kommt doppelt vor.` });
      seen.add(f.name);
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
      } else if (!isScalar(f.type) && !ids.has(f.type)) {
        issues.push({ typeId: t.id, field: f.id, message: `Typ von «${f.name}» ist nicht (mehr) vorhanden.` });
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
