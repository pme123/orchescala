// Patterns — insert, recognise and remove recurring BPMN building blocks.
//
// A pattern is a small BPMN (see `PatternDef` in types.ts):
//
//   ┌──────────────────────┐
//   │ PatternTarget        │  the anchor — its type (userTask, callActivity …)
//   │  · listeners, inputs │  is the type the pattern fits; whatever hangs on
//   └──◯───────────────────┘  it goes onto **every** selected element
//      ↓ Timer {{timer}}
//      ◉ Link «{{link}}»      boundary event with its path: likewise per element
//
//   ◉ Link «{{link}}» → [Call Activity] → ○     detached block: the process needs
//                                               it **once** — if it is missing,
//                                               it is added, otherwise not
//
// Parameters appear as `{{name}}` in the BPMN — in attributes, texts, scripts.
// Built in are `{{targetId}}`, `{{targetName}}` and `{{processId}}`.
//
// The **recognition** follows from the same BPMN: an element carries the pattern
// if everything that hangs on the anchor also hangs on it — the parameters are
// read back from the values. The comparison is tolerant: order,
// IDs, names of the flow nodes and upper/lower case don't count, and
// whatever else the element carries does no harm. If an older
// process expresses the same thing differently, the recognition also recognises the further
// notations (`variants`) — what is inserted is always the pattern BPMN.
//
// A pattern on the **process** (`appliesTo: ['process']`) has no anchor:
// its content is the blocks and the extensions of the process itself.

import type { AppliedPattern, EngineId, Field, PatternDef, PatternParam, ProcessSpec, TypeDef } from './types.ts';
import { appendEl, orderBpmn, prependEl, removeEl } from './xmlFormat.ts';
import { uid } from './util.ts';
import { ORCHESCALA_TYPES } from './orchescalaTypes.ts';
import { domainRef } from './serviceTypes.ts';
import { engineLabel } from './engineLabels.ts';
import { parseErrorList } from './errorCodes.ts';

export const ANCHOR_ID = 'PatternTarget';
/** Name of the anchor in a new pattern — a placeholder, not a name for the element */
const STARTER_NAME = 'Element mit dem Pattern';
export const PROCESS_TARGET = 'process';
/** Placeholders the app fills itself */
export const BUILTIN_PARAMS = ['targetId', 'targetName', 'processId', 'startMessage'] as const;

// ── Patterns of Orchescala ───────────────────────────────────────────────────
// Always included, not maintained in the admin and not in the BPMN: their values are in
// the specification and go into the domain via the export.

/**
 * The label of the process — `override lazy val processLabels` in the
 * process object. From it the init worker sets the process variables
 * `callingProcessKeyDE` and `callingProcessKeyFR` (ProcessLabels in
 * Orchescala); patterns like «Benutzer per Mail informieren» read them, and
 * the process's `Out` returns them. Stored in `spec.processLabels`;
 * the fields in the `Out` belong to it as long as the pattern is selected.
 */
export const PROCESS_LABELS_PATTERN = 'process-labels';

/** The fields the pattern brings into the `Out` */
const LABEL_FIELDS = (['DE', 'FR'] as const).map(lang => ({
  name: `callingProcessKey${lang}`,
  description: `Bezeichnung des Prozesses (${lang === 'DE' ? 'deutsch' : 'französisch'}) — aus processLabels`,
  example: `processLabels.${lang.toLowerCase()}`,
}));

export const ORCHESCALA_PATTERNS: PatternDef[] = [{
  id: PROCESS_LABELS_PATTERN,
  name: 'Prozess-Bezeichnung',
  description: 'Die Bezeichnung des Prozesses je Sprache — `override lazy val processLabels` im Prozess-Objekt. '
    + 'Der Init-Worker setzt daraus die Prozessvariablen `callingProcessKeyDE` und `callingProcessKeyFR`.',
  appliesTo: [PROCESS_TARGET],
  params: [
    { name: 'de', label: 'Deutsch', description: 'wird zu callingProcessKeyDE' },
    { name: 'fr', label: 'Französisch', description: 'wird zu callingProcessKeyFR' },
  ],
  bpmn: {},
  builtin: true,
}];

/**
 * The Orchescala pattern a field belongs to — `callingProcessKeyDE/FR`
 * in the `Out`, as long as «Prozess-Bezeichnung» is selected; even if the fields
 * come from the domain. Otherwise `null`.
 */
export function patternOfField(spec: ProcessSpec, type: TypeDef | undefined, field: Field): PatternDef | null {
  if (!spec.processLabels || !type?.processOut) return null;
  return LABEL_FIELDS.some(l => l.name === field.name) ? ORCHESCALA_PATTERNS[0] : null;
}

/** The patterns of Orchescala and those from the admin */
export const allPatterns = (defs: PatternDef[] | undefined): PatternDef[] => [...ORCHESCALA_PATTERNS, ...(defs ?? [])];

/** The patterns on the process — those of Orchescala from the specification, the others from the diagram */
export function processPatterns(spec: ProcessSpec): AppliedPattern[] {
  const labels = spec.processLabels;
  return [
    ...(labels ? [{ id: PROCESS_LABELS_PATTERN, params: { de: labels.de, fr: labels.fr } }] : []),
    ...(spec.patterns ?? []),
  ];
}

/**
 * Select, change or remove an Orchescala pattern — without a diagram.
 * «Prozess-Bezeichnung» brings `callingProcessKeyDE/FR` into the `Out` (the
 * `Out` is created if it is missing) and removes them again on removal; a
 * field that already exists there (from the domain) stays as it is.
 */
export function changeBuiltinPattern(spec: ProcessSpec, id: string, action: 'add' | 'remove' | 'update', params: Record<string, string> = {}): ProcessSpec {
  if (id !== PROCESS_LABELS_PATTERN) return spec;
  const names = new Set(LABEL_FIELDS.map(l => l.name));
  const types = spec.types ?? [];
  const out = types.find(t => t.processOut);
  if (action === 'remove') {
    const { processLabels: _, ...rest } = spec;
    return {
      ...rest,
      ...(out ? { types: types.map(t => (t === out ? { ...t, fields: (t.fields ?? []).filter(f => !names.has(f.name)) } : t)) } : {}),
    } as ProcessSpec;
  }
  const next: ProcessSpec = { ...spec, processLabels: { de: params.de ?? spec.processLabels?.de ?? '', fr: params.fr ?? spec.processLabels?.fr ?? '' } };
  if (action !== 'add') return next;
  const missing: Field[] = LABEL_FIELDS.filter(l => !(out?.fields ?? []).some(f => f.name === l.name))
    .map(l => ({ id: uid('f'), name: l.name, type: 'String', description: l.description, example: l.example }));
  if (!missing.length) return next;
  const withOut: TypeDef[] = out
    ? types.map(t => (t === out ? { ...t, fields: [...(t.fields ?? []), ...missing] } : t))
    : [...types, { id: uid('t'), name: 'Out', kind: 'case', processOut: true, status: 'draft', fields: missing }];
  return { ...next, types: withOut };
}

const BPMN_NS = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';

// ── DOM helpers (namespace-tolerant as in bpmn.ts) ───────────────────────────
const local = (el: Element): string => {
  const n = el.localName || el.tagName || '';
  const i = n.indexOf(':');
  return i >= 0 ? n.slice(i + 1) : n;
};
const kids = (el: Element) => Array.from(el.children);
const firstNamed = (el: Element, name: string): Element | null => kids(el).find(c => local(c) === name) ?? null;
function descendants(root: Element, out: Element[] = []): Element[] {
  for (const c of kids(root)) { out.push(c); descendants(c, out); }
  return out;
}
const textOf = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
const num = (el: Element | null, a: string) => Number(el?.getAttribute(a) ?? 0) || 0;

/** Nodes in the flow — whatever has a place in the diagram and carries sequence flows */
const FLOW_NODES = new Set([
  'startEvent', 'endEvent', 'intermediateCatchEvent', 'intermediateThrowEvent', 'boundaryEvent',
  'task', 'serviceTask', 'userTask', 'sendTask', 'receiveTask', 'businessRuleTask', 'scriptTask', 'manualTask',
  'callActivity', 'subProcess', 'transaction', 'adHocSubProcess',
  'exclusiveGateway', 'parallelGateway', 'inclusiveGateway', 'eventBasedGateway', 'complexGateway',
]);
/** Content of a process that does not count among the anchor's extensions */
const SCOPE_CONTENT = new Set([...FLOW_NODES, 'sequenceFlow', 'laneSet', 'textAnnotation', 'association', 'group',
  'dataObject', 'dataObjectReference', 'dataStoreReference']);
/** Children that are only wiring */
const STRUCTURAL = new Set(['incoming', 'outgoing', 'documentation']);
/** Container elements in `extensionElements` whose entries count individually */
const CONTAINERS = new Set(['inputOutput', 'properties', 'ioMapping', 'taskHeaders']);
/** Attributes that point to a root element — its name is compared */
const REF_ATTRS = new Set(['signalRef', 'messageRef', 'errorRef', 'escalationRef']);
/** Root elements a flow node refers to (by REF_ATTRS) */
const ROOT_TAGS = new Set(['signal', 'message', 'error', 'escalation']);
/** The prefix of an element's tag with the colon (`bpmn:`) — from the tag, not every DOM sets `prefix` */
const prefixOf = (el: Element): string => (el.tagName.includes(':') ? el.tagName.slice(0, el.tagName.indexOf(':') + 1) : '');
/** Attributes that never count */
const SKIP_ATTRS = new Set(['id', 'attachedToRef', 'sourceRef', 'targetRef', 'default', 'isExecutable']);

/** The BPMN types the UI offers — for selection and display */
export const PATTERN_TARGETS: Array<{ tag: string; label: string }> = [
  { tag: 'process', label: 'Prozess' },
  { tag: 'userTask', label: 'Benutzeraufgabe' },
  { tag: 'serviceTask', label: 'Service-Task' },
  { tag: 'callActivity', label: 'Call Activity' },
  { tag: 'sendTask', label: 'Send-Task' },
  { tag: 'receiveTask', label: 'Receive-Task' },
  { tag: 'businessRuleTask', label: 'Business-Rule-Task' },
  { tag: 'scriptTask', label: 'Script-Task' },
  { tag: 'subProcess', label: 'Subprozess' },
  { tag: 'exclusiveGateway', label: 'Verzweigung (exklusiv)' },
  { tag: 'parallelGateway', label: 'Verzweigung (parallel)' },
  { tag: 'inclusiveGateway', label: 'Verzweigung (inklusiv)' },
  { tag: 'eventBasedGateway', label: 'Verzweigung (ereignisbasiert)' },
  { tag: 'startEvent', label: 'Startereignis' },
  { tag: 'endEvent', label: 'Endereignis' },
  { tag: 'intermediateCatchEvent', label: 'Zwischenereignis (fangend)' },
  { tag: 'intermediateThrowEvent', label: 'Zwischenereignis (werfend)' },
];
export const targetLabel = (tag: string) => PATTERN_TARGETS.find(t => t.tag === tag)?.label ?? tag;

// ── Placeholders ─────────────────────────────────────────────────────────────
const PH = /\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}/g;

/** The parameters of a pattern BPMN (without the built-in ones), in order */
export function placeholders(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(PH)) {
    if (!out.includes(m[1]) && !(BUILTIN_PARAMS as readonly string[]).includes(m[1])) out.push(m[1]);
  }
  return out;
}

/**
 * The parameters as they appear on the element: only those occurring in the BPMN of this
 * engine. `inBlock`: appears only in the shared block — takes effect on the
 * first insertion, after that the block belongs to the process (change it in the diagram).
 */
export function patternParamsFor(def: PatternDef, engine: EngineId, atProcess: boolean): Array<PatternParam & { inBlock?: boolean; textOnly?: boolean; options?: string[] }> {
  const x = fragmentFor(def, engine);
  const fr = x ? parseFragment(x) : null;
  const text = x ? textOnlyParams(x) : new Set<string>();
  const withKind = (p: PatternParam) => {
    const options = paramOptions(p);
    return { ...p, ...(text.has(p.name) ? { textOnly: true } : {}), ...(options ? { options } : {}) };
  };
  if (!fr || 'error' in fr) return patternParams(def).map(withKind);
  return patternParams(def)
    .filter(p => fr.elementParams.has(p.name) || fr.blockParams.has(p.name))
    .map(p => (!atProcess && fr.blockParams.has(p.name) ? { ...withKind(p), inBlock: true } : withKind(p)));
}

/**
 * Parameters that appear in the pattern inside a string of an expression
 * (`setVariable("processStatus", "{{processStatus}}")`) — only text works there,
 * no FEEL. Except for the FEEL text of Camunda 8 (`source="=&#34;{{p}}&#34;"`),
 * which an expression replaces entirely (see QUOTED_PH).
 */
function textOnlyParams(xml: string): Set<string> {
  const rest = xml.replace(QUOTED_PH, '');
  return new Set([...rest.matchAll(/(?:&#34;|&quot;|')\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}(?:&#34;|&quot;|')/g)].map(m => m[1]));
}

/**
 * The values to choose from: what the admin lists for the parameter (`values`), for
 * `processStatus` the statuses of Orchescala (`ProcessStatus`) — custom statuses
 * (`CustomProcessStatus.ordered`) can still be typed in.
 */
function paramOptions(p: PatternParam): string[] | undefined {
  if (Array.isArray(p.values) && p.values.every(v => typeof v === 'string')) return p.values as string[];
  if (p.name === 'processStatus') return ORCHESCALA_TYPES.find(t => t.name === 'ProcessStatus')?.values;
  return undefined;
}

/**
 * A value for a parameter that only takes text: `= "succeeded"`,
 * `= ProcessStatus.succeeded` (a case) and what the translation to JUEL
 * had made of it (`${ProcessStatus.prop("succeeded")}`) — all `succeeded`.
 */
export function paramText(value: string): string {
  let t = value.trim();
  const juel = /^[$#]\{([\s\S]*)\}$/.exec(t);
  if (juel) t = juel[1].trim().replace(/^([A-Z]\w*)\.prop\((["'])(.*)\2\)$/, '$1.$3');
  else if (t.startsWith('=')) t = t.slice(1).trim();
  else return value;
  const str = /^"((?:[^"\\]|\\.)*)"$/.exec(t);
  if (str) return str[1];
  const enumCase = /^[A-Z]\w*\.(?:`([^`]+)`|([\w-]+))$/.exec(t);
  if (enumCase) return enumCase[1] ?? enumCase[2];
  return value;
}

/** All parameters of a pattern: maintained ones plus those that only appear in the BPMN */
export function patternParams(def: PatternDef): PatternParam[] {
  const known = def.params ?? [];
  const names = new Set(known.map(p => p.name));
  const sources = [...Object.values(def.bpmn), ...Object.values(def.variants ?? {}).flat()];
  const extra = sources.flatMap(x => (x ? placeholders(x) : [])).filter(n => !names.has(n) && (names.add(n), true));
  return [...known, ...extra.map(name => ({ name }))];
}

const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * A parameter with a FEEL expression (`=x`, Camunda 8) does not fit into a
 * FEEL text of the pattern (`source="=&#34;{{p}}&#34;"`) — there it replaces the
 * whole value: `source="=x"`. A fixed text stays inside the text.
 */
const QUOTED_PH = /="=\s*(?:&#34;|&quot;)\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}(?:&#34;|&quot;)"/g;
const isFeelValue = (v: string | undefined): v is string => !!v && /^=/.test(v.trim()) && !/^=\s*"[^"]*"$/.test(v.trim());

/** Fill placeholders; whatever has no value becomes empty */
export function fillPlaceholders(xml: string, values: Record<string, string | undefined>): string {
  // a default may name the built-in ones (`{{processId}}-inform`)
  const resolved: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) resolved[k] = (v ?? '').replace(PH, (_, n: string) => values[n] ?? '');
  return xml
    .replace(QUOTED_PH, (all, name: string) => (isFeelValue(resolved[name]) ? `="${xmlEscape(resolved[name].trim())}"` : all))
    .replace(PH, (_, name: string) => xmlEscape(resolved[name] ?? ''));
}

type Binding = ReadonlyMap<string, string>;
const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Match a text against a template with `{{name}}`. Names already bound
 * must have the same value; new ones are bound.
 */
function matchText(tpl: string, actual: string, b: Binding): Binding | null {
  // `#{…}` and `${…}` are the same in Camunda 7; whitespace doesn't count
  const norm = (s: string) => s.replace(/#\{/g, '${').replace(/\s+/g, ' ').trim();
  const t = norm(tpl), a = norm(actual);
  // `="{{p}}"` in the pattern, but a FEEL expression in the diagram (see fillPlaceholders):
  // the parameter is the whole expression
  const quoted = /^=\s*"\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}"$/.exec(t);
  if (quoted && isFeelValue(a)) {
    const bound = b.get(quoted[1]);
    if (bound != null) return norm(bound) === a ? b : null;
    return new Map(b).set(quoted[1], a);
  }
  if (!t.includes('{{')) return t.replace(/ /g, '').toLowerCase() === a.replace(/ /g, '').toLowerCase() ? b : null;
  const lit = (s: string) => reEscape(s).replace(/ /g, '\\s*');
  const groups: string[] = [];
  let src = '', last = 0;
  for (const m of t.matchAll(PH)) {
    src += lit(t.slice(last, m.index));
    last = (m.index ?? 0) + m[0].length;
    const name = m[1];
    const bound = b.get(name);
    if (bound != null) src += lit(norm(bound));
    else {
      const k = groups.indexOf(name);
      if (k >= 0) src += `\\k<g${k}>`;
      else { groups.push(name); src += `(?<g${groups.length - 1}>[\\s\\S]*?)`; }
    }
  }
  src += lit(t.slice(last));
  const m = new RegExp(`^${src}$`, 'i').exec(a);
  if (!m) return null;
  if (!groups.length) return b;
  const next = new Map(b);
  groups.forEach((name, k) => next.set(name, (m.groups?.[`g${k}`] ?? '').trim()));
  return next;
}

/** Literal characters of a template — a measure of «how specific» a pattern is */
const literalLength = (s: string) => s.replace(PH, '').replace(/\s+/g, '').length;

// ── Comparing two elements ───────────────────────────────────────────────────
/** Attribute key without arbitrary prefixes — `camunda:` and `zeebe:` are kept */
function attrKey(a: Attr): string {
  const i = a.name.indexOf(':');
  if (i < 0) return a.name;
  const pre = a.name.slice(0, i);
  return pre === 'camunda' || pre === 'zeebe' ? a.name : a.name.slice(i + 1);
}
const normValue = (key: string, v: string) => (key === 'type' ? v.replace(/^[\w-]+:(t[A-Z])/, '$1') : v);

function attrsOf(el: Element, flowNode: boolean): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const a of Array.from(el.attributes)) {
    if (a.name === 'xmlns' || a.name.startsWith('xmlns:')) continue;
    const k = attrKey(a);
    if (SKIP_ATTRS.has(k) || (flowNode && k === 'name')) continue;
    out.push([k, normValue(k, a.value)]);
  }
  return out;
}
function attrOf(el: Element, key: string): string | null {
  for (const a of Array.from(el.attributes)) if (attrKey(a) === key) return normValue(key, a.value);
  return null;
}

/** Name of a root element (signal, message, error) via its ID */
function refName(doc: Document, id: string): string {
  const el = byIdIn(doc.documentElement, id);
  return el ? (el.getAttribute('errorCode') || el.getAttribute('escalationCode') || el.getAttribute('name') || id) : id;
}

function byIdIn(root: Element, id: string): Element | null {
  if (root.getAttribute('id') === id) return root;
  for (const c of kids(root)) { const f = byIdIn(c, id); if (f) return f; }
  return null;
}

/**
 * Does `t` match the template `f`? Same kind, every attribute and every child of the
 * template finds its counterpart (order doesn't matter); whatever else `t`
 * has does no harm.
 */
function matchEl(f: Element, t: Element, b: Binding): Binding | null {
  if (local(f) !== local(t)) return null;
  const flow = FLOW_NODES.has(local(f)) || local(f) === 'sequenceFlow';
  let cur: Binding | null = b;
  const sameErrors = sameErrorList(f, t);
  for (const [k, fv] of attrsOf(f, flow)) {
    let tv = attrOf(t, k);
    if (tv == null) return null;
    if (k === 'source' && sameErrors) continue;
    let want = fv;
    if (REF_ATTRS.has(k)) { want = refName(f.ownerDocument, fv); tv = refName(t.ownerDocument, tv); }
    cur = matchText(want, tv, cur);
    if (!cur) return null;
  }
  // text only counts at leaves — otherwise the IDs from <incoming> would be in it
  if (!kids(f).length) {
    const ft = textOf(f);
    return ft ? matchText(ft, textOf(t), cur) : cur;
  }
  const fk = kids(f).filter(c => !STRUCTURAL.has(local(c)));
  if (!fk.length) return cur;
  const used = new Set<Element>();
  const tk = kids(t).filter(c => !STRUCTURAL.has(local(c)));
  for (const fc of fk) {
    let hit: Binding | null = null;
    for (const tc of tk) {
      if (used.has(tc)) continue;
      hit = matchEl(fc, tc, cur);
      if (hit) { used.add(tc); break; }
    }
    if (!hit) return null;
    cur = hit;
  }
  return cur;
}

/** `_handledErrors` / `_regexHandledErrors` — a list of errors */
const ERROR_LISTS = new Set(['_handledErrors', '_regexHandledErrors']);

/**
 * The same handled errors, just written differently? In Camunda 8 it is
 * a list (`=["output-mocked"]`, that is how the conversion writes it), an
 * older pattern often has a text (`="output-mocked"`) — both mean
 * the same. Only without parameters in the template; with them the text comparison applies.
 */
function sameErrorList(f: Element, t: Element): boolean {
  if (local(f) !== 'input') return false;
  const target = attrOf(f, 'target');
  if (!target || !ERROR_LISTS.has(target) || attrOf(t, 'target') !== target) return false;
  const fs = attrOf(f, 'source'), ts = attrOf(t, 'source');
  if (fs == null || ts == null || fs.includes('{{')) return false;
  const norm = (s: string) => [...new Set(parseErrorList(s).map(e => e.trim().toLowerCase()))].sort().join('\n');
  return norm(fs) === norm(ts);
}

// ── Graph of a scope ─────────────────────────────────────────────────────────
interface Graph {
  container: Element;
  nodes: Element[];
  byId: Map<string, Element>;
  /** node ID → outgoing flows */
  out: Map<string, Element[]>;
  inCount: Map<string, number>;
  /** node ID → boundary events on it */
  boundaries: Map<string, Element[]>;
}

function graphOf(container: Element): Graph {
  const g: Graph = { container, nodes: [], byId: new Map(), out: new Map(), inCount: new Map(), boundaries: new Map() };
  for (const el of kids(container)) {
    const id = el.getAttribute('id');
    if (!id) continue;
    const tag = local(el);
    if (FLOW_NODES.has(tag)) {
      g.nodes.push(el);
      g.byId.set(id, el);
      if (tag === 'boundaryEvent') {
        const to = el.getAttribute('attachedToRef') ?? '';
        g.boundaries.set(to, [...(g.boundaries.get(to) ?? []), el]);
      }
    } else if (tag === 'sequenceFlow') {
      g.byId.set(id, el);
      const s = el.getAttribute('sourceRef') ?? '', t = el.getAttribute('targetRef') ?? '';
      g.out.set(s, [...(g.out.get(s) ?? []), el]);
      g.inCount.set(t, (g.inCount.get(t) ?? 0) + 1);
    }
  }
  return g;
}

/** Everything reachable from a node via flows (and boundary events) */
function reach(g: Graph, start: Element, stop: Set<Element> = new Set()): { nodes: Element[]; flows: Element[] } {
  const nodes: Element[] = [], flows: Element[] = [];
  const seen = new Set<Element>(stop);
  const queue = [start];
  while (queue.length) {
    const n = queue.shift()!;
    if (seen.has(n)) continue;
    seen.add(n);
    nodes.push(n);
    const id = n.getAttribute('id') ?? '';
    for (const f of g.out.get(id) ?? []) {
      flows.push(f);
      const t = g.byId.get(f.getAttribute('targetRef') ?? '');
      if (t && !seen.has(t)) queue.push(t);
    }
    for (const bd of g.boundaries.get(id) ?? []) if (!seen.has(bd)) queue.push(bd);
  }
  return { nodes, flows };
}

type Mapping = Map<Element, Element>;

/**
 * Lay the path from `f` (template) onto the one from `t` (diagram): node by
 * node, flow by flow. Returns the mapping template → diagram.
 */
function matchGraph(fg: Graph, f: Element, tg: Graph, t: Element, b: Binding, map: Mapping, claimed: Set<Element>): { b: Binding; map: Mapping } | null {
  const had = map.get(f);
  if (had) return had === t ? { b, map } : null;
  if (claimed.has(t) || [...map.values()].includes(t)) return null;
  const b1 = matchEl(f, t, b);
  if (!b1) return null;
  let cur = { b: b1, map: new Map(map).set(f, t) };
  const fid = f.getAttribute('id') ?? '', tid = t.getAttribute('id') ?? '';
  // boundary events on nodes of the path
  for (const fb of fg.boundaries.get(fid) ?? []) {
    let hit = null;
    for (const tb of tg.boundaries.get(tid) ?? []) {
      hit = matchGraph(fg, fb, tg, tb, cur.b, cur.map, claimed);
      if (hit) break;
    }
    if (!hit) return null;
    cur = hit;
  }
  for (const ff of fg.out.get(fid) ?? []) {
    const fNext = fg.byId.get(ff.getAttribute('targetRef') ?? '');
    let hit = null;
    for (const tf of tg.out.get(tid) ?? []) {
      if ([...cur.map.values()].includes(tf) || claimed.has(tf)) continue;
      const bf = matchEl(ff, tf, cur.b);
      if (!bf) continue;
      const tNext = tg.byId.get(tf.getAttribute('targetRef') ?? '');
      if (!fNext || !tNext) continue;
      hit = matchGraph(fg, fNext, tg, tNext, bf, new Map(cur.map).set(ff, tf), claimed);
      if (hit) break;
    }
    if (!hit) return null;
    cur = hit;
  }
  return cur;
}

// ── The pattern BPMN ─────────────────────────────────────────────────────────
interface Item {
  el: Element;
  /** Container element in `extensionElements` (inputOutput …) or '' */
  container: string;
  /** directly in `extensionElements` or on the element itself */
  inExt: boolean;
}

/** What an element carries beyond its wiring: extensions, event definitions … */
function itemsOf(el: Element): Item[] {
  const out: Item[] = [];
  for (const c of kids(el)) {
    const n = local(c);
    if (STRUCTURAL.has(n) || SCOPE_CONTENT.has(n)) continue;
    if (n === 'extensionElements') {
      for (const ec of kids(c)) {
        if (CONTAINERS.has(local(ec))) for (const leaf of kids(ec)) out.push({ el: leaf, container: local(ec), inExt: true });
        else out.push({ el: ec, container: '', inExt: true });
      }
    } else out.push({ el: c, container: '', inExt: false });
  }
  return out;
}
const sameSlot = (a: Item, b: Item) => a.inExt === b.inExt && a.container === b.container;
/**
 * Which variable a mapping assigns (`camunda:in`/`out`, input/output parameter,
 * `zeebe:input`/`output`) — `null` for everything else and for `variables="all"`.
 */
function mappingKey(el: Element): string | null {
  const n = local(el);
  const by = n === 'inputParameter' || n === 'outputParameter' ? 'name'
    : n === 'in' || n === 'out' || n === 'input' || n === 'output' ? 'target' : null;
  const v = by ? el.getAttribute(by) : null;
  return v && !v.includes('{{') ? `${el.namespaceURI ?? ''}|${n}|${v}` : null;
}

export interface Fragment {
  doc: Document;
  process: Element;
  /** null: the pattern applies to the process itself */
  anchor: Element | null;
  /** Type of the anchor, or `process` */
  anchorTag: string;
  graph: Graph;
  items: Item[];
  attrs: Array<[string, string]>;
  /** per boundary event on the anchor: the event with its path */
  attached: Array<{ boundary: Element; nodes: Element[]; flows: Element[] }>;
  /** detached blocks — the process needs them once */
  blocks: Array<{ entry: Element; nodes: Element[]; flows: Element[] }>;
  /** how specific the anchor is (literal characters) — in a tie, the more specific wins */
  score: number;
  /** Placeholders on the element (anchor, paths) or only in the shared blocks */
  elementParams: Set<string>;
  blockParams: Set<string>;
  /** Hints for the admin */
  warnings: string[];
}

export function parseXml(xml: string): Document | null {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const root = doc.documentElement;
  if (!root || local(root) !== 'definitions') return null;
  try { if (doc.getElementsByTagName('parsererror').length) return null; } catch { /* linkedom */ }
  return doc;
}

function processes(doc: Document): Element[] {
  return descendants(doc.documentElement).filter(e => local(e) === 'process');
}
/** The process the import also takes: the first one with elements */
function mainProcess(doc: Document): Element | null {
  const all = processes(doc);
  return all.find(p => kids(p).some(c => FLOW_NODES.has(local(c)))) ?? all[0] ?? null;
}

const fragCache = new Map<string, Fragment | string>();

/** Read the pattern BPMN: anchor, what hangs on it, and the blocks beside it */
export function parseFragment(xml: string): Fragment | { error: string } {
  const hit = fragCache.get(xml);
  if (hit) return typeof hit === 'string' ? { error: hit } : hit;
  const res = parseFragmentUncached(xml);
  if (fragCache.size > 200) fragCache.clear();
  fragCache.set(xml, 'error' in res ? res.error : res);
  return res;
}

function parseFragmentUncached(xml: string): Fragment | { error: string } {
  const doc = parseXml(xml);
  if (!doc) return { error: 'Kein lesbares BPMN.' };
  const anchor = byIdIn(doc.documentElement, ANCHOR_ID);
  const process = anchor ? (anchor.parentElement && local(anchor.parentElement) === 'process' ? anchor.parentElement : null) : mainProcess(doc);
  if (anchor && !process) return { error: `Der Anker «${ANCHOR_ID}» muss direkt im Prozess liegen, nicht in einem Subprozess.` };
  if (!process) return { error: 'Kein Prozess im BPMN.' };
  const graph = graphOf(process);
  const warnings: string[] = [];
  const attached: Fragment['attached'] = [];
  const taken = new Set<Element>();
  if (anchor) {
    taken.add(anchor);
    if ((graph.out.get(ANCHOR_ID) ?? []).length || graph.inCount.get(ANCHOR_ID)) {
      warnings.push('Sequenzflüsse am Anker werden nicht übernommen — das Pattern hängt sich an, es fügt sich nicht in den Ablauf ein.');
    }
    for (const bd of graph.boundaries.get(ANCHOR_ID) ?? []) {
      const r = reach(graph, bd, new Set([anchor]));
      r.nodes.forEach(n => taken.add(n));
      attached.push({ boundary: bd, nodes: r.nodes.slice(1), flows: r.flows });
    }
  }
  // blocks: the rest, connected via flows; the entry is the node without an incoming flow
  const blocks: Fragment['blocks'] = [];
  const rest = graph.nodes.filter(n => !taken.has(n) && local(n) !== 'boundaryEvent');
  for (const n of rest) {
    if (taken.has(n) || graph.inCount.get(n.getAttribute('id') ?? '')) continue;
    const r = reach(graph, n, taken);
    r.nodes.forEach(x => taken.add(x));
    blocks.push({ entry: n, nodes: r.nodes, flows: r.flows });
  }
  const leftover = rest.filter(n => !taken.has(n));
  if (leftover.length) warnings.push(`${leftover.length} Element(e) ohne Einstieg (nur im Kreis verbunden) — nicht übernommen.`);
  const items = itemsOf(anchor ?? process);
  const attrs = anchor ? attrsOf(anchor, true) : attrsOf(process, true);
  // content of an element as text — names, attributes, texts (without XMLSerializer, also for the CLI)
  const ser = (el: Element): string => [local(el), ...Array.from(el.attributes).map(x => `${x.name}=${x.value}`),
    ...(el.children.length ? kids(el).map(ser) : [el.textContent ?? ''])].join(' ');
  const score = items.reduce((s, i) => s + literalLength(ser(i.el)), 0)
    + attrs.reduce((s, [k, v]) => s + k.length + literalLength(v), 0)
    + attached.reduce((s, a) => s + [a.boundary, ...a.nodes].reduce((x, e) => x + literalLength(ser(e)), 0), 0);
  const phs = (els: Element[]) => new Set(els.flatMap(e => placeholders(ser(e))));
  const elementParams = new Set([...phs(items.map(i => i.el)), ...attrs.flatMap(([, v]) => placeholders(v)),
    ...phs(attached.flatMap(a => [a.boundary, ...a.nodes, ...a.flows]))]);
  const inBlocks = phs(blocks.flatMap(b => [...b.nodes, ...b.flows]));
  // what the blocks reference via signals/messages is in the root elements
  for (const r of kids(doc.documentElement)) if (!['process', 'collaboration', 'BPMNDiagram'].includes(local(r))) for (const n of placeholders(ser(r))) inBlocks.add(n);
  const blockParams = new Set([...inBlocks].filter(n => !elementParams.has(n)));
  if (anchor && !items.length && !attrs.length && !attached.length) {
    warnings.push('Am Anker hängt nichts — das Pattern lässt sich einfügen, aber nicht wiedererkennen.');
  }
  return { doc, process, anchor, anchorTag: anchor ? local(anchor) : PROCESS_TARGET, graph, items, attrs, attached, blocks, score, warnings, elementParams, blockParams };
}

/** Summary for the admin view */
export function describeFragment(fr: Fragment): string[] {
  const out: string[] = [];
  const name = (e: Element) => e.getAttribute('name') || local(e);
  if (fr.items.length) {
    const byKind = new Map<string, number>();
    for (const i of fr.items) byKind.set(local(i.el), (byKind.get(local(i.el)) ?? 0) + 1);
    out.push(`${fr.anchor ? 'am Element' : 'am Prozess'}: ${[...byKind].map(([k, n]) => (n > 1 ? `${n}× ${k}` : k)).join(', ')}`);
  }
  if (fr.attrs.length) out.push(`Attribute: ${fr.attrs.map(([k]) => k).join(', ')}`);
  for (const a of fr.attached) {
    const def = kids(a.boundary).find(c => local(c).endsWith('EventDefinition'));
    out.push(`Boundary-Ereignis (${def ? local(def).replace('EventDefinition', '') : 'ohne Definition'}${a.boundary.getAttribute('cancelActivity') === 'false' ? ', nicht unterbrechend' : ''})`
      + (a.nodes.length ? ` → ${a.nodes.map(name).join(' → ')}` : ''));
  }
  for (const b of fr.blocks) out.push(`einmal im Prozess: ${b.nodes.map(name).join(' → ')}`);
  return out;
}

// ── Recognising ──────────────────────────────────────────────────────────────
export interface PatternHit {
  patternId: string;
  /** element ID, or null for the process */
  targetId: string | null;
  params: Record<string, string>;
}

export interface Detection {
  hits: PatternHit[];
  /** element ID → pattern ID: everything that belongs to a pattern (paths, blocks) */
  owned: Map<string, string>;
}

interface AnchorMatch {
  b: Binding;
  items: Element[];
  attrs: string[];
  /** Boundary events with their path: nodes and flows in the diagram, per template element */
  attached: Mapping;
}

/** Does `t` carry everything that hangs on the anchor? */
function matchAnchor(fr: Fragment, t: Element, tg: Graph | null, claimed: Set<Element>, base: Binding): AnchorMatch | null {
  let b: Binding | null = base;
  const attrs: string[] = [];
  for (const [k, v] of fr.attrs) {
    const tv = attrOf(t, k);
    if (tv == null) return null;
    b = matchText(v, tv, b);
    if (!b) return null;
    attrs.push(k);
  }
  const tItems = itemsOf(t);
  const items: Element[] = [];
  for (const fi of fr.items) {
    let hit: Binding | null = null;
    for (const ti of tItems) {
      if (!sameSlot(fi, ti) || claimed.has(ti.el) || items.includes(ti.el)) continue;
      hit = matchEl(fi.el, ti.el, b);
      if (hit) { items.push(ti.el); break; }
    }
    if (!hit) return null;
    b = hit;
  }
  let attached: Mapping = new Map();
  if (fr.attached.length) {
    if (!tg) return null;
    const tid = t.getAttribute('id') ?? '';
    for (const a of fr.attached) {
      let hit = null;
      for (const tb of tg.boundaries.get(tid) ?? []) {
        hit = matchGraph(fr.graph, a.boundary, tg, tb, b, attached, claimed);
        if (hit) break;
      }
      if (!hit) return null;
      b = hit.b;
      attached = hit.map;
    }
  }
  return { b, items, attrs, attached };
}

/**
 * What belongs **only** to an entry: a node counts if
 * all its incoming flows come from the block. That way a path leading back into the
 * main flow stays untouched on removal.
 */
function reachOwned(g: Graph, start: Element): Element[] {
  const inFlows = new Map<string, Element[]>();
  for (const fl of [...g.out.values()].flat()) {
    const t = fl.getAttribute('targetRef') ?? '';
    inFlows.set(t, [...(inFlows.get(t) ?? []), fl]);
  }
  const nodes = new Set<Element>([start]);
  const flows = new Set<Element>();
  for (let changed = true; changed;) {
    changed = false;
    for (const n of [...nodes]) {
      const id = n.getAttribute('id') ?? '';
      for (const bd of g.boundaries.get(id) ?? []) if (!nodes.has(bd)) { nodes.add(bd); changed = true; }
      for (const fl of g.out.get(id) ?? []) {
        const t = g.byId.get(fl.getAttribute('targetRef') ?? '');
        if (!t || nodes.has(t)) { if (t) flows.add(fl); continue; }
        const ins = inFlows.get(t.getAttribute('id') ?? '') ?? [];
        if (ins.every(x => nodes.has(g.byId.get(x.getAttribute('sourceRef') ?? '') ?? start))) {
          nodes.add(t); flows.add(fl); changed = true;
        }
      }
    }
  }
  return [...nodes, ...flows];
}

/**
 * Find the pattern's shared blocks in the scope. What matters is the
 * **entry**: a link target with the same name, an event subprocess
 * with the same start — whatever comes after it belongs to it, even if it deviates from the
 * pattern. Otherwise a second link target with the same name would end up in the
 * process as soon as a block has one field more or less.
 */
function matchBlocks(fr: Fragment, tg: Graph, claimed: Set<Element>, base: Binding): Array<{ b: Binding; elements: Element[]; entry: Element } | null> {
  return fr.blocks.map(block => {
    const entry = block.entry;
    const esp = local(entry) === 'subProcess' && entry.getAttribute('triggeredByEvent') === 'true';
    for (const tn of tg.nodes) {
      if (claimed.has(tn) || local(tn) !== local(entry)) continue;
      let b: Binding | null = base;
      if (esp) {
        if (tn.getAttribute('triggeredByEvent') !== 'true') continue;
        // an event subprocess is defined by what triggers it: its start event
        for (const fs of kids(entry).filter(c => local(c) === 'startEvent')) {
          let hit: Binding | null = null;
          for (const ts of kids(tn).filter(c => local(c) === 'startEvent')) { hit = matchEl(fs, ts, b!); if (hit) break; }
          b = hit;
          if (!b) break;
        }
      } else b = matchEl(entry, tn, base);
      if (b) return { b, elements: reachOwned(tg, tn), entry: tn };
    }
    return null;
  });
}

const builtins = (t: Element | null, proc: Element | null): Map<string, string> => {
  const m = new Map<string, string>();
  if (t) { m.set('targetId', t.getAttribute('id') ?? ''); m.set('targetName', t.getAttribute('name') ?? ''); }
  if (proc) {
    m.set('processId', proc.getAttribute('id') ?? '');
    // name of the message the process starts with (message start event)
    const start = kids(proc).find(c => local(c) === 'startEvent' && kids(c).some(d => local(d) === 'messageEventDefinition'));
    const ref = start ? kids(start).find(d => local(d) === 'messageEventDefinition')?.getAttribute('messageRef') : null;
    if (ref) m.set('startMessage', refName(proc.ownerDocument, ref));
  }
  return m;
};

const paramsOf = (b: Binding, def: PatternDef): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const p of patternParams(def)) {
    const v = b.get(p.name);
    if (v != null) out[p.name] = v;
  }
  return out;
};

/** The pattern BPMN for the engine, or null */
export const fragmentFor = (def: PatternDef, engine: EngineId): string | null => def.bpmn[engine]?.trim() || null;

/** What the recognition accepts: the pattern BPMN, followed by the further notations */
export const recognisedFor = (def: PatternDef, engine: EngineId): string[] => {
  const main = fragmentFor(def, engine);
  return main ? [main, ...(def.variants?.[engine] ?? []).map(x => x?.trim()).filter((x): x is string => !!x)] : [];
};

/**
 * Which patterns does the diagram carry, and where? More specific patterns first —
 * what one claims for itself cannot be had by another.
 */
export function detectPatterns(docOrXml: Document | string, defs: PatternDef[] | undefined, engine: EngineId): Detection {
  const doc = typeof docOrXml === 'string' ? parseXml(docOrXml) : docOrXml;
  if (!doc) return { hits: [], owned: new Map() };
  const r = detectIn(doc, defs, engine);
  return { hits: r.hits.map(({ match: _, fr: __, ...h }) => h), owned: r.owned };
}

interface InternalHit extends PatternHit {
  /** what belongs to it in the diagram — elements of this document */
  match: AnchorMatch;
  /** the notation that matched */
  fr: Fragment;
}

/**
 * The recognition itself. Removal works on its result — that way it takes out
 * exactly what the recognition assigned to the pattern, and not
 * the first thing that somehow matches (a generic timer → link could otherwise
 * hit the escalation's timer).
 */
function detectIn(doc: Document, defs: PatternDef[] | undefined, engine: EngineId): { hits: InternalHit[]; owned: Map<string, string> } {
  const res: { hits: InternalHit[]; owned: Map<string, string> } = { hits: [], owned: new Map() };
  if (!defs?.length) return res;
  const proc = mainProcess(doc);
  const parsed = defs
    .flatMap(def => recognisedFor(def, engine).map(x => { const fr = parseFragment(x); return 'error' in fr ? null : { def, fr }; }))
    .filter((x): x is { def: PatternDef; fr: Fragment } => !!x)
    .sort((a, b) => b.fr.score - a.fr.score);
  const claimed = new Set<Element>();
  const graphs = new Map<Element, Graph>();
  const graph = (c: Element) => { let g = graphs.get(c); if (!g) { g = graphOf(c); graphs.set(c, g); } return g; };
  const all = descendants(doc.documentElement);
  const own = (els: Iterable<Element>, pid: string) => {
    for (const e of els) {
      claimed.add(e);
      const id = e.getAttribute('id');
      if (id && (FLOW_NODES.has(local(e)) || local(e) === 'sequenceFlow')) res.owned.set(id, pid);
    }
  };
  for (const { def, fr } of parsed) {
    if (!fr.anchor) {
      if (!proc) continue;
      if (!fr.items.length && !fr.attrs.length && !fr.blocks.length) continue;
      const m = matchAnchor(fr, proc, null, claimed, builtins(null, proc));
      if (!m) continue;
      const blocks = matchBlocks(fr, graph(proc), claimed, m.b);
      if (blocks.some(x => !x)) continue;
      let b = m.b;
      for (const x of blocks) for (const [k, v] of x!.b) if (!b.has(k)) b = new Map(b).set(k, v);
      m.items.forEach(e => claimed.add(e));
      for (const x of blocks) own(x!.elements, def.id);
      res.hits.push({ patternId: def.id, targetId: null, params: paramsOf(b, def), match: { ...m, b }, fr });
      continue;
    }
    if (!fr.items.length && !fr.attrs.length && !fr.attached.length) continue;
    const tags = new Set([fr.anchorTag, ...(def.appliesTo ?? [])]);
    for (const t of all) {
      if (!tags.has(local(t)) || !t.getAttribute('id') || !t.parentElement) continue;
      const tg = graph(t.parentElement);
      // the same pattern can hang on the element several times (two mail timers) —
      // whatever is already assigned is no longer available to the next one
      for (let i = 0; i < 10; i++) {
        const m = matchAnchor(fr, t, tg, claimed, builtins(t, proc));
        if (!m) break;
        m.items.forEach(e => claimed.add(e));
        own(m.attached.values(), def.id);
        res.hits.push({ patternId: def.id, targetId: t.getAttribute('id'), params: paramsOf(m.b, def), match: m, fr });
        // assign shared blocks once per scope
        if (fr.blocks.length) {
          for (const x of matchBlocks(fr, tg, claimed, m.b)) if (x) own(x.elements, def.id);
        }
        if (!m.items.length && !m.attached.size) break;
      }
    }
  }
  return res;
}

// ── Inserting ────────────────────────────────────────────────────────────────
export interface PatternResult {
  /** unchanged if nothing was written */
  xml: string;
  changed: boolean;
  issues: string[];
}

interface Box { x: number; y: number; w: number; h: number }
const boundsOf = (di: Element | null | undefined): Box | null => {
  const b = di ? firstNamed(di, 'Bounds') : null;
  return b ? { x: num(b, 'x'), y: num(b, 'y'), w: num(b, 'width'), h: num(b, 'height') } : null;
};
function translate(di: Element, dx: number, dy: number) {
  for (const e of [di, ...descendants(di)]) {
    const n = local(e);
    if (n !== 'Bounds' && n !== 'waypoint') continue;
    e.setAttribute('x', String(Math.round(num(e, 'x') + dx)));
    e.setAttribute('y', String(Math.round(num(e, 'y') + dy)));
  }
}
/** Bounding box around the shapes and edges */
function extent(dis: Element[]): Box | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const di of dis) {
    for (const e of [di, ...descendants(di)]) {
      const n = local(e);
      if (n === 'Bounds' && local(e.parentElement!) !== 'BPMNLabel') {
        x0 = Math.min(x0, num(e, 'x')); y0 = Math.min(y0, num(e, 'y'));
        x1 = Math.max(x1, num(e, 'x') + num(e, 'width')); y1 = Math.max(y1, num(e, 'y') + num(e, 'height'));
      } else if (n === 'waypoint') {
        x0 = Math.min(x0, num(e, 'x')); y0 = Math.min(y0, num(e, 'y'));
        x1 = Math.max(x1, num(e, 'x')); y1 = Math.max(y1, num(e, 'y'));
      }
    }
  }
  return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** DI elements (shapes and edges) per bpmnElement */
function diIndex(doc: Document): Map<string, Element> {
  const m = new Map<string, Element>();
  for (const e of descendants(doc.documentElement)) {
    const n = local(e);
    if (n === 'BPMNShape' || n === 'BPMNEdge') { const r = e.getAttribute('bpmnElement'); if (r && !m.has(r)) m.set(r, e); }
  }
  return m;
}

class Writer {
  doc: Document;
  defs: Element;
  ids: Set<string>;
  di: Map<string, Element>;
  issues: string[] = [];
  constructor(doc: Document) {
    this.doc = doc;
    this.defs = doc.documentElement;
    this.ids = new Set(descendants(this.defs).map(e => e.getAttribute('id')).filter((x): x is string => !!x));
    this.di = diIndex(doc);
  }
  newId(base: string): string {
    const clean = base.replace(/[^\w.-]/g, '_').replace(/^([^A-Za-z_])/, '_$1');
    let id = clean, n = 2;
    while (this.ids.has(id)) id = `${clean}_${n++}`;
    this.ids.add(id);
    return id;
  }
  /** Declare the namespaces of the pattern BPMN in the diagram too */
  declareFrom(frag: Document) {
    for (const a of Array.from(frag.documentElement.attributes)) {
      if (!a.name.startsWith('xmlns:')) continue;
      if (!this.defs.hasAttribute(a.name)) this.defs.setAttributeNS(XMLNS_NS, a.name, a.value);
    }
  }
  /**
   * Assign new IDs up front — otherwise an <outgoing> of a node still points
   * to the old ID of a flow that is only taken over afterwards.
   */
  reserve(els: Element[], prefix: string, idMap: Map<string, string>) {
    for (const el of els) for (const e of [el, ...descendants(el)]) {
      const id = e.getAttribute('id');
      if (id && !idMap.has(id)) idMap.set(id, this.newId(prefix ? `${prefix}_${id}` : id));
    }
  }
  /** Take over an element from the pattern BPMN — all IDs in it new (`prefix_id`, without prefix the ID itself), references updated */
  adopt(src: Element, prefix: string, idMap: Map<string, string>, frag: Document): Element {
    const el = this.doc.importNode(src, true) as Element;
    for (const e of [el, ...descendants(el)]) {
      const id = e.getAttribute('id');
      if (id) {
        const n = idMap.get(id) ?? this.newId(prefix ? `${prefix}_${id}` : id);
        idMap.set(id, n);
        e.setAttribute('id', n);
      }
    }
    for (const e of [el, ...descendants(el)]) this.remapRefs(e, idMap, frag);
    return el;
  }
  remapRefs(e: Element, idMap: Map<string, string>, frag: Document) {
    for (const k of ['attachedToRef', 'sourceRef', 'targetRef', 'default']) {
      const v = e.getAttribute(k);
      if (v && idMap.has(v)) e.setAttribute(k, idMap.get(v)!);
    }
    if ((local(e) === 'incoming' || local(e) === 'outgoing') && idMap.has(textOf(e))) e.textContent = idMap.get(textOf(e))!;
    for (const k of REF_ATTRS) {
      const v = e.getAttribute(k);
      if (v) e.setAttribute(k, this.rootRef(v, frag));
    }
  }
  /** Signal, message, error: take the one with the same name in the diagram, otherwise take it over */
  rootRef(fragId: string, frag: Document): string {
    const src = byIdIn(frag.documentElement, fragId);
    if (!src) return fragId;
    const tag = local(src), name = refName(frag, fragId);
    const have = kids(this.defs).find(e => local(e) === tag && refName(this.doc, e.getAttribute('id') ?? '') === name);
    if (have) {
      this.addRootExtensions(have, src);
      return have.getAttribute('id')!;
    }
    const el = this.doc.importNode(src, true) as Element;
    el.setAttribute('id', this.newId(fragId));
    const before = kids(this.defs).find(e => local(e) === 'process' || local(e) === 'collaboration' || local(e) === 'BPMNDiagram');
    if (before) {
      this.defs.insertBefore(el, before);
      this.defs.insertBefore(this.doc.createTextNode('\n  '), before);
    } else appendEl(this.defs, el);
    return el.getAttribute('id')!;
  }
  /**
   * The extensions the pattern needs on an existing root element (message, signal, error,
   * escalation) — e.g. the correlation key (`zeebe:subscription`) of the start message, which an
   * event subprocess catching it needs in Camunda 8. Only what is missing, by kind: an existing
   * extension of the same kind stays as it is, also with other values or children (it was set on
   * purpose — the pattern does not overwrite or merge it). The root element is shared with the
   * rest of the diagram, so removing the pattern leaves the extension there. The namespace comes
   * along with `declareFrom`. Returns whether something was added.
   */
  addRootExtensions(have: Element, src: Element): boolean {
    const want = firstNamed(src, 'extensionElements');
    if (!want) return false;
    const same = (a: Element, b: Element) => local(a) === local(b) && a.namespaceURI === b.namespaceURI;
    let ext = firstNamed(have, 'extensionElements');
    let added = false;
    for (const item of kids(want)) {
      if (ext && kids(ext).some(k => same(k, item))) continue;
      if (!ext) {
        ext = this.doc.createElementNS(BPMN_NS, `${prefixOf(have)}extensionElements`);
        prependEl(have, ext);
      }
      appendEl(ext, this.doc.importNode(item, true) as Element);
      added = true;
    }
    return added;
  }
  /** The root elements of the pattern the diagram already has: their extensions, where missing */
  addAllRootExtensions(frag: Document): boolean {
    let added = false;
    for (const src of kids(frag.documentElement)) {
      if (!ROOT_TAGS.has(local(src))) continue;
      const name = refName(frag, src.getAttribute('id') ?? '');
      const have = kids(this.defs).find(e => local(e) === local(src) && refName(this.doc, e.getAttribute('id') ?? '') === name);
      if (have && this.addRootExtensions(have, src)) added = true;
    }
    return added;
  }
  /** Take over the DI of the pattern BPMN: shifted, moved to the new IDs */
  adoptDi(fragDi: Map<string, Element>, fragId: string, idMap: Map<string, string>, plane: Element, dx: number, dy: number): Element | null {
    const src = fragDi.get(fragId);
    const id = idMap.get(fragId);
    if (!src || !id) return null;
    const di = this.doc.importNode(src, true) as Element;
    di.setAttribute('bpmnElement', id);
    di.setAttribute('id', this.newId(`${id}_di`));
    for (const e of descendants(di)) if (e.getAttribute('id')) e.setAttribute('id', this.newId(e.getAttribute('id')!));
    translate(di, dx, dy);
    appendEl(plane, di);
    this.di.set(id, di);
    return di;
  }
  serialize(original: string): string {
    // the order of the schema — otherwise Camunda 7 rejects the deployment
    orderBpmn(this.doc);
    let out = new XMLSerializer().serializeToString(this.doc);
    const decl = /^<\?xml[^>]*\?>/.exec(original)?.[0];
    if (decl && !out.startsWith('<?xml')) out = `${decl}\n${out}`;
    return out.replace(/^(<\?xml[^>]*\?>)(?!\n)/, '$1\n');
  }
}

/**
 * Make the process start a message start event: the empty
 * start event gets a message with the process ID as its name (the
 * existing one of the same name, otherwise a new one). Returns a hint if
 * there is no empty start event.
 */
function ensureMessageStart(w: Writer, proc: Element): string | null {
  const starts = kids(proc).filter(c => local(c) === 'startEvent');
  const plain = starts.filter(s => !kids(s).some(k => local(k).endsWith('EventDefinition')));
  if (!plain.length) {
    return starts.length
      ? 'braucht ein Nachrichten-Startereignis — der Start hat schon eine andere Art; im Diagramm von Hand umstellen.'
      : 'braucht ein Nachrichten-Startereignis — der Prozess hat kein Startereignis.';
  }
  const start = plain.find(s => s.getAttribute('id') === 'StartStartEvent') ?? plain[0];
  const name = proc.getAttribute('id') ?? '';
  const pre = prefixOf(start);
  let msg = kids(w.defs).find(e => local(e) === 'message' && e.getAttribute('name') === name) ?? null;
  if (!msg) {
    msg = w.doc.createElementNS(BPMN_NS, `${pre}message`);
    msg.setAttribute('id', w.newId('StartMessage'));
    msg.setAttribute('name', name);
    const before = kids(w.defs).find(e => local(e) === 'process' || local(e) === 'collaboration' || local(e) === 'BPMNDiagram');
    if (before) {
      w.defs.insertBefore(msg, before);
      w.defs.insertBefore(w.doc.createTextNode('\n  '), before);
    } else appendEl(w.defs, msg);
  }
  const md = w.doc.createElementNS(BPMN_NS, `${pre}messageEventDefinition`);
  md.setAttribute('id', w.newId(`${start.getAttribute('id') ?? 'Start'}Message`));
  md.setAttribute('messageRef', msg.getAttribute('id')!);
  appendEl(start, md);
  return null;
}

/** The plane (BPMNPlane) in which an element is drawn */
function planeOf(w: Writer, id: string | null): Element | null {
  const di = id ? w.di.get(id) : null;
  if (di?.parentElement && local(di.parentElement) === 'BPMNPlane') return di.parentElement;
  return descendants(w.defs).find(e => local(e) === 'BPMNPlane') ?? null;
}

/** Pool (participant) of a process in the diagram */
function participantOf(w: Writer, proc: Element): Element | null {
  const pid = proc.getAttribute('id');
  return descendants(w.defs).find(e => local(e) === 'participant' && e.getAttribute('processRef') === pid) ?? null;
}

/** Expand the pool and bottom lane far enough for the new shapes to fit inside */
function growPool(w: Writer, proc: Element, added: Element[], laneFor: (id: string) => Element | null, newIds: string[]) {
  const part = participantOf(w, proc);
  const pShape = part ? w.di.get(part.getAttribute('id') ?? '') : null;
  const pb = pShape ? firstNamed(pShape, 'Bounds') : null;
  const box = extent(added);
  // lanes: new nodes belong in a lane — the target's, otherwise the bottom one
  const lanes = descendants(proc).filter(e => local(e) === 'lane');
  if (lanes.length) {
    for (const id of newIds) {
      const lane = laneFor(id) ?? lanes.reduce((lo, l) => ((boundsOf(w.di.get(l.getAttribute('id') ?? ''))?.y ?? 0) > (boundsOf(w.di.get(lo.getAttribute('id') ?? ''))?.y ?? 0) ? l : lo), lanes[0]);
      const ref = w.doc.createElementNS(BPMN_NS, `${lane.prefix ? `${lane.prefix}:` : ''}flowNodeRef`);
      ref.textContent = id;
      appendEl(lane, ref);
    }
  }
  if (!pb || !box) return;
  const bottom = box.y + box.h + 40, right = box.x + box.w + 40;
  const oldBottom = num(pb, 'y') + num(pb, 'height'), oldRight = num(pb, 'x') + num(pb, 'width');
  const grow = Math.max(0, bottom - oldBottom), widen = Math.max(0, right - oldRight);
  if (!grow && !widen) return;
  // whatever lies below the pool (further pools, message flows) moves down too
  if (grow) {
    const neu = new Set(added);
    for (const di of w.di.values()) {
      if (neu.has(di) || di === pShape) continue;
      if (local(di) === 'BPMNShape') {
        const b = firstNamed(di, 'Bounds');
        if (b && num(b, 'y') >= oldBottom - 1) translate(di, 0, grow);
      } else {
        for (const e of descendants(di)) {
          if ((local(e) === 'waypoint' || local(e) === 'Bounds') && num(e, 'y') >= oldBottom - 1) e.setAttribute('y', String(num(e, 'y') + grow));
        }
      }
    }
  }
  pb.setAttribute('height', String(num(pb, 'height') + grow));
  pb.setAttribute('width', String(num(pb, 'width') + widen));
  for (const l of lanes) {
    const lb = firstNamed(w.di.get(l.getAttribute('id') ?? '') ?? pb, 'Bounds');
    if (!lb || lb === pb) continue;
    if (widen) lb.setAttribute('width', String(num(lb, 'width') + widen));
    if (grow && Math.abs(num(lb, 'y') + num(lb, 'height') - oldBottom) < 2) lb.setAttribute('height', String(num(lb, 'height') + grow));
  }
}

/** Defaults of the parameters plus the built-in ones */
function valuesFor(def: PatternDef, params: Record<string, string>, t: Element | null, proc: Element | null): Record<string, string> {
  const v: Record<string, string> = {};
  for (const p of patternParams(def)) if (p.default != null) v[p.name] = p.default;
  Object.assign(v, Object.fromEntries(Object.entries(params).filter(([, x]) => x != null && x !== '')));
  for (const [k, x] of builtins(t, proc)) v[k] = x;
  return v;
}

/**
 * What a pattern sets at an end event — in Camunda 7 a listener
 * `execution.setVariable("processStatus", "canceled")`, in Camunda 8 an
 * output `processStatus = "canceled"`. That is the result of the process and
 * belongs in its `Out` (see withEndOutFields).
 */
export function endVariables(def: PatternDef, engine: EngineId, params: Record<string, string> = {}): Array<{ name: string; value: string }> {
  const src = fragmentFor(def, engine);
  if (!src) return [];
  const fr = parseFragment(fillPlaceholders(src, valuesFor(def, params, null, null)));
  if ('error' in fr || fr.anchorTag !== 'endEvent' || !fr.anchor) return [];
  const out: Array<{ name: string; value: string }> = [];
  const literal = (v: string) => v.trim().replace(/^=\s*/, '').replace(/^(["'])(.*)\1$/, '$2');
  for (const el of descendants(fr.anchor)) {
    const n = local(el);
    if (n === 'executionListener') {
      for (const m of (el.getAttribute('expression') ?? '').matchAll(/setVariable\(\s*["']([A-Za-z_]\w*)["']\s*,\s*["']([^"']*)["']\s*\)/g)) out.push({ name: m[1], value: m[2] });
    } else if (n === 'output' && el.getAttribute('target')) {
      out.push({ name: el.getAttribute('target')!, value: literal(el.getAttribute('source') ?? '') });
    }
  }
  return out;
}

/**
 * The variables of a pattern at the end (endVariables) as fields of the `Out`:
 * `processStatus` with an Orchescala status as a fixed case
 * (`ProcessStatus.canceled.type`), with different statuses the type itself;
 * otherwise text. `output-mocked` doesn't count — then the process returns the mock.
 */
export function withEndOutFields(spec: ProcessSpec, vars: Array<{ name: string; value: string }>): ProcessSpec {
  const wanted = vars.filter(v => v.value !== 'output-mocked');
  if (!wanted.length) return spec;
  const types = spec.types ?? [];
  const out = types.find(t => t.processOut);
  // an Out with cases: which case, only the model knows — do it by hand there
  if (out?.kind === 'enum') return spec;
  const status = ORCHESCALA_TYPES.find(t => t.name === 'ProcessStatus')!;
  let fields = [...(out?.fields ?? [])];
  let changed = false;
  for (const v of wanted) {
    const have = fields.find(f => f.name === v.name);
    const isCase = v.name === 'processStatus' && (status.fixedCases ?? status.values ?? []).includes(v.value);
    if (have) {
      // previously created as text (the status was not a case): now the fixed case
      if (isCase && have.type === 'String' && !fields.some(f => f !== have && f.name === v.name)) {
        fields = fields.map(f => (f === have ? { ...f, type: domainRef(status.id), enumCase: v.value } : f));
        changed = true;
        continue;
      }
      // a different status at the other end: no fixed case any more
      if (have.enumCase && have.enumCase !== v.value) {
        const { enumCase: _, ...rest } = have;
        fields = fields.map(f => (f === have ? rest : f));
        changed = true;
      }
      continue;
    }
    fields.push(isCase
      ? { id: uid('f'), name: v.name, type: domainRef(status.id), enumCase: v.value, description: 'Wie der Prozess ausgegangen ist — gesetzt am Endereignis (Pattern).' }
      : { id: uid('f'), name: v.name, type: 'String', description: 'Gesetzt am Endereignis (Pattern).' });
    changed = true;
  }
  if (!changed) return spec;
  return {
    ...spec,
    types: out
      ? types.map(t => (t === out ? { ...t, fields } : t))
      : [...types, { id: uid('t'), name: 'Out', kind: 'case', processOut: true, status: 'draft', fields }],
  };
}

/**
 * Add the template's extensions to `t` where they are missing. If `t` already
 * assigns a variable differently, the pattern wins — otherwise it would appear twice.
 * `fext`: the template's `extensionElements` (model for a new one).
 */
function addItems(w: Writer, items: Item[], fext: Element | null, t: Element, prefix: string, idMap: Map<string, string>, fragDoc: Document): boolean {
  let changed = false;
  const tItems = itemsOf(t);
  const usedItems = new Set<Element>();
  let ext = firstNamed(t, 'extensionElements');
  for (const fi of items) {
    const have = tItems.find(ti => sameSlot(fi, ti) && !usedItems.has(ti.el) && matchEl(fi.el, ti.el, new Map()));
    if (have) { usedItems.add(have.el); continue; }
    const key = mappingKey(fi.el);
    if (key) {
      for (const ti of tItems) {
        if (usedItems.has(ti.el) || !sameSlot(fi, ti) || mappingKey(ti.el) !== key) continue;
        usedItems.add(ti.el);
        removeEl(ti.el);
      }
    }
    const el = w.adopt(fi.el, prefix, idMap, fragDoc);
    if (!fi.inExt) appendEl(t, el);
    else {
      if (!ext) {
        ext = w.doc.importNode(fext!, false) as Element;
        prependEl(t, ext);
      }
      if (!fi.container) appendEl(ext, el);
      else {
        let box = firstNamed(ext, fi.container);
        if (!box) {
          box = w.doc.importNode(fi.el.parentElement!, false) as Element;
          appendEl(ext, box);
        }
        appendEl(box, el);
      }
    }
    changed = true;
  }
  return changed;
}

/**
 * An existing shared block and the pattern's one, node by node —
 * following the flows from the entry, paired by kind of node.
 */
function pairBlock(fg: Graph, fEntry: Element, tg: Graph, tEntry: Element): Array<[Element, Element]> {
  const pairs: Array<[Element, Element]> = [];
  const seen = new Set<Element>();
  const go = (f: Element, t: Element) => {
    if (seen.has(f) || seen.has(t)) return;
    seen.add(f); seen.add(t);
    pairs.push([f, t]);
    const next = (g: Graph, n: Element) => (g.out.get(n.getAttribute('id') ?? '') ?? [])
      .map(fl => g.byId.get(fl.getAttribute('targetRef') ?? '')).filter((x): x is Element => !!x);
    const tNext = next(tg, t);
    for (const fn of next(fg, f)) {
      const tn = tNext.find(x => !seen.has(x) && local(x) === local(fn));
      if (tn) go(fn, tn);
    }
  };
  go(fEntry, tEntry);
  return pairs;
}

/**
 * Attach a pattern to an element (or the process, `targetId === null`).
 * Otherwise the XML stays as it is; the new parts are placed where
 * they are relative to the anchor in the pattern BPMN, shared blocks at the bottom
 * right of the diagram.
 */
export function applyPattern(xml: string, def: PatternDef, engine: EngineId, targetId: string | null, params: Record<string, string> = {}): PatternResult {
  const same = (issues: string[]): PatternResult => ({ xml, changed: false, issues });
  const src = fragmentFor(def, engine);
  if (!src) return same([`«${def.name}» hat kein BPMN für ${engineLabel(engine)}.`]);
  const doc = parseXml(xml);
  if (!doc) return same(['Das Diagramm ist kein lesbares BPMN.']);
  const proc = mainProcess(doc);
  const t = targetId ? byIdIn(doc.documentElement, targetId) : proc;
  if (!t || !proc) return same([targetId ? `«${targetId}» steht nicht im Diagramm.` : 'Kein Prozess im Diagramm.']);
  const scope = targetId ? t.parentElement! : proc;
  const w = new Writer(doc);
  // `{{startMessage}}` needs a message start event — if it is missing,
  // the process start becomes one (message = process ID, the convention)
  let changed = false;
  if (/\{\{\s*startMessage\s*\}\}/.test(src) && !builtins(null, proc).has('startMessage')) {
    const issue = ensureMessageStart(w, proc);
    if (issue) return same([`«${def.name}»: ${issue}`]);
    changed = true;
  }
  const fr = parseFragment(fillPlaceholders(src, valuesFor(def, params, targetId ? t : null, proc)));
  if ('error' in fr) return same([`Pattern-BPMN «${def.name}»: ${fr.error}`]);
  if (!!fr.anchor !== !!targetId) return same([fr.anchor ? `«${def.name}» gehört an ein Element, nicht an den Prozess.` : `«${def.name}» gehört an den Prozess.`]);

  w.declareFrom(fr.doc);
  const fragDi = diIndex(fr.doc);
  const plane = planeOf(w, targetId ?? kids(scope).find(c => FLOW_NODES.has(local(c)))?.getAttribute('id') ?? null);
  const tg = graphOf(scope);
  const idMap = new Map<string, string>();
  const newDi: Element[] = [];
  const newIds: string[] = [];
  /** DI of a taken-over element — including everything inside it (content of a subprocess) */
  const adoptDiAll = (e: Element, dx: number, dy: number) => {
    if (!plane) return;
    for (const x of [e, ...descendants(e)]) {
      const d = w.adoptDi(fragDi, x.getAttribute('id') ?? '', idMap, plane, dx, dy);
      if (d) newDi.push(d);
    }
  };

  // 1. on the element: attributes and extensions, where missing
  for (const [k, v] of fr.attrs) {
    const a = fr.anchor ? Array.from(fr.anchor.attributes).find(x => attrKey(x) === k) : null;
    if (!a || attrOf(t, k) === v) continue;
    if (a.namespaceURI) t.setAttributeNS(a.namespaceURI, a.name, a.value); else t.setAttribute(a.name, a.value);
    changed = true;
  }
  if (addItems(w, fr.items, firstNamed(fr.anchor ?? fr.process, 'extensionElements'), t, targetId ?? 'process', idMap, fr.doc)) changed = true;

  // 2. hanging on the element: boundary events with their path — relative to the anchor
  const tBox = targetId ? boundsOf(w.di.get(targetId)) : null;
  const aBox = fr.anchor ? boundsOf(fragDi.get(ANCHOR_ID)) : null;
  const laneOfTarget = targetId ? descendants(proc).find(e => local(e) === 'lane' && kids(e).some(r => local(r) === 'flowNodeRef' && textOf(r) === targetId)) ?? null : null;
  const attachedIds: string[] = [];
  if (fr.attached.length) {
    const already = targetId ? matchAnchor({ ...fr, items: [], attrs: [] }, t, tg, new Set(), builtins(t, proc)) : null;
    if (!already) {
      // occupied spots on the border: existing boundary events
      const taken = (tg.boundaries.get(targetId ?? '') ?? []).map(b => boundsOf(w.di.get(b.getAttribute('id') ?? ''))).filter((b): b is Box => !!b);
      for (const a of fr.attached) {
        const bb = boundsOf(fragDi.get(a.boundary.getAttribute('id') ?? ''));
        let dx = 0, dy = 0;
        if (tBox && aBox && bb) {
          // centre relative to the anchor's size — also fits larger elements
          const cx = bb.x + bb.w / 2, cy = bb.y + bb.h / 2;
          const nx = tBox.x + ((cx - aBox.x) / (aBox.w || 1)) * tBox.w, ny = tBox.y + ((cy - aBox.y) / (aBox.h || 1)) * tBox.h;
          dx = nx - cx; dy = ny - cy;
          const onSide = Math.abs(ny - tBox.y) > 4 && Math.abs(ny - (tBox.y + tBox.h)) > 4;
          for (let i = 0; i < 6; i++) {
            const x = bb.x + dx, y = bb.y + dy;
            if (!taken.some(o => Math.abs(o.x - x) < 30 && Math.abs(o.y - y) < 30)) break;
            if (onSide) dy += 42; else dx += 42;
          }
          taken.push({ x: bb.x + dx, y: bb.y + dy, w: bb.w, h: bb.h });
        } else if (tBox && bb) { dx = tBox.x - bb.x; dy = tBox.y + tBox.h - bb.h / 2 - bb.y; }
        w.reserve([a.boundary, ...a.nodes, ...a.flows], targetId!, idMap);
        for (const e of [a.boundary, ...a.nodes, ...a.flows]) {
          const el = w.adopt(e, targetId!, idMap, fr.doc);
          if (e === a.boundary) el.setAttribute('attachedToRef', targetId!);
          appendEl(scope, el);
          const nid = el.getAttribute('id')!;
          if (FLOW_NODES.has(local(el))) { newIds.push(nid); attachedIds.push(nid); }
          adoptDiAll(e, dx, dy);
        }
      }
      changed = true;
    }
  }

  // 3. once in the process: blocks that don't exist in the scope yet — into the diagram at the bottom right
  const matched = matchBlocks(fr, tg, new Set(), builtins(targetId ? t : null, proc));
  const missing = fr.blocks.filter((_, i) => !matched[i]);
  // a block that already exists: add to its nodes what is missing (the listener at the end …)
  fr.blocks.forEach((b, i) => {
    const m = matched[i];
    if (!m || local(b.entry) === 'subProcess') return;
    for (const [f, tn] of pairBlock(fr.graph, b.entry, tg, m.entry)) {
      if (addItems(w, itemsOf(f).filter(it => !(local(it.el).endsWith('EventDefinition'))), firstNamed(f, 'extensionElements'), tn, '', idMap, fr.doc)) changed = true;
    }
  });
  if (missing.length) {
    const fromDi = missing.flatMap(b => [...b.nodes, ...b.flows]).map(e => fragDi.get(e.getAttribute('id') ?? '')).filter((x): x is Element => !!x);
    const fbox = extent(fromDi);
    const scopeIds = new Set(descendants(scope).map(e => e.getAttribute('id')).filter(Boolean));
    const content = [...w.di.entries()].filter(([id]) => scopeIds.has(id)).map(([, d]) => d);
    const tb = extent([...content, ...newDi]);
    const part = participantOf(w, proc);
    const pBox = part ? boundsOf(w.di.get(part.getAttribute('id') ?? '')) : null;
    // bottom right — aligned with the flow, so the helper blocks are not at the beginning
    const right = tb ? tb.x + tb.w : pBox ? pBox.x + pBox.w - 60 : (fbox?.w ?? 0);
    const x0 = Math.max(pBox ? pBox.x + 60 : tb?.x ?? 0, right - (fbox?.w ?? 0));
    const y0 = (tb ? tb.y + tb.h : pBox ? pBox.y : 0) + 70;
    const dx = fbox ? x0 - fbox.x : 0, dy = fbox ? y0 - fbox.y : 0;
    // shared blocks keep the IDs from the pattern BPMN (house convention) — only on collision with a counter
    const prefix = '';
    for (const b of missing) {
      w.reserve([...b.nodes, ...b.flows], prefix, idMap);
      for (const e of [...b.nodes, ...b.flows]) {
        const el = w.adopt(e, prefix, idMap, fr.doc);
        appendEl(scope, el);
        if (FLOW_NODES.has(local(el))) newIds.push(el.getAttribute('id')!);
        adoptDiAll(e, dx, dy);
      }
    }
    changed = true;
  }
  // the root elements the diagram already had (start message …) — also when everything else is
  // already there: the pattern may be complete except for the correlation key of its message
  if (w.addAllRootExtensions(fr.doc)) changed = true;
  if (!changed) return same([`«${def.name}» ist hier schon vorhanden.`]);
  // an unnamed element is named like the anchor («Init Process») — otherwise it would have no label
  const anchorName = fr.anchor?.getAttribute('name')?.trim();
  if (targetId && anchorName && anchorName !== STARTER_NAME && !t.getAttribute('name')?.trim()) t.setAttribute('name', anchorName);
  if (!plane && (fr.attached.length || missing.length)) w.issues.push('Das Diagramm hat keine Zeichnung (DI) — die neuen Elemente stehen ohne Position darin.');
  if (newDi.length && local(scope) === 'process') growPool(w, proc, newDi, id => (attachedIds.includes(id) ? laneOfTarget : null), newIds);
  return { xml: w.serialize(xml), changed: true, issues: w.issues };
}

// ── Removing ─────────────────────────────────────────────────────────────────
/** Remove an element including its DI and the references to it from the diagram */
function drop(w: Writer, el: Element) {
  // the content (of a subprocess) has its own shapes
  for (const x of descendants(el)) {
    const xid = x.getAttribute('id');
    const di = xid ? w.di.get(xid) : null;
    if (di) { removeEl(di); w.di.delete(xid!); }
  }
  const id = el.getAttribute('id');
  if (id) {
    const di = w.di.get(id);
    if (di) { removeEl(di); w.di.delete(id); }
    // references in lanes and on the neighbours
    for (const e of descendants(w.defs)) {
      const n = local(e);
      if ((n === 'flowNodeRef' || n === 'incoming' || n === 'outgoing') && textOf(e) === id) removeEl(e);
    }
  }
  removeEl(el);
}

/**
 * Remove a pattern from an element (or the process): what hangs on the element,
 * and the shared blocks if nobody else needs them any more.
 */
const sameParams = (a: Record<string, string> | undefined, b: Record<string, string> | undefined) => {
  const norm = (x?: Record<string, string>) => JSON.stringify(Object.entries(x ?? {}).filter(([, v]) => v !== '').sort());
  return norm(a) === norm(b);
};

/**
 * `params` selects the instance if the same pattern hangs on the element several times.
 */
export function removePattern(xml: string, def: PatternDef, engine: EngineId, targetId: string | null, defs?: PatternDef[], params?: Record<string, string>): PatternResult {
  const same = (issues: string[]): PatternResult => ({ xml, changed: false, issues });
  const src = fragmentFor(def, engine);
  if (!src) return same([`«${def.name}» hat kein BPMN für diese Engine.`]);
  const doc = parseXml(xml);
  if (!doc) return same(['Das Diagramm ist kein lesbares BPMN.']);
  const proc = mainProcess(doc);
  const t = targetId ? byIdIn(doc.documentElement, targetId) : proc;
  if (!t || !proc) return same([`«${targetId}» steht nicht im Diagramm.`]);
  const main = parseFragment(src);
  if ('error' in main) return same([main.error]);
  const scope = targetId ? t.parentElement! : proc;
  const all =defs?.some(d => d.id === def.id) ? defs : [...(defs ?? []), def];
  const mine = detectIn(doc, all, engine).hits.filter(h => h.patternId === def.id && h.targetId === targetId);
  const hit = (params && mine.find(h => sameParams(h.params, params))) || mine[0];
  if (!hit) return same([`«${def.name}» ist hier nicht (mehr) vollständig vorhanden — im Diagramm von Hand entfernen.`]);
  // the notation that was recognised — even an older one
  const { match: m, fr } = hit;
  const w = new Writer(doc);
  for (const k of m.attrs) {
    const a = Array.from(t.attributes).find(x => attrKey(x) === k);
    if (a) t.removeAttribute(a.name);
  }
  for (const el of m.items) {
    const box = el.parentElement;
    removeEl(el);
    if (box && CONTAINERS.has(local(box)) && !box.children.length) removeEl(box);
  }
  const ext = firstNamed(t, 'extensionElements');
  if (ext && !ext.children.length) removeEl(ext);
  for (const el of m.attached.values()) drop(w, el);
  // shared blocks: only if no other element in the scope still carries the pattern
  if (fr.blocks.length) {
    // on the process the blocks are the pattern itself; on an element they stay
    // as long as another element in the scope still carries the pattern
    const others = targetId ? detectIn(doc, all, engine).hits
      .filter(h => h.patternId === def.id && h.targetId && byIdIn(doc.documentElement, h.targetId)?.parentElement === scope) : [];
    if (!others.length) {
      const g2 = graphOf(scope);
      for (const x of matchBlocks(fr, g2, new Set(), builtins(targetId ? t : null, proc))) {
        if (x) for (const el of x.elements) if (el.parentElement) drop(w, el);
      }
    }
  }
  return { xml: w.serialize(xml), changed: true, issues: [] };
}

/** Change parameters: take out and insert again with the new values — at the same place */
export function updatePattern(xml: string, def: PatternDef, engine: EngineId, targetId: string | null, params: Record<string, string>, defs?: PatternDef[], previous?: Record<string, string>): PatternResult {
  const before = parseXml(xml);
  const r1 = removePattern(xml, def, engine, targetId, defs, previous);
  if (!r1.changed) return r1;
  const r2 = applyPattern(r1.xml, def, engine, targetId, params);
  if (!r2.changed || !before) return r2;
  // keep the position of the shapes: same IDs get their old coordinates back
  const after = parseXml(r2.xml);
  if (!after) return r2;
  const old = diIndex(before), now = diIndex(after);
  let moved = false;
  for (const [id, di] of now) {
    const o = old.get(id);
    if (!o || local(o) !== local(di)) continue;
    const ob = [o, ...descendants(o)].filter(e => local(e) === 'Bounds' || local(e) === 'waypoint');
    const nb = [di, ...descendants(di)].filter(e => local(e) === 'Bounds' || local(e) === 'waypoint');
    if (ob.length !== nb.length) continue;
    ob.forEach((e, i) => { for (const a of ['x', 'y', 'width', 'height']) { const v = e.getAttribute(a); if (v != null) nb[i].setAttribute(a, v); } });
    moved = true;
  }
  if (!moved) return r2;
  const w = new Writer(after);
  return { ...r2, xml: w.serialize(xml) };
}

// ── For the UI ───────────────────────────────────────────────────────────────
/** name → pattern ID of the inputs or outputs that patterns contribute to an element */
export interface PatternMappings {
  inputs: Map<string, string>;
  outputs: Map<string, string>;
  /**
   * How often a name may come from the pattern — the older process event form
   * carries `processInstanceId` as a local input **and** as `camunda:in`;
   * that is not a duplicate. If the name is missing, once applies.
   */
  times: { inputs: Map<string, number>; outputs: Map<string, number> };
}

/**
 * Which inputs and outputs come from the patterns on the element? That is
 * implementation (definition and instance of the process, return values) and differs per
 * BPMN — the UI hides them; what matters for the business
 * is a parameter on the pattern. Read from the anchor of all notations.
 */
export function patternMappings(defs: PatternDef[] | undefined, applied: AppliedPattern[] | undefined, engine: EngineId): PatternMappings {
  const res: PatternMappings = { inputs: new Map(), outputs: new Map(), times: { inputs: new Map(), outputs: new Map() } };
  for (const a of applied ?? []) {
    const def = defs?.find(d => d.id === a.id);
    if (!def) continue;
    for (const x of recognisedFor(def, engine)) {
      const fr = parseFragment(x);
      if ('error' in fr || !fr.anchor) continue;
      const count = { inputs: new Map<string, number>(), outputs: new Map<string, number>() };
      for (const { el } of fr.items) {
        const n = local(el);
        const isIn = n === 'in' || n === 'input' || n === 'inputParameter';
        const isOut = n === 'out' || n === 'output' || n === 'outputParameter';
        const name = (n.endsWith('Parameter') ? el.getAttribute('name') : el.getAttribute('target')) ?? '';
        if (!name || name.includes('{{')) continue;
        if (isIn && !res.inputs.has(name)) res.inputs.set(name, def.id);
        if (isOut && !res.outputs.has(name)) res.outputs.set(name, def.id);
        const list = isIn ? count.inputs : isOut ? count.outputs : null;
        if (list) list.set(name, (list.get(name) ?? 0) + 1);
      }
      for (const k of ['inputs', 'outputs'] as const) {
        for (const [n, c] of count[k]) res.times[k].set(n, Math.max(res.times[k].get(n) ?? 1, c));
      }
    }
  }
  return res;
}

/** BPMN types of a step — what a pattern must fit */
export function stepTags(kind: string, eventDirection?: string, gatewayType?: string): string[] {
  switch (kind) {
    case 'user': return ['userTask'];
    case 'service': return ['serviceTask'];
    case 'call': return ['callActivity'];
    case 'send': return ['sendTask'];
    case 'receive': return ['receiveTask'];
    case 'rule': return ['businessRuleTask'];
    case 'script': return ['scriptTask'];
    case 'manual': return ['task', 'manualTask'];
    case 'subprocess': return ['subProcess', 'transaction', 'adHocSubProcess'];
    case 'start': return ['startEvent'];
    case 'end': return ['endEvent'];
    case 'event': return [eventDirection === 'throw' ? 'intermediateThrowEvent' : 'intermediateCatchEvent'];
    case 'gateway': return [`${gatewayType ?? 'exclusive'}Gateway`];
    default: return [];
  }
}

/** What a pattern is good for: maintained, otherwise the type of its anchor */
export function appliesTo(def: PatternDef): string[] {
  if (def.appliesTo?.length) return def.appliesTo;
  for (const x of Object.values(def.bpmn)) {
    if (!x) continue;
    const fr = parseFragment(x);
    if (!('error' in fr)) return [fr.anchorTag];
  }
  return [];
}

/** The patterns that fit a step (or the process) and have a BPMN for the engine */
export function patternsFor(defs: PatternDef[] | undefined, tags: string[], engine: EngineId): PatternDef[] {
  return (defs ?? []).filter(d => (d.builtin || fragmentFor(d, engine)) && appliesTo(d).some(t => tags.includes(t)));
}

/** An empty pattern BPMN with an anchor — the starting point in the admin */
export function starterFragment(tag: string, engine: EngineId): string {
  const c8 = engine === 'c8';
  const ns = c8
    ? 'xmlns:zeebe="http://camunda.org/schema/zeebe/1.0" xmlns:modeler="http://camunda.org/schema/modeler/1.0" modeler:executionPlatform="Camunda Cloud"'
    : 'xmlns:camunda="http://camunda.org/schema/1.0/bpmn" xmlns:modeler="http://camunda.org/schema/modeler/1.0" modeler:executionPlatform="Camunda Platform"';
  const isProcess = tag === PROCESS_TARGET;
  const event = /Event$/.test(tag);
  const [w, h] = event ? [36, 36] : [100, 80];
  const node = isProcess ? '' : `\n    <bpmn:${tag} id="${ANCHOR_ID}" name="${STARTER_NAME}" />`;
  const shape = isProcess ? '' : `\n      <bpmndi:BPMNShape id="${ANCHOR_ID}_di" bpmnElement="${ANCHOR_ID}">\n        <dc:Bounds x="200" y="100" width="${w}" height="${h}" />\n      </bpmndi:BPMNShape>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ${ns} id="PatternDefinitions" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="PatternProcess" isExecutable="true">${node}
  </bpmn:process>
  <bpmndi:BPMNDiagram id="PatternDiagram">
    <bpmndi:BPMNPlane id="PatternPlane" bpmnElement="PatternProcess">${shape}
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
`;
}
