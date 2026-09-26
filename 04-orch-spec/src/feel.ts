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
import type { DomainType, Field, Model, ProcessSpec, ServiceDef, Step, TypeDef } from './types';
import { SCALA_TYPES, isAdt } from './types';
import { indexTypes, type TypeIndex } from './scala';
import { typeShape } from './scalaTypes';
import { domainMember, initOutputs, resolveType } from './interactions';
import { domainRef, parseDomainRef } from './serviceTypes';
import { allSteps } from './bpmn';

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
  optional?: boolean;
  /** woher die Variable kommt: `In`, `InitIn`, `Variable`, `Ausgabe von …` */
  source: string;
}

/** Was am Zielfeld ankommen darf. */
export interface ExpectedType {
  accepts: FeelType[];
  label: string;
}

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

interface Builder { idx: TypeIndex; model: Model | null }

/** Ein Feld des Klassenbauers als Knoten — mit seinen Unterfeldern. */
function nodeOfField(f: Field, source: string, b: Builder, depth: number, seen: Set<string>): VarNode {
  return nodeOf(f.name, f.type, {
    optional: !!f.optional, collection: !!f.collection, description: f.description, source,
    label: fieldLabel(f, b.idx),
  }, b, depth, seen);
}

function fieldLabel(f: Field, idx: TypeIndex): string {
  let t = idx.nameOf(f.type);
  if (f.collection) t = `Seq[${t}]`;
  if (f.optional) t = `Option[${t}]`;
  return t;
}

function nodeOf(
  name: string, typeRef: string,
  o: { optional: boolean; collection: boolean; description?: string; source: string; label: string },
  b: Builder, depth: number, seen: Set<string>,
): VarNode {
  const base = baseNode(typeRef, b, depth, seen);
  const node: VarNode = {
    name, source: o.source, label: o.label,
    type: o.collection ? 'list' : base.type,
    ...(o.description ? { description: o.description } : {}),
    ...(o.optional ? { optional: true } : {}),
  };
  if (base.children?.length) node.children = base.children;
  return node;
}

/** Typ und Unterfelder eines Grundtyps (ohne Option/Seq). */
function baseNode(typeRef: string, b: Builder, depth: number, seen: Set<string>): { type: FeelType; children?: VarNode[] } {
  if (isScalar(typeRef)) return { type: SCALAR_FEEL[typeRef] ?? 'string' };
  if (depth >= MAX_DEPTH || seen.has(typeRef)) return { type: 'context' };
  const inner = new Set(seen).add(typeRef);

  const own = b.idx.byId.get(typeRef);
  if (own) {
    // ein ADT ist im JSON ein Objekt — sichtbar sind die Felder aller Fälle
    if (own.kind === 'enum' && !isAdt(own)) return { type: 'string' };
    const fields = own.kind === 'enum' ? (own.values ?? []).flatMap(v => v.fields ?? []) : (own.fields ?? []);
    const seenNames = new Set<string>();
    return { type: 'context', children: fields.filter(f => f.name && !seenNames.has(f.name) && seenNames.add(f.name)).map(f => nodeOfField(f, `Feld von ${own.name}`, b, depth + 1, inner)) };
  }

  const dom = b.idx.domainOf(typeRef);
  if (dom) return domainNode(dom, b, depth, inner);

  // Service-Objekt (`svc:`): der Katalog kennt es vielleicht unter seinem Namen
  const svc = b.idx.serviceOf(typeRef);
  if (svc) {
    const found = resolveType(svc.name, b.model, svc.pkg);
    if (found) return domainNode(found, b, depth, inner);
    return { type: 'context' };
  }
  return { type: 'any' };
}

function domainNode(dom: DomainType, b: Builder, depth: number, seen: Set<string>): { type: FeelType; children?: VarNode[] } {
  if (dom.kind === 'enum' && !dom.cases?.length) return { type: 'string' };
  if (dom.kind === 'alias') return { type: 'any' };
  const seenNames = new Set<string>();
  const fields = dom.kind === 'enum'
    ? (dom.cases ?? []).flatMap(c => c.fields ?? []).filter(p => !seenNames.has(p.name) && seenNames.add(p.name))
    : (dom.fields ?? []);
  const children = fields.map(p => {
    const shape = typeShape(p.type);
    const scalar = isScalar(shape.base);
    const ref = scalar ? null : resolveType(shape.base, b.model, dom.pkg);
    const typeRef = scalar ? shape.base : ref ? domainRef(ref.id) : shape.base;
    return nodeOf(p.name, typeRef, {
      optional: shape.optional, collection: shape.collection, description: p.description,
      source: `Feld von ${dom.name}`, label: p.type,
    }, b, depth + 1, seen);
  });
  return { type: 'context', children };
}

/**
 * Alle Prozessvariablen mit ihren Pfaden. Bei gleichem Namen gilt die erste
 * Quelle: `In` vor `InitIn` vor den Prozessvariablen vor den Ausgaben.
 */
export function processVariables(spec: ProcessSpec, model: Model | null): VarNode[] {
  const types = spec.types ?? [];
  const b: Builder = { idx: indexTypes(types, model), model };
  const out: VarNode[] = [];
  const have = new Set<string>();
  const add = (n: VarNode) => { if (n.name && !have.has(n.name)) { have.add(n.name); out.push(n); } };

  const root = types.find(t => t.root);
  for (const f of root?.fields ?? []) add(nodeOfField(f, 'In', b, 0, new Set()));

  const initIn = types.find(t => t.initIn);
  if (initIn) for (const f of initIn.fields ?? []) add(nodeOfField(f, 'InitIn', b, 0, new Set()));
  else for (const o of initOutputs(spec)) add({ name: o.name, type: 'any', label: '?', source: 'InitIn', ...(o.description ? { description: o.description } : {}) });

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
export function expectedFromDomain(dom: DomainType | null, name: string, model: Model | null): ExpectedType | null {
  const p = dom?.fields?.find(f => f.name === name);
  if (!p) return null;
  const shape = typeShape(p.type);
  let accepts: FeelType[];
  if (shape.collection) accepts = ['list'];
  else if (isScalar(shape.base)) accepts = SCALAR_ACCEPTS[shape.base] ?? [SCALAR_FEEL[shape.base] ?? 'string'];
  else {
    const ref = resolveType(shape.base, model, dom!.pkg);
    if (!ref) return null;                    // Typ nicht im Katalog — kein Urteil
    if (ref.kind === 'enum' && !ref.cases?.length) accepts = ['string'];
    else if (ref.kind === 'alias') return null;
    else accepts = ['context'];
  }
  if (shape.optional) accepts = [...accepts, 'nil'];
  return { accepts, label: p.type };
}

/** Ist das Feld laut Domain-Katalog Pflicht (nicht `Option[…]`)? null = Feld unbekannt. */
export function domainRequired(dom: DomainType | null, name: string): boolean | null {
  const p = dom?.fields?.find(f => f.name === name);
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
    if (dom?.fields?.length) {
      for (const n of domainNode(dom, b, 0, new Set([domainRef(dom.id)])).children ?? []) add({ ...n, source: `Ergebnis (${dom.name})` });
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
  if (f.collection) accepts = ['list'];
  else if (isScalar(f.type)) accepts = SCALAR_ACCEPTS[f.type] ?? [SCALAR_FEEL[f.type] ?? 'string'];
  else {
    const own = idx.byId.get(f.type);
    const dom = idx.domainOf(f.type);
    if ((own?.kind === 'enum' && !isAdt(own)) || (dom?.kind === 'enum' && !dom.cases?.length)) accepts = ['string'];
    else if (dom?.kind === 'alias') return null;
    else accepts = ['context'];
  }
  if (f.optional) accepts = [...accepts, 'nil'];
  return { accepts, label: fieldLabel(f, idx) };
}

// ── Beispielwerte ────────────────────────────────────────────────────────────

const SAMPLE: Partial<Record<FeelType, unknown>> = {
  string: 'text', number: 1, boolean: true, date: '2024-01-31', 'date time': '2024-01-31T12:00:00', time: '12:00:00', duration: 'PT1M',
};

function sampleOf(n: VarNode): unknown {
  if (n.type === 'list') return [n.children?.length ? sampleContext(n.children) : 'text'];
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

/** `client.address.` vor einer Position → Wurzelvariable `client` */
function rootBefore(text: string, at: number): string | null {
  const m = /([A-Za-z_][\w]*)(?:\s*\.\s*[A-Za-z_][\w]*)*\s*\.\s*$/.exec(text.slice(0, at));
  return m?.[1] ?? null;
}

/** Namen im Ausdruck, die eine Variable ohne bekannten Typ treffen. */
function touchesUnknown(body: string, vars: VarNode[]): boolean {
  const unknown = new Set(vars.filter(v => v.type === 'any').map(v => v.name));
  if (!unknown.size) return false;
  const code = body.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  for (const m of code.matchAll(/(?<![\w.])([A-Za-z_]\w*)/g)) if (unknown.has(m[1])) return true;
  return false;
}

const quoted = (msg: string): string => /'([^']*)'/.exec(msg)?.[1] ?? '';

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
export function checkFeel(expression: string, vars: VarNode[] | null, expected: ExpectedType | null = null): FeelCheck {
  const body = expression.trimStart().slice(1).trim();
  if (!body) return { issues: [{ level: 'error', text: 'Nach «=» fehlt der FEEL-Ausdruck.' }], result: null };

  let value: unknown;
  let warnings: { type: string; message: string; position: { from: number; to: number } }[];
  try {
    const r = evaluate(body, vars ? sampleContext(vars) : {});
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
  if (!vars) return { issues, result: feelType(value) };

  const unknown = touchesUnknown(body, vars);
  const byName = new Map(vars.map(v => [v.name, v]));
  let pathFailed = false;
  for (const w of warnings) {
    const root = rootBefore(body, w.position.from);
    const rootVar = root ? byName.get(root) : undefined;
    switch (w.type) {
      case 'NO_VARIABLE_FOUND': {
        const name = quoted(w.message);
        // eine unbekannte Funktion meldet feelin zuerst als Variable
        if (warnings.some(x => x.type === 'NO_FUNCTION_FOUND' && x.position.from === w.position.from)) {
          issues.push({ level: 'error', text: `Funktion «${name}» gibt es nicht.` });
        } else {
          issues.push({ level: 'error', text: `Variable «${name}» ist nicht bekannt — weder als Prozessvariable noch im Ergebnis.` });
        }
        pathFailed = true;
        break;
      }
      case 'NO_CONTEXT_ENTRY_FOUND':
      case 'NO_PROPERTY_FOUND': {
        if (rootVar?.type === 'any') break;           // Typ unbekannt — kein Urteil
        if (pathFailed && w.type === 'NO_PROPERTY_FOUND') break; // Folgefehler auf null
        const key = quoted(w.message);
        const prefix = /([A-Za-z_][\w]*(?:\s*\.\s*[A-Za-z_][\w]*)*)\s*\.\s*$/.exec(body.slice(0, w.position.from))?.[1]?.replace(/\s/g, '');
        issues.push({ level: 'error', text: prefix ? `Pfad «${prefix}.${key}» gibt es nicht — «${prefix}» hat kein Feld «${key}».` : `Feld «${key}» gibt es nicht.` });
        pathFailed = true;
        break;
      }
      case 'NO_FUNCTION_FOUND':
        break; // schon über NO_VARIABLE_FOUND gemeldet
      case 'INVALID_TYPE':
      case 'NOT_COMPARABLE':
      case 'INVALID_ARGUMENTS':
        if (unknown || pathFailed) break;
        issues.push({ level: 'error', text: `Typen passen nicht zusammen: ${w.message}` });
        break;
      default:
        issues.push({ level: 'warn', text: w.message });
    }
  }

  const result = feelType(value);
  if (!issues.length && expected && !unknown) {
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
  return { issues, result: unknown ? null : result };
}

// ── Vervollständigung ────────────────────────────────────────────────────────

export interface Completion {
  /** was eingesetzt wird */
  insert: string;
  node: VarNode;
  /** voller Pfad zur Anzeige */
  path: string;
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
      if (hit.type === 'any') return null;
      pool = hit.children ?? [];
    }
  }
  const needle = partial.toLowerCase();
  const items = pool
    .filter(v => v.name.toLowerCase().startsWith(needle) && v.name !== partial)
    .concat(needle ? pool.filter(v => !v.name.toLowerCase().startsWith(needle) && v.name.toLowerCase().includes(needle)) : [])
    .map(node => ({ insert: node.name, node, path: `${chain ?? ''}${node.name}` }));
  if (!items.length) return null;
  return { from: cursor - partial.length, to: cursor, items };
}
