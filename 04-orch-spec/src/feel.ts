// FEEL-Ausdrücke in Mappings (Camunda 8).
//
// In Camunda 8 ist ein Mapping-Wert, der mit `=` beginnt, ein FEEL-Ausdruck.
// Die App prüft ihn beim Tippen auf drei Dinge:
//
//   a) ist es gültiges FEEL (Syntax),
//   b) passt der Typ des Ergebnisses zum Zielfeld,
//   c) gibt es die Variablen und Pfade, auf die er zeigt (`client.address.zip`).
//
// Gerechnet wird nicht symbolisch, sondern **mit Beispielwerten**: aus dem
// Datenmodell des Prozesses entsteht ein Kontext, in dem jede bekannte
// Variable einen zum Typ passenden Wert hat. `feelin` wertet den Ausdruck
// darin aus — was dabei fehlt, meldet es als Warnung mit Position, und der
// Typ des Ergebnisses ist der Typ, der am Zielfeld ankäme.
//
// Woher die Variablen kommen: das `In` des Prozesses, das `InitIn` (die vom
// Init-Worker gesetzten Variablen), die Prozessvariablen der Spezifikation und
// die Ausgaben aller Schritte. Letztere haben meist keinen bekannten Typ —
// bei ihnen bleibt die Prüfung stumm, statt falsch zu warnen.

import { evaluate, FeelDate, FeelDateTime, FeelDuration, FeelTime, SyntaxError as FeelSyntaxError } from 'feelin';
import type { DomainType, EngineId, Field, Model, MultiInstanceSpec, ProcessSpec, ServiceDef, Step, TypeDef } from './types';
import { FEEL_DOCS, type FeelDoc } from './feelDocs';
import { SCALA_TYPES, isAdt } from './types';
import { indexTypes, type TypeIndex } from './scala';
import { typeShape } from './scalaTypes';
import { domainMember, initOutputs, loopSettings, resolveType } from './interactions';
import { domainRef, parseDomainRef } from './serviceTypes';
import { allSteps } from './bpmn';
import { ALL_VARIANTS, chosenVariant, variantsOf } from './variants';

export type FeelType =
  | 'string' | 'number' | 'boolean' | 'date' | 'date time' | 'time' | 'duration'
  | 'list' | 'context' | 'nil' | 'any';

export const FEEL_TYPE_LABEL: Record<FeelType, string> = {
  string: 'Text', number: 'Zahl', boolean: 'Ja/Nein', date: 'Datum', 'date time': 'Datum + Zeit',
  time: 'Zeit', duration: 'Dauer', list: 'Liste', context: 'Objekt', nil: 'null', any: 'unbekannt',
};

/** Ein Knoten im Variablenbaum — eine Prozessvariable oder ein Feld darin. */
export interface VarNode {
  name: string;
  type: FeelType;
  /** Scala-Typ zur Anzeige, z. B. `Option[Seq[InAddress]]` */
  label: string;
  description?: string;
  /** Felder (bei Objekt) bzw. Felder der Elemente (bei Liste) */
  children?: VarNode[];
  /** Objekt mit beliebigen Schlüsseln (Map) — Pfade darin lassen sich nicht prüfen */
  open?: boolean;
  optional?: boolean;
  /** woher die Variable kommt: `In`, `InitIn`, `Variable`, `Ausgabe von …` */
  source: string;
}

/** Was am Zielfeld ankommen darf. */
export interface ExpectedType {
  accepts: FeelType[];
  label: string;
  /** Art des Typs — bestimmt Farbe und Zeichen des Chips in der Mapping-Zeile */
  kind: ExpectedKind;
  /** bei einem einfachen enum die erlaubten Werte — bei einem festen Fall genau einer */
  values?: string[];
}

export type ExpectedKind = 'scalar' | 'enum' | 'class' | 'list' | 'map';

/**
 * Was die Bedingung eines Zweigs liefern muss: ein Boolean — `null` geht auch.
 * In Camunda 7 wird es in JUEL zu `false`, in Camunda 8 schreibt der Export
 * die Bedingung null-sicher (`(…) = true`, siehe nullSafeCondition). Ein
 * fehlender optionaler Wert nimmt so in beiden Engines den anderen Zweig.
 */
export const conditionExpected = (_engine?: EngineId): ExpectedType =>
  ({ accepts: ['boolean', 'nil'], label: 'Bedingung', kind: 'scalar' });

export interface FeelIssue {
  level: 'error' | 'warn';
  text: string;
}

const isScalar = (t: string): boolean => (SCALA_TYPES as readonly string[]).includes(t);

// Prozessvariablen sind JSON: Datum, Zeit und Dauer kommen als Text an.
// Der Beispielwert ist deshalb ein Text; ein Zielfeld dieses Typs nimmt
// beides — den Text und den echten FEEL-Wert (`date(…)`, `today()`).
const SCALAR_FEEL: Record<string, FeelType> = {
  String: 'string', Iban: 'string', Iso8601Duration: 'string',
  Boolean: 'boolean',
  Int: 'number', Long: 'number', Double: 'number', BigDecimal: 'number',
  LocalDate: 'string', LocalDateTime: 'string',
};
const SCALAR_ACCEPTS: Record<string, FeelType[]> = {
  LocalDate: ['string', 'date'],
  LocalDateTime: ['string', 'date time'],
  Iso8601Duration: ['string', 'duration'],
};

// ── Variablenbaum ────────────────────────────────────────────────────────────

const MAX_DEPTH = 6;

export { enumHasCase, splitEnumCase } from './scalaTypes';
import { enumHasCase, splitEnumCase } from './scalaTypes';

interface Builder { idx: TypeIndex; model: Model | null }

/** Ein Feld des Klassenbauers als Knoten — mit seinen Unterfeldern. */
/** Ein Feld mit Vorgabewert ist immer da — auch wenn es `Option[…]` ist */
const mayBeMissing = (f: { optional?: boolean; default?: string }): boolean => !!f.optional && !f.default?.trim();

function nodeOfField(f: Field, source: string, b: Builder, depth: number, seen: Set<string>): VarNode {
  return nodeOf(f.name, f.type, {
    optional: mayBeMissing(f), collection: !!f.collection, map: !!f.map, enumCase: f.enumCase, description: f.description, source,
    label: fieldLabel(f, b.idx),
  }, b, depth, seen);
}

function fieldLabel(f: Field, idx: TypeIndex): string {
  let t = idx.nameOf(f.type);
  if (f.enumCase) t = `${t}.${f.enumCase}`;
  if (f.map) t = `Map[String, ${t}]`;
  if (f.collection) t = `Seq[${t}]`;
  if (f.optional) t = `Option[${t}]`;
  return t;
}

function nodeOf(
  name: string, typeRef: string,
  o: { optional: boolean; collection: boolean; map?: boolean; enumCase?: string; description?: string; source: string; label: string },
  b: Builder, depth: number, seen: Set<string>,
): VarNode {
  const base = baseNode(typeRef, b, depth, seen, o.enumCase);
  // Eine Map ist ein Objekt mit beliebigen Schlüsseln — ihre Werte kennt der
  // Baum, die Schlüssel nicht; Pfade hinein bleiben deshalb ungeprüft
  const node: VarNode = {
    name, source: o.source, label: o.label,
    type: o.collection ? 'list' : o.map ? 'context' : base.type,
    ...(o.description ? { description: o.description } : {}),
    ...(o.optional ? { optional: true } : {}),
    ...(o.map && !o.collection ? { open: true } : {}),
  };
  if (base.children?.length && !o.map) node.children = base.children;
  return node;
}

/** Typ und Unterfelder eines Grundtyps (ohne Option/Seq); `enumCase` = nur diese Ausprägung. */
function baseNode(typeRef: string, b: Builder, depth: number, seen: Set<string>, enumCase?: string): { type: FeelType; children?: VarNode[] } {
  if (isScalar(typeRef)) return { type: SCALAR_FEEL[typeRef] ?? 'string' };
  if (depth >= MAX_DEPTH || seen.has(typeRef)) return { type: 'context' };
  const inner = new Set(seen).add(typeRef);

  const own = b.idx.byId.get(typeRef);
  if (own) {
    // ein ADT ist im JSON ein Objekt — sichtbar sind die Felder aller Fälle,
    // bei einer Ausprägung nur die gemeinsamen und die dieses Falls
    if (own.kind === 'enum' && !isAdt(own)) return { type: 'string' };
    const cases = (own.values ?? []).filter(v => !enumCase || v.name === enumCase);
    const fields = own.kind === 'enum' ? [...(own.fields ?? []), ...cases.flatMap(v => v.fields ?? [])] : (own.fields ?? []);
    const seenNames = new Set<string>();
    return { type: 'context', children: fields.filter(f => f.name && !seenNames.has(f.name) && seenNames.add(f.name)).map(f => nodeOfField(f, `Feld von ${own.name}`, b, depth + 1, inner)) };
  }

  const dom = b.idx.domainOf(typeRef);
  if (dom) return domainNode(dom, b, depth, inner, enumCase);

  // Service-Objekt (`svc:`): der Katalog kennt es vielleicht unter seinem Namen
  const svc = b.idx.serviceOf(typeRef);
  if (svc) {
    const found = resolveType(svc.name, b.model, svc.pkg);
    if (found) return domainNode(found, b, depth, inner);
    return { type: 'context' };
  }
  return { type: 'any' };
}

function domainNode(dom: DomainType, b: Builder, depth: number, seen: Set<string>, enumCase?: string): { type: FeelType; children?: VarNode[] } {
  if (dom.kind === 'enum' && !dom.cases?.length && !dom.fields?.length) return { type: 'string' };
  if (dom.kind === 'alias') return { type: 'any' };
  const seenNames = new Set<string>();
  const cases = (dom.cases ?? []).filter(c => !enumCase || c.name === enumCase);
  const fields = dom.kind === 'enum'
    ? [...(dom.fields ?? []), ...cases.flatMap(c => c.fields ?? [])].filter(p => !seenNames.has(p.name) && seenNames.add(p.name))
    : (dom.fields ?? []);
  const children = fields.map(p => {
    const shape = typeShape(p.type);
    const scalar = isScalar(shape.base);
    const ref = scalar ? null : resolveType(shape.base, b.model, dom.pkg);
    // `CustomDocContents.\`QI-Deklaration\`` — eine Ausprägung eines ADT-enums
    const split = !scalar && !ref ? splitEnumCase(shape.base) : null;
    const enumRef = split ? resolveType(split.base, b.model, dom.pkg) : null;
    const isCase = !!split && enumHasCase(enumRef, split.enumCase);
    const typeRef = scalar ? shape.base : ref ? domainRef(ref.id) : isCase ? domainRef(enumRef!.id) : shape.base;
    return nodeOf(p.name, typeRef, {
      optional: shape.optional && !p.default?.trim(), collection: shape.collection, map: shape.map, ...(isCase ? { enumCase: split!.enumCase } : {}), description: p.description,
      source: `Feld von ${dom.name}`, label: p.type,
    }, b, depth + 1, seen);
  });
  return { type: 'context', children };
}

/**
 * Alle Prozessvariablen mit ihren Pfaden. Bei gleichem Namen gilt die erste
 * Quelle — und zuerst kommt, was im Prozess **wirksam** ist: das `InitIn`
 * (der Init-Worker setzt es zu Beginn; ein optionales Feld des `In` hat dort
 * seinen Pflicht-Zwilling mit Vorgabe), dann das `InConfig` (immer mit
 * Vorgabe), dann das `In`, die Prozessvariablen und die Ausgaben.
 */
export function processVariables(spec: ProcessSpec, model: Model | null): VarNode[] {
  const types = spec.types ?? [];
  const b: Builder = { idx: indexTypes(types, model), model };
  const out: VarNode[] = [];
  const have = new Set<string>();
  const add = (n: VarNode) => { if (n.name && !have.has(n.name)) { have.add(n.name); out.push(n); } };

  // Das InitIn — als Typ beschrieben; sonst kennt man nur die Namen (unten, nach dem In)
  const initIn = types.find(t => t.initIn);
  if (initIn) for (const f of initIn.fields ?? []) add(nodeOfField(f, 'InitIn', b, 0, new Set()));

  // Das InConfig — eigene Stellschrauben und die der Schleifen; alle mit
  // Vorgabe, also immer da
  const inConfig = types.find(t => t.inConfig);
  for (const f of inConfig?.fields ?? []) add(nodeOfField(f, 'InConfig', b, 0, new Set()));
  for (const l of loopSettings(spec)) {
    const t = l.kind === 'timer' ? 'Iso8601Duration' : 'Int';
    add(nodeOf(l.name, t, { optional: false, collection: false, source: 'InConfig', label: t }, b, 0, new Set()));
  }

  // Das In — als ADT die gemeinsamen Felder und die aller Fälle (im JSON
  // stehen sie nebeneinander; welcher Fall es ist, entscheidet sich zur Laufzeit)
  const root = types.find(t => t.root);
  const rootFields = root?.kind === 'enum'
    ? [...(root.fields ?? []), ...(root.values ?? []).flatMap(v => v.fields ?? [])]
    : (root?.fields ?? []);
  for (const f of rootFields) add(nodeOfField(f, 'In', b, 0, new Set()));

  // ohne InitIn-Typ: die Ausgaben des Init-Workers, Typ unbekannt — nach dem
  // In, damit dessen Typ nicht verloren geht
  if (!initIn) for (const o of initOutputs(spec)) add({ name: o.name, type: 'any', label: '?', source: 'InitIn', ...(o.description ? { description: o.description } : {}) });

  for (const v of spec.variables ?? []) {
    const t = (v.type ?? '').trim();
    add(isScalar(t)
      ? nodeOf(v.name, t, { optional: false, collection: false, description: v.description, source: 'Variable', label: t }, b, 0, new Set())
      : { name: v.name, type: 'any', label: t || '?', source: 'Variable', ...(v.description ? { description: v.description } : {}) });
  }

  for (const s of allSteps(spec.steps)) {
    for (const o of s.outputs ?? []) {
      if (o.disabled) continue;
      add({ name: o.name, type: 'any', label: '?', source: `Ausgabe von ${s.name || s.id}`, ...(o.description ? { description: o.description } : {}) });
    }
  }
  return out;
}

/**
 * Was im **Quell-Ausdruck einer Ausgabe** sichtbar ist: das Ergebnis des
 * Services. Der Worker gibt sein `Out` zurück, und dessen Felder werden zu
 * Variablen des Jobs — `= accountId`, nicht `= out.accountId`. Dazu die
 * Prozessvariablen, die in Camunda 8 im selben Kontext stehen.
 *
 * Woher das `Out` kommt: die Out-Klasse der Interaktion; sonst das
 * `<Objekt>.Out` im Domain-Katalog (über Topic bzw. gerufenen Prozess);
 * sonst die Ausgabe-Parameter des Katalog-Eintrags, ohne Typ.
 */
/**
 * Das `In` bzw. `Out` des Service-Objekts im Domain-Katalog — gefunden über
 * das Topic, den gerufenen Prozess oder den Namen der Interaktion. Dort
 * stehen die **echten** Scala-Typen; sie sind der Massstab, wo der Schritt
 * keine eigene Klasse hat.
 */
export function stepDomainMember(step: Step, spec: ProcessSpec, model: Model | null, member: 'In' | 'Out'): DomainType | null {
  const all = model?.domainTypes ?? [];
  const ia = (spec.interactions ?? []).find(i => i.stepId === step.id);
  const owner = step.topic ? all.find(t => t.topicName === step.topic && t.owner)?.owner
    : step.calledProcess ? all.find(t => t.processName === step.calledProcess && t.owner)?.owner
    : ia?.name;
  return owner ? domainMember(owner, member, model) : null;
}

/** Erwarteter Typ eines Feldes laut Domain-Katalog — `null`, wenn unbekannt. */
/** Ein Feld des Domain-Typs — bei einem enum auch aus seinen Fällen */
const domainField = (dom: DomainType | null, name: string) =>
  dom?.fields?.find(f => f.name === name) ?? dom?.cases?.flatMap(c => c.fields ?? []).find(f => f.name === name);

export function expectedFromDomain(dom: DomainType | null, name: string, model: Model | null): ExpectedType | null {
  const p = domainField(dom, name);
  if (!p) return null;
  const shape = typeShape(p.type);
  let accepts: FeelType[];
  let kind: ExpectedKind;
  let values: string[] | undefined;
  if (shape.collection) { accepts = ['list']; kind = 'list'; }
  else if (shape.map) { accepts = ['context']; kind = 'map'; }
  else if (isScalar(shape.base)) { accepts = SCALAR_ACCEPTS[shape.base] ?? [SCALAR_FEEL[shape.base] ?? 'string']; kind = 'scalar'; }
  else {
    // `ProcessStatus.canceled.type` — ein fester Fall: genau dieser Wert
    const split = resolveType(shape.base, model, dom!.pkg) ? null : splitEnumCase(shape.base);
    const caseOf = split ? resolveType(split.base, model, dom!.pkg) : null;
    if (split && caseOf && enumHasCase(caseOf, split.enumCase) && !caseOf.cases?.length && !caseOf.fields?.length) {
      return { accepts: shape.optional ? ['string', 'nil'] : ['string'], label: p.type, kind: 'enum', values: [split.enumCase] };
    }
    const ref = resolveType(shape.base, model, dom!.pkg);
    if (!ref) return null;                    // Typ nicht im Katalog — kein Urteil
    if (ref.kind === 'enum' && !ref.cases?.length && !ref.fields?.length) { accepts = ['string']; kind = 'enum'; values = ref.values; }
    else if (ref.kind === 'alias') return null;
    else { accepts = ['context']; kind = ref.kind === 'enum' ? 'enum' : 'class'; }
  }
  // fehlt der Wert, greift die Vorgabe — null ist dann erlaubt
  if (shape.optional || p.default?.trim()) accepts = [...accepts, 'nil'];
  return { accepts, label: p.type, kind, ...(values?.length ? { values } : {}) };
}

/** Ist das Feld laut Domain-Katalog Pflicht (nicht `Option[…]`)? null = Feld unbekannt. */
export function domainRequired(dom: DomainType | null, name: string): boolean | null {
  const p = domainField(dom, name);
  if (!p) return null;
  return !typeShape(p.type).optional && !p.default;
}

export function resultVariables(step: Step, spec: ProcessSpec, model: Model | null, service: ServiceDef | null): VarNode[] {
  const types = spec.types ?? [];
  const b: Builder = { idx: indexTypes(types, model), model };
  const out: VarNode[] = [];
  const have = new Set<string>();
  const add = (n: VarNode) => { if (n.name && !have.has(n.name)) { have.add(n.name); out.push(n); } };

  const ia = (spec.interactions ?? []).find(i => i.stepId === step.id);
  const ownOut = ia?.outTypeId ? types.find(t => t.id === ia.outTypeId) : undefined;
  if (ownOut) {
    for (const f of ownOut.fields ?? []) add(nodeOfField(f, `Ergebnis (${ownOut.name})`, b, 0, new Set()));
  } else {
    const dom = stepDomainMember(step, spec, model, 'Out');
    if (dom?.fields?.length || dom?.cases?.some(c => c.fields?.length)) {
      // enum mit Fällen: die gemeinsamen Felder und die der gewählten Ausprägung
      const v = dom.cases?.length ? variantsOf(step, spec, model, 'outputs', service) : null;
      // ohne Wahl kein Fall — ein Name, den es nicht gibt (leer hiesse: alle)
      const chosen = v ? chosenVariant(step, 'outputs', v).name : null;
      const enumCase = !v || chosen === ALL_VARIANTS ? undefined : chosen ?? '\u0000';
      for (const n of domainNode(dom, b, 0, new Set([domainRef(dom.id)]), enumCase).children ?? []) add({ ...n, source: `Ergebnis (${dom.name})` });
    } else {
      for (const p of service?.outputs ?? []) add({ name: p.name, type: 'any', label: '?', source: 'Ergebnis (Katalog)', ...(p.description ? { description: p.description } : {}) });
    }
  }
  for (const v of processVariables(spec, model)) add(v);
  return out;
}

/** Erwarteter Typ eines Zielfelds — `null`, wenn er nicht bekannt ist. */
export function expectedFor(f: Field | undefined, types: TypeDef[] = [], model: Model | null = null): ExpectedType | null {
  if (!f) return null;
  const idx = indexTypes(types, model);
  let accepts: FeelType[];
  let kind: ExpectedKind;
  let values: string[] | undefined;
  if (f.collection) { accepts = ['list']; kind = 'list'; }
  else if (f.map) { accepts = ['context']; kind = 'map'; }
  else if (isScalar(f.type)) { accepts = SCALAR_ACCEPTS[f.type] ?? [SCALAR_FEEL[f.type] ?? 'string']; kind = 'scalar'; }
  else {
    const own = idx.byId.get(f.type);
    const dom = idx.domainOf(f.type);
    const enumish = own?.kind === 'enum' || dom?.kind === 'enum';
    if ((own?.kind === 'enum' && !isAdt(own)) || (dom?.kind === 'enum' && !dom.cases?.length && !dom.fields?.length)) {
      accepts = ['string']; kind = 'enum';
      // ein fester Fall lässt nur seinen Wert zu, sonst jeder Fall der Auswahl
      values = f.enumCase ? [f.enumCase.replace(/^`|`$/g, '')] : own ? (own.values ?? []).map(v => v.name).filter(Boolean) : dom?.values;
    }
    else if (dom?.kind === 'alias') return null;
    else { accepts = ['context']; kind = enumish ? 'enum' : 'class'; }
  }
  // fehlt der Wert, greift die Vorgabe — null ist dann erlaubt
  if (f.optional || f.default?.trim()) accepts = [...accepts, 'nil'];
  return { accepts, label: fieldLabel(f, idx), kind, ...(values?.length ? { values } : {}) };
}

// ── Beispielwerte ────────────────────────────────────────────────────────────

const SAMPLE: Partial<Record<FeelType, unknown>> = {
  string: 'text', number: 1, boolean: true, date: '2024-01-31', 'date time': '2024-01-31T12:00:00', time: '12:00:00', duration: 'PT1M',
};

function sampleOf(n: VarNode): unknown {
  if (n.type === 'list') return [n.children?.length ? sampleContext(n.children) : 'text'];
  if (n.open) return {};
  if (n.type === 'context') return sampleContext(n.children ?? []);
  if (n.type === 'any') return 'text';
  return SAMPLE[n.type] ?? null;
}

export function sampleContext(vars: VarNode[]): Record<string, unknown> {
  const ctx: Record<string, unknown> = {};
  for (const v of vars) ctx[v.name] = sampleOf(v);
  return ctx;
}

// ── Prüfung ──────────────────────────────────────────────────────────────────

export const isFeel = (expression: string): boolean => expression.trimStart().startsWith('=');

export function feelType(value: unknown): FeelType {
  if (value === null || value === undefined) return 'nil';
  if (Array.isArray(value)) return 'list';
  if (value instanceof FeelDate) return 'date';
  if (value instanceof FeelDateTime) return 'date time';
  if (value instanceof FeelTime) return 'time';
  if (value instanceof FeelDuration) return 'duration';
  if (typeof value === 'object') return 'context';
  if (typeof value === 'function') return 'any';
  return typeof value as FeelType;
}

/** `client.address.` vor einer Position → die Pfadglieder `client`, `address` */
function chainBefore(text: string, at: number): string[] | null {
  const m = /([A-Za-z_][\w]*(?:\s*\.\s*[A-Za-z_][\w]*)*)\s*\.\s*$/.exec(text.slice(0, at));
  return m ? m[1].replace(/\s/g, '').split('.') : null;
}

/** Liegt auf dem Pfad ein Knoten ohne bekannten Inhalt (Typ unbekannt oder Map)? */
function openOnPath(vars: VarNode[], chain: string[]): boolean {
  let pool = vars;
  for (const seg of chain) {
    const n = pool.find(v => v.name === seg);
    if (!n) return false;
    if (n.type === 'any' || n.open) return true;
    pool = n.children ?? [];
  }
  return false;
}

/**
 * Die Felder der Elemente der Liste, die an dieser Stelle gefiltert wird
 * (`liste[ … hier … ]`) — null, wenn man sie nicht kennt: die Liste ist
 * unbekannt, ohne Typ, offen oder ohne bekannte Felder.
 */
function filteredElements(body: string, at: number, vars: VarNode[]): VarNode[] | null {
  const code = body.slice(0, at).replace(/"(?:[^"\\]|\\.)*"/g, m => ' '.repeat(m.length));
  let depth = 0, open = -1;
  for (let i = code.length - 1; i >= 0; i--) {
    if (code[i] === ']') depth++;
    else if (code[i] === '[') { if (depth === 0) { open = i; break; } depth--; }
  }
  if (open < 0) return null;
  const m = /([A-Za-z_][\w]*(?:\s*\.\s*[A-Za-z_][\w]*)*)\s*$/.exec(code.slice(0, open));
  if (!m) return null;
  let pool = vars, node: VarNode | undefined;
  for (const seg of m[1].replace(/\s/g, '').split('.')) {
    node = pool.find(v => v.name === seg);
    if (!node) return null;
    if (node.type === 'any' || node.open) return null;
    pool = node.children ?? [];
  }
  return node?.type === 'list' && node.children?.length ? node.children : null;
}

/** Namen im Ausdruck, die eine Variable ohne bekannten Typ treffen. */
function touchesUnknown(body: string, vars: VarNode[]): boolean {
  const unknown = new Set(vars.filter(v => v.type === 'any').map(v => v.name));
  if (!unknown.size) return false;
  const code = body.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  for (const m of code.matchAll(/(?<![\w.])([A-Za-z_]\w*)/g)) if (unknown.has(m[1])) return true;
  return false;
}

/** Ist der Ausdruck ein blosser Pfad, auf dem etwas fehlen darf? Dann welches Glied. */
function optionalOnPath(body: string, vars: VarNode[]): { path: string; label: string } | null {
  if (!/^[A-Za-z_]\w*(\s*\.\s*[A-Za-z_]\w*)*$/.test(body)) return null;
  const chain = body.replace(/\s/g, '').split('.');
  let pool = vars;
  for (let i = 0; i < chain.length; i++) {
    const n = pool.find(v => v.name === chain[i]);
    if (!n) return null;
    if (n.optional) return { path: chain.slice(0, i + 1).join('.'), label: n.label };
    if (n.type === 'any' || n.open) return null;
    pool = n.children ?? [];
  }
  return null;
}

const quoted = (msg: string): string => /'([^']*)'/.exec(msg)?.[1] ?? '';

// Camunda-Funktionen, die `feelin` nicht kennt (Scala-FEEL der Engine hat sie).
// Sie stehen im Auswertekontext; die Namen mit Leerzeichen erkennt der Parser
// dort selbst. `is defined` und `get or else` dürfen auf Unbekanntes zeigen —
// dafür sind sie da (siehe `guardedSpans`).
const CAMUNDA_FUNCTIONS: Record<string, unknown> = {
  'is defined': (v: unknown) => v !== undefined && v !== null,
  'get or else': (v: unknown, d: unknown) => v ?? d,
  trim: (s: unknown) => typeof s === 'string' ? s.trim() : null,
  'from json': (s: unknown) => { try { return typeof s === 'string' ? JSON.parse(s) : null; } catch { return null; } },
  'to json': (o: unknown) => JSON.stringify(o) ?? null,
};

// Namen, die die Engine in Multi-Instance-Aktivitäten setzt: `loopCounter`
// und das Element der Sammlung (Name aus dem BPMN)

/** Die Mehrfachausführungen, in denen ein Schritt liegt — er selbst und seine Vorfahren (Subprozesse) */
export function multiInstanceScopes(steps: Step[] | undefined): Map<string, MultiInstanceSpec[]> {
  const out = new Map<string, MultiInstanceSpec[]>();
  const visit = (list: Step[] | undefined, inherited: MultiInstanceSpec[]) => {
    for (const s of list ?? []) {
      const own = s.multiInstance ? [...inherited, s.multiInstance] : inherited;
      out.set(s.id, own);
      // die Kinder eines Subprozesses und die Pfade an Gateways/Fehlern liegen im selben Bereich
      visit(s.children, own);
      for (const b of s.branches ?? []) visit(b.steps, inherited);
      for (const e of s.errors ?? []) visit(e.steps, inherited);
    }
  };
  visit(steps, []);
  return out;
}

/**
 * Die Variablen, die in einer Mehrfachausführung dazukommen: `loopCounter`
 * und das Element der Sammlung. Zeigt die Sammlung auf eine Liste mit bekannten
 * Feldern, hat das Element diese Felder; sonst bleibt sein Typ offen.
 */
export function withMultiInstance(vars: VarNode[], scopes: MultiInstanceSpec[] | undefined): VarNode[] {
  if (!scopes?.length) return vars;
  const out = [...vars];
  const add = (n: VarNode) => { if (!out.some(v => v.name === n.name)) out.unshift(n); };
  add({ name: 'loopCounter', type: 'number', label: 'Int', source: 'Mehrfachausführung', description: 'Nummer des aktuellen Durchlaufs, ab 1' });
  for (const mi of scopes) {
    const name = mi.element?.trim();
    if (!name) continue;
    const coll = mi.collection?.trim() ?? '';
    let pool = vars;
    let hit: VarNode | undefined;
    if (/^[A-Za-z_]\w*(\s*\.\s*[A-Za-z_]\w*)*$/.test(coll)) {
      for (const seg of coll.replace(/\s/g, '').split('.')) { hit = pool.find(v => v.name === seg); if (!hit) break; pool = hit.children ?? []; }
    } else hit = undefined;
    const fields = hit?.type === 'list' && hit.children?.length ? hit.children : null;
    add({
      name, source: 'Mehrfachausführung', description: `Aktuelles Element von «${coll || 'Sammlung'}»`,
      type: fields ? 'context' : 'any', label: fields ? 'Element' : '?',
      ...(fields ? { children: fields } : {}),
    });
  }
  return out;
}

/**
 * Bereiche im Ausdruck, in denen Fehlendes erlaubt ist: das Argument von
 * `is defined(…)` und das erste von `get or else(…, …)`. Was `feelin` dort
 * als «nicht gefunden» meldet, ist genau die Absicherung — keine Warnung.
 */
function guardedSpans(body: string): { from: number; to: number }[] {
  const spans: { from: number; to: number }[] = [];
  const code = body.replace(/"(?:[^"\\]|\\.)*"/g, m => '"'.padEnd(m.length - 1, '_') + '"');
  for (const m of code.matchAll(/\b(is\s+defined|get\s+or\s+else)\s*\(/g)) {
    const from = m.index! + m[0].length;
    let depth = 1;
    let to = code.length;
    for (let i = from; i < code.length; i++) {
      const c = code[i];
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') { if (--depth === 0) { to = i; break; } }
      else if (c === ',' && depth === 1 && /^get/.test(m[1])) { to = i; break; }
    }
    spans.push({ from, to });
  }
  return spans;
}

export interface FeelCheck {
  issues: FeelIssue[];
  /** Typ des Ergebnisses — null, wenn nicht auswertbar */
  result: FeelType | null;
}

/**
 * Einen Mapping-Wert prüfen. `vars` = die Prozessvariablen; ohne sie wird nur
 * die Syntax geprüft (Ausgaben zeigen auf das Ergebnis des Services, nicht
 * auf den Prozess). `expected` = was das Zielfeld verlangt.
 */
/** Ein Text, der fest dasteht, muss ein Wert der Auswahl sein — bei einem festen Fall genau dieser. */
function enumValueIssues(body: string, expected: ExpectedType | null): FeelIssue[] {
  const literal = /^"((?:[^"\\]|\\.)*)"$/.exec(body)?.[1];
  if (!expected?.values?.length || literal == null || expected.values.includes(literal)) return [];
  return [{
    level: 'error',
    text: expected.values.length === 1
      ? `«${expected.label}» hat nur den Wert «${expected.values[0]}».`
      : `«${literal}» ist kein Wert von ${expected.label} — erlaubt: ${expected.values.join(', ')}.`,
  }];
}

export function checkFeel(expression: string, vars: VarNode[] | null, expected: ExpectedType | null = null): FeelCheck {
  const source = expression.trimStart().slice(1).trim();
  // `feelin` kennt die Schreibweise `` `mein-name` `` nicht: der Name wird durch
  // einen Platzhalter ersetzt, der im Kontext denselben Wert trägt
  const aliases = new Map<string, string>();
  const parts = source.split(/("(?:[^"\\]|\\.)*")/);
  const body = parts.map((part, i) => i % 2 ? part : part.replace(/`([^`]+)`/g, (_, name: string) => {
    const alias = `__q${aliases.size}`;
    aliases.set(alias, name);
    return alias;
  })).join('').trim();
  const shown = (msg: string): string => msg.replace(/__q\d+/g, a => aliases.get(a) ?? a);
  if (aliases.size && vars) {
    vars = [...vars, ...[...aliases].flatMap(([alias, name]) => vars!.filter(v => v.name === name).map(v => ({ ...v, name: alias })))];
  }
  if (!body) return { issues: [{ level: 'error', text: 'Nach «=» fehlt der FEEL-Ausdruck.' }], result: null };
  // `liste[0]` ist in FEEL immer null — Listen zählen ab 1
  if (/\[\s*0\s*\]/.test(body.replace(/"(?:[^"\\]|\\.)*"/g, '""'))) {
    return { issues: [{ level: 'error', text: 'Index [0] gibt es in FEEL nicht — Listen zählen ab 1, das erste Element ist [1].' }], result: null };
  }

  let value: unknown;
  let warnings: { type: string; message: string; position: { from: number; to: number } }[];
  try {
    const r = evaluate(body, { ...CAMUNDA_FUNCTIONS, ...(vars ? sampleContext(vars) : {}) });
    value = r.value;
    warnings = r.warnings;
  } catch (e) {
    if (e instanceof FeelSyntaxError) {
      const at = e.position?.from ?? 0;
      return { issues: [{ level: 'error', text: `Kein gültiges FEEL — Fehler an Position ${at + 1}${at >= body.length ? ' (Ausdruck unvollständig)' : ''}.` }], result: null };
    }
    return { issues: [{ level: 'error', text: `Kein gültiges FEEL: ${e instanceof Error ? e.message : String(e)}` }], result: null };
  }

  const issues: FeelIssue[] = [];
  if (!vars) return { issues: issues.length ? issues : enumValueIssues(body, expected), result: feelType(value) };

  const unknown = touchesUnknown(body, vars) || /\bfrom\s+json\s*\(/.test(body);
  const guarded = guardedSpans(body);
  // `if is defined(x) and x != null …` — das zweite `x` ist abgesichert, auch wenn es fehlt
  const guardedNames = new Set([...body.matchAll(/\b(?:is\s+defined|get\s+or\s+else)\s*\(\s*([A-Za-z_]\w*)/g)].map(m => m[1]));
  let pathFailed = false;
  for (const w of warnings) {
    if (guarded.some(g => w.position.from >= g.from && w.position.to <= g.to)) continue;
    if (w.type === 'NO_VARIABLE_FOUND' && guardedNames.has(quoted(w.message))) { pathFailed = true; continue; }
    switch (w.type) {
      case 'NO_VARIABLE_FOUND': {
        const raw = quoted(w.message);
        const name = shown(raw);
        const re = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // feelin meldet auch Namen wie «??»
        // eine unbekannte Funktion meldet feelin zuerst als Variable
        if (warnings.some(x => x.type === 'NO_FUNCTION_FOUND' && x.position.from === w.position.from)) {
          issues.push({ level: 'error', text: `Funktion «${name}» gibt es nicht.` });
        } else if (new RegExp(`\\b(?:for|some|every)\\s+${re}\\s+in\\b[^\\]]*\\[[^\\]]*(?<![\\w.])${re}\\s*\\.`).test(body)) {
          // `for i in items[i.active = true]` — die Schleifenvariable gilt erst nach dem `in`
          issues.push({ level: 'error', text: `«${name}» ist im Filter der Sammlung noch nicht gebunden — dort heisst das Element «item» (oder man schreibt das Feld direkt: «items[active = true]»).` });
        } else {
          issues.push({ level: 'error', text: `Variable «${name}» ist nicht bekannt — weder als Prozessvariable noch im Ergebnis.` });
        }
        pathFailed = true;
        break;
      }
      case 'NO_CONTEXT_ENTRY_FOUND':
      case 'NO_PROPERTY_FOUND': {
        const chain = chainBefore(body, w.position.from);
        // Typ unbekannt oder Map — kein Urteil, auch nicht über das Ergebnis
        if (chain && openOnPath(vars, chain)) { pathFailed = true; break; }
        // `liste[item.feld = …]`: `item` ist ein Element der gefilterten Liste — kennt
        // man deren Elemente nicht (JSON, Liste ohne bekannte Felder), gibt es kein Urteil
        if (chain?.[0] === 'item') {
          const elements = filteredElements(body, w.position.from, vars);
          if (elements === null || openOnPath(elements, chain.slice(1))) { pathFailed = true; break; }
        }
        if (pathFailed && w.type === 'NO_PROPERTY_FOUND') break; // Folgefehler auf null
        const key = shown(quoted(w.message));
        const prefix = /([A-Za-z_][\w]*(?:\s*\.\s*[A-Za-z_][\w]*)*)\s*\.\s*$/.exec(body.slice(0, w.position.from))?.[1]?.replace(/\s/g, '');
        const text = prefix ? `Pfad «${shown(prefix)}.${key}» gibt es nicht — «${shown(prefix)}» hat kein Feld «${key}».` : `Feld «${key}» gibt es nicht.`;
        // derselbe Pfad mehrmals im Ausdruck — einmal gemeldet genügt
        if (!issues.some(i => i.text === text)) issues.push({ level: 'error', text });
        pathFailed = true;
        break;
      }
      case 'NO_FUNCTION_FOUND':
        break; // schon über NO_VARIABLE_FOUND gemeldet
      case 'INVALID_TYPE':
      case 'NOT_COMPARABLE':
      case 'INVALID_ARGUMENTS':
        if (unknown || pathFailed) break;
        issues.push({ level: 'error', text: `Typen passen nicht zusammen: ${shown(w.message)}` });
        break;
      default:
        issues.push({ level: 'warn', text: shown(w.message) });
    }
  }

  const result = feelType(value);
  // Ein optionaler Wert (ohne Vorgabe) auf ein Pflichtfeld: die Beispielwerte
  // sind nie null, darum hier am Pfad selbst — `= client.address.zip`
  if (!issues.length && expected && !expected.accepts.includes('nil') && !unknown && !pathFailed) {
    const opt = optionalOnPath(body, vars);
    if (opt) {
      issues.push({
        level: 'warn',
        text: `«${opt.path}» ist optional (${opt.label}) — «${expected.label}» verlangt aber einen Wert. Vorgabe setzen oder absichern (\`if … != null then … else …\`).`,
      });
    }
  }
  if (!issues.length && expected && !unknown && !pathFailed) {
    if (!expected.accepts.includes(result)) {
      const soll = expected.accepts.filter(t => t !== 'nil').map(t => FEEL_TYPE_LABEL[t]).join(' oder ');
      issues.push({
        level: result === 'nil' ? 'warn' : 'error',
        text: result === 'nil'
          ? `Ergebnis ist null — das Feld «${expected.label}» ist aber nicht optional.`
          : `Ergebnis ist ${FEEL_TYPE_LABEL[result]}, das Feld erwartet ${soll} (${expected.label}).`,
      });
    }
  }
  if (!issues.length) issues.push(...enumValueIssues(body, expected));
  return { issues, result: unknown || pathFailed ? null : result };
}

// ── Vervollständigung ────────────────────────────────────────────────────────

export interface Completion {
  /** was eingesetzt wird */
  insert: string;
  /** Variable bzw. Feld — fehlt bei Funktionen und Schlüsselwörtern */
  node?: VarNode;
  /** Funktion bzw. Schlüsselwort mit Erklärung */
  doc?: FeelDoc;
  /** voller Pfad zur Anzeige */
  path: string;
  /** Zeichen, die der Cursor nach dem Einsetzen zurückspringt (in die Klammer) */
  back?: number;
}

export interface CompletionResult {
  from: number;
  to: number;
  items: Completion[];
}

/**
 * Vorschläge für den Pfad unter dem Cursor: `client.addr|` → die Felder von
 * `client`, die mit `addr` beginnen. Ausserhalb eines FEEL-Ausdrucks (kein
 * `=`) oder innerhalb einer Zeichenkette gibt es keine.
 */
export function completions(text: string, cursor: number, vars: VarNode[]): CompletionResult | null {
  if (!isFeel(text)) return null;
  const eq = text.indexOf('=');
  if (cursor <= eq) return null;
  const before = text.slice(0, cursor);
  // in einer Zeichenkette? (ungerade Zahl von Anführungszeichen davor)
  if ((before.slice(eq + 1).match(/"/g)?.length ?? 0) % 2 === 1) return null;
  const m = /([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*\.)?([A-Za-z_][\w]*)?$/.exec(before);
  if (!m) return null;
  const [, chain, partial = ''] = m;
  // nach `=` ohne Token: nur, wenn nicht mitten in etwas anderem (z. B. `1|`)
  if (!chain && !partial && /[\w"\])]$/.test(before)) return null;
  // Schlüsselwörter und Funktionsaufrufe nicht vervollständigen
  if (!chain && partial && /^(if|then|else|for|in|return|and|or|not|null|true|false|some|every|satisfies|between|function|instance|of)$/.test(partial)) return null;

  let pool: VarNode[] = vars;
  if (chain) {
    for (const seg of chain.slice(0, -1).split('.')) {
      const hit = pool.find(v => v.name === seg);
      if (!hit) return null;
      if (hit.type === 'any' || hit.open) return null;
      pool = hit.children ?? [];
    }
  }
  const needle = partial.toLowerCase();
  const items: Completion[] = pool
    .filter(v => v.name.toLowerCase().startsWith(needle) && v.name !== partial)
    .concat(needle ? pool.filter(v => !v.name.toLowerCase().startsWith(needle) && v.name.toLowerCase().includes(needle)) : [])
    .map(node => ({ insert: node.name, node, path: `${chain ?? ''}${node.name}` }));

  // Funktionen und Schlüsselwörter: nur ausserhalb eines Pfads und erst ab dem
  // ersten Buchstaben. Namen aus mehreren Wörtern (`upper case`) erkennt man
  // auch, wenn schon das erste Wort getippt ist: es zählt das längste Ende
  // des Getippten, mit dem ein Name beginnt.
  let from = cursor - partial.length;
  if (!chain && partial) {
    const words = /((?:[A-Za-z_]\w*\s+){0,3}[A-Za-z_]\w*)$/.exec(before)?.[1]?.split(/\s+/) ?? [partial];
    let typed = partial;
    for (let n = words.length; n >= 1; n--) {
      const t = words.slice(-n).join(' ').toLowerCase();
      if (FEEL_DOCS.some(d => d.name.startsWith(t))) { typed = words.slice(-n).join(' '); break; }
    }
    const t = typed.toLowerCase();
    // eine Funktion, die schon dasselbe heisst, bleibt dabei — `string` neben `string join`
    const docs = FEEL_DOCS.filter(d => d.name.startsWith(t) && (d.name !== typed || d.kind === 'function'));
    // mehrere Wörter getippt: nur Funktionen passen, keine Variablen
    if (docs.length && typed !== partial) { from = cursor - typed.length; items.length = 0; }
    items.push(...docs.map(doc => ({ insert: doc.insert, doc, path: doc.name, back: doc.back })));
  }
  if (!items.length) return null;
  return { from, to: cursor, items };
}

// ── Einfärben ────────────────────────────────────────────────────────────────

export type FeelTokenKind = 'variable' | 'string' | 'feel' | 'comment' | 'plain';
export interface FeelToken { text: string; kind: FeelTokenKind }

const DOC_NAMES = FEEL_DOCS.map(d => d.name).sort((a, b) => b.length - a.length);
const DOC_KIND = new Map(FEEL_DOCS.map(d => [d.name, d.kind]));

/**
 * Den Ausdruck in Stücke zerlegen, die das Eingabefeld einfärbt: Zeichenketten
 * (grün), Variablen und ihre Pfade (blau), FEEL selbst — Funktionen und
 * Schlüsselwörter — (violett). Alles andere bleibt, wie es ist.
 */
export function tokenizeFeel(text: string, vars: VarNode[]): FeelToken[] {
  const names = new Set(vars.map(v => v.name));
  const out: FeelToken[] = [];
  const push = (t: string, kind: FeelTokenKind) => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += t; else out.push({ text: t, kind });
  };
  let i = 0;
  let afterDot = false;
  while (i < text.length) {
    const rest = text.slice(i);
    let m: RegExpExecArray | null;
    if ((m = /^"(?:[^"\\]|\\.)*"?/.exec(rest))) { push(m[0], 'string'); i += m[0].length; afterDot = false; continue; }
    if ((m = /^(?:\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))/.exec(rest))) { push(m[0], 'comment'); i += m[0].length; continue; }
    if ((m = /^`[^`]*`?/.exec(rest))) { push(m[0], names.has(m[0].replace(/`/g, '')) || afterDot ? 'variable' : 'plain'); i += m[0].length; afterDot = false; continue; }
    if ((m = /^[A-Za-z_]\w*/.exec(rest))) {
      const word = m[0];
      const prev = text[i - 1];
      const inPath = afterDot;
      // Funktions- und Schlüsselwörter, auch mit Leerzeichen im Namen (`upper case`)
      const doc = inPath || (prev && /[\w]/.test(prev)) ? undefined
        : DOC_NAMES.find(n => n.startsWith(word) && rest.startsWith(n) && !/\w/.test(rest[n.length] ?? ' '));
      const call = /^\s*\(/.test(rest.slice((doc ?? word).length));
      if (doc && (call || DOC_KIND.get(doc) === 'keyword' || !names.has(doc))) {
        push(doc, 'feel'); i += doc.length; afterDot = false; continue;
      }
      push(word, inPath || names.has(word) ? 'variable' : 'plain');
      i += word.length; afterDot = false; continue;
    }
    if (rest[0] === '.' && text[i + 1] !== '.' && /[\w`]/.test(text[i - 1] ?? '')) { push('.', 'plain'); i++; afterDot = true; continue; }
    push(rest[0], 'plain'); i++;
    if (!/\s/.test(rest[0])) afterDot = false;
  }
  return out;
}

const FEEL_WORDS = new Set([
  'true', 'false', 'null', 'if', 'then', 'else', 'for', 'in', 'return', 'some', 'every', 'satisfies',
  'and', 'or', 'not', 'between', 'instance', 'of', 'function', 'external', 'partial', 'item',
]);

/**
 * Die Variablen, auf die ein FEEL-Ausdruck zugreift — der erste Namensteil
 * eines Pfads (`consultant.name` → `consultant`), in Reihenfolge des
 * Auftretens. Nicht dazu zählen: Text in Anführungszeichen, Funktionsnamen
 * (`upper case(x)`), Pfadteile nach dem Punkt, Schlüsselwörter und die
 * Laufvariablen von `for`/`some`/`every`. Gilt auch für Ausdrücke mit
 * `if … then … else`, Filtern (`items[price > 1]`) und Kontexten.
 */
export function referencedVariables(expression: string): string[] {
  if (!isFeel(expression)) return [];
  const names: string[] = [];
  // Text durch Leerraum ersetzen, `name`-Schreibweise in Backticks als Namen erhalten
  const quoted: string[] = [];
  const code = expression.trimStart().slice(1)
    .replace(/"(?:[^"\\]|\\.)*"/g, ' ')
    .replace(/`([^`]+)`/g, (_, n: string) => ` __bq${quoted.push(n) - 1} `);
  const bound = new Set<string>();
  for (const m of code.matchAll(/\b(?:for|some|every)\s+([A-Za-z_][\w]*)\s+in\b/g)) bound.add(m[1]);
  for (const m of code.matchAll(/,\s*([A-Za-z_][\w]*)\s+in\b/g)) bound.add(m[1]);
  // Schlüssel eines Kontexts (`{ a: x }`) sind keine Variablen
  for (const m of code.matchAll(/[{,]\s*([A-Za-z_][\w]*)\s*:/g)) bound.add(m[1]);
  for (const m of code.matchAll(/(?<![\w.])([A-Za-z_][\w]*)(?![\w])/g)) {
    const name = m[1].replace(/^__bq(\d+)$/, (_, i: string) => quoted[+i]);
    const rest = code.slice(m.index! + name.length);
    if (FEEL_WORDS.has(name) || bound.has(m[1])) continue;
    if (/^\s*\(/.test(rest)) continue;                     // Funktionsaufruf
    if (/^\s+[A-Za-z_]/.test(rest) && !/^\s+(?:in|and|or|then|else|return|satisfies|instance|between|of)\b/.test(rest)) continue; // Teil eines Funktionsnamens mit Leerzeichen
    if (!names.includes(name)) names.push(name);
  }
  return names;
}
