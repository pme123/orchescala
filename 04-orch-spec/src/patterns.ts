// Pattern — wiederkehrende BPMN-Bausteine einfügen, erkennen, entfernen.
//
// Ein Pattern ist ein kleines BPMN (siehe `PatternDef` in types.ts):
//
//   ┌──────────────────────┐
//   │ PatternTarget        │  der Anker — sein Typ (userTask, callActivity …)
//   │  · Listener, Eingaben│  ist der Typ, an den das Pattern passt; was an
//   └──◯───────────────────┘  ihm hängt, kommt an **jedes** gewählte Element
//      ↓ Timer {{timer}}
//      ◉ Link «{{link}}»      Boundary-Ereignis samt Pfad: ebenso je Element
//
//   ◉ Link «{{link}}» → [Call Activity] → ○     losgelöster Block: braucht der
//                                               Prozess **einmal** — fehlt er,
//                                               kommt er dazu, sonst nicht
//
// Parameter stehen als `{{name}}` im BPMN — in Attributen, Texten, Skripten.
// Eingebaut sind `{{targetId}}`, `{{targetName}}` und `{{processId}}`.
//
// Aus demselben BPMN folgt die **Erkennung**: ein Element trägt das Pattern,
// wenn alles, was am Anker hängt, auch an ihm hängt — die Parameter werden
// dabei aus den Werten zurückgelesen. Verglichen wird tolerant: Reihenfolge,
// IDs, Namen der Flussknoten und Gross-/Kleinschreibung zählen nicht, und
// was das Element darüber hinaus trägt, stört nicht. Drückt ein älterer
// Prozess dasselbe anders aus, erkennt die Erkennung auch die weiteren
// Schreibweisen (`variants`) — eingefügt wird immer das Pattern-BPMN.
//
// Ein Pattern am **Prozess** (`appliesTo: ['process']`) hat keinen Anker:
// sein Inhalt sind die Blöcke und die Erweiterungen des Prozesses selbst.

import type { AppliedPattern, EngineId, Field, PatternDef, PatternParam, ProcessSpec, TypeDef } from './types';
import { appendEl, prependEl, removeEl } from './xmlFormat';
import { uid } from './util';

export const ANCHOR_ID = 'PatternTarget';
/** Name des Ankers in einem neuen Pattern — ein Platzhalter, kein Name für das Element */
const STARTER_NAME = 'Element mit dem Pattern';
export const PROCESS_TARGET = 'process';
/** Platzhalter, die die App selbst füllt */
export const BUILTIN_PARAMS = ['targetId', 'targetName', 'processId', 'startMessage'] as const;

// ── Pattern von Orchescala ───────────────────────────────────────────────────
// Fest dabei, nicht im Admin gepflegt und nicht im BPMN: ihre Werte stehen in
// der Spezifikation und gehen über den Export in die Domain.

/**
 * Die Bezeichnung des Prozesses — `override def processLabels` im
 * Prozess-Objekt. Der Init-Worker setzt daraus die Prozessvariablen
 * `callingProcessKeyDE` und `callingProcessKeyFR` (ProcessLabels in
 * Orchescala); Pattern wie «Benutzer per Mail informieren» lesen sie, und
 * das `Out` des Prozesses gibt sie zurück. Gespeichert in `spec.processLabels`;
 * die Felder im `Out` gehören dazu, solange das Pattern gewählt ist.
 */
export const PROCESS_LABELS_PATTERN = 'process-labels';

/** Die Felder, die das Pattern ins `Out` bringt */
const LABEL_FIELDS = (['DE', 'FR'] as const).map(lang => ({
  name: `callingProcessKey${lang}`,
  description: `Bezeichnung des Prozesses (${lang === 'DE' ? 'deutsch' : 'französisch'}) — aus processLabels`,
  example: `processLabels.${lang.toLowerCase()}`,
}));

export const ORCHESCALA_PATTERNS: PatternDef[] = [{
  id: PROCESS_LABELS_PATTERN,
  name: 'Prozess-Bezeichnung',
  description: 'Die Bezeichnung des Prozesses je Sprache — `override def processLabels` im Prozess-Objekt. '
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
 * Das Pattern von Orchescala, zu dem ein Feld gehört — `callingProcessKeyDE/FR`
 * im `Out`, solange «Prozess-Bezeichnung» gewählt ist; auch wenn die Felder
 * aus der Domain kommen. Sonst `null`.
 */
export function patternOfField(spec: ProcessSpec, type: TypeDef | undefined, field: Field): PatternDef | null {
  if (!spec.processLabels || !type?.processOut) return null;
  return LABEL_FIELDS.some(l => l.name === field.name) ? ORCHESCALA_PATTERNS[0] : null;
}

/** Die Pattern von Orchescala und die aus dem Admin */
export const allPatterns = (defs: PatternDef[] | undefined): PatternDef[] => [...ORCHESCALA_PATTERNS, ...(defs ?? [])];

/** Die Pattern am Prozess — die von Orchescala aus der Spezifikation, die übrigen aus dem Diagramm */
export function processPatterns(spec: ProcessSpec): AppliedPattern[] {
  const labels = spec.processLabels;
  return [
    ...(labels ? [{ id: PROCESS_LABELS_PATTERN, params: { de: labels.de, fr: labels.fr } }] : []),
    ...(spec.patterns ?? []),
  ];
}

/**
 * Ein Pattern von Orchescala wählen, ändern oder entfernen — ohne Diagramm.
 * «Prozess-Bezeichnung» bringt dabei `callingProcessKeyDE/FR` ins `Out` (das
 * `Out` entsteht, wenn es fehlt) und nimmt sie beim Entfernen wieder weg; ein
 * Feld, das es dort schon gibt (aus der Domain), bleibt, wie es ist.
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

// ── DOM-Helfer (namespace-tolerant wie in bpmn.ts) ───────────────────────────
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

/** Knoten im Ablauf — was einen Platz im Diagramm hat und Sequenzflüsse trägt */
const FLOW_NODES = new Set([
  'startEvent', 'endEvent', 'intermediateCatchEvent', 'intermediateThrowEvent', 'boundaryEvent',
  'task', 'serviceTask', 'userTask', 'sendTask', 'receiveTask', 'businessRuleTask', 'scriptTask', 'manualTask',
  'callActivity', 'subProcess', 'transaction', 'adHocSubProcess',
  'exclusiveGateway', 'parallelGateway', 'inclusiveGateway', 'eventBasedGateway', 'complexGateway',
]);
/** Inhalt eines Prozesses, der nicht zu den Erweiterungen des Ankers zählt */
const SCOPE_CONTENT = new Set([...FLOW_NODES, 'sequenceFlow', 'laneSet', 'textAnnotation', 'association', 'group',
  'dataObject', 'dataObjectReference', 'dataStoreReference']);
/** Kinder, die nur Verdrahtung sind */
const STRUCTURAL = new Set(['incoming', 'outgoing', 'documentation']);
/** Sammelelemente in `extensionElements`, deren Einträge einzeln zählen */
const CONTAINERS = new Set(['inputOutput', 'properties', 'ioMapping', 'taskHeaders']);
/** Attribute, die auf ein Root-Element zeigen — verglichen wird dessen Name */
const REF_ATTRS = new Set(['signalRef', 'messageRef', 'errorRef', 'escalationRef']);
/** Attribute, die nie zählen */
const SKIP_ATTRS = new Set(['id', 'attachedToRef', 'sourceRef', 'targetRef', 'default', 'isExecutable']);

/** Die BPMN-Typen, die die Oberfläche anbietet — für Auswahl und Anzeige */
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

// ── Platzhalter ──────────────────────────────────────────────────────────────
const PH = /\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}/g;

/** Die Parameter eines Pattern-BPMN (ohne die eingebauten), in Reihenfolge */
export function placeholders(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(PH)) {
    if (!out.includes(m[1]) && !(BUILTIN_PARAMS as readonly string[]).includes(m[1])) out.push(m[1]);
  }
  return out;
}

/**
 * Die Parameter, wie sie am Element erscheinen: nur die, die im BPMN dieser
 * Engine vorkommen. `inBlock`: steht nur im gemeinsamen Block — wirkt beim
 * ersten Einfügen, danach gehört der Block dem Prozess (im Diagramm ändern).
 */
export function patternParamsFor(def: PatternDef, engine: EngineId, atProcess: boolean): Array<PatternParam & { inBlock?: boolean }> {
  const x = fragmentFor(def, engine);
  const fr = x ? parseFragment(x) : null;
  if (!fr || 'error' in fr) return patternParams(def);
  return patternParams(def)
    .filter(p => fr.elementParams.has(p.name) || fr.blockParams.has(p.name))
    .map(p => (!atProcess && fr.blockParams.has(p.name) ? { ...p, inBlock: true } : p));
}

/** Alle Parameter eines Patterns: gepflegte plus die, die nur im BPMN stehen */
export function patternParams(def: PatternDef): PatternParam[] {
  const known = def.params ?? [];
  const names = new Set(known.map(p => p.name));
  const sources = [...Object.values(def.bpmn), ...Object.values(def.variants ?? {}).flat()];
  const extra = sources.flatMap(x => (x ? placeholders(x) : [])).filter(n => !names.has(n) && (names.add(n), true));
  return [...known, ...extra.map(name => ({ name }))];
}

const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Ein Parameter mit FEEL-Ausdruck (`=x`, Camunda 8) passt nicht in einen
 * FEEL-Text des Patterns (`source="=&#34;{{p}}&#34;"`) — dort ersetzt er den
 * ganzen Wert: `source="=x"`. Ein fester Text bleibt im Text.
 */
const QUOTED_PH = /="=\s*(?:&#34;|&quot;)\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}(?:&#34;|&quot;)"/g;
const isFeelValue = (v: string | undefined): v is string => !!v && /^=/.test(v.trim()) && !/^=\s*"[^"]*"$/.test(v.trim());

/** Platzhalter füllen; was keinen Wert hat, wird leer */
export function fillPlaceholders(xml: string, values: Record<string, string | undefined>): string {
  // eine Vorgabe darf die eingebauten nennen (`{{processId}}-inform`)
  const resolved: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) resolved[k] = (v ?? '').replace(PH, (_, n: string) => values[n] ?? '');
  return xml
    .replace(QUOTED_PH, (all, name: string) => (isFeelValue(resolved[name]) ? `="${xmlEscape(resolved[name].trim())}"` : all))
    .replace(PH, (_, name: string) => xmlEscape(resolved[name] ?? ''));
}

type Binding = ReadonlyMap<string, string>;
const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Einen Text gegen eine Vorlage mit `{{name}}` halten. Schon gebundene
 * Namen müssen denselben Wert haben; neue werden gebunden.
 */
function matchText(tpl: string, actual: string, b: Binding): Binding | null {
  // `#{…}` und `${…}` sind in Camunda 7 dasselbe; Leerraum zählt nicht
  const norm = (s: string) => s.replace(/#\{/g, '${').replace(/\s+/g, ' ').trim();
  const t = norm(tpl), a = norm(actual);
  // `="{{p}}"` im Pattern, aber ein FEEL-Ausdruck im Diagramm (siehe fillPlaceholders):
  // der Parameter ist der ganze Ausdruck
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

/** Wörtliche Zeichen einer Vorlage — Mass für «wie bestimmt» ein Pattern ist */
const literalLength = (s: string) => s.replace(PH, '').replace(/\s+/g, '').length;

// ── Vergleich zweier Elemente ────────────────────────────────────────────────
/** Attribut-Schlüssel ohne beliebige Prefixe — `camunda:` und `zeebe:` bleiben stehen */
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

/** Name eines Root-Elements (Signal, Nachricht, Fehler) über seine ID */
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
 * Passt `t` zur Vorlage `f`? Gleiche Art, jedes Attribut und jedes Kind der
 * Vorlage findet sein Gegenstück (Reihenfolge egal); was `t` darüber hinaus
 * hat, stört nicht.
 */
function matchEl(f: Element, t: Element, b: Binding): Binding | null {
  if (local(f) !== local(t)) return null;
  const flow = FLOW_NODES.has(local(f)) || local(f) === 'sequenceFlow';
  let cur: Binding | null = b;
  for (const [k, fv] of attrsOf(f, flow)) {
    let tv = attrOf(t, k);
    if (tv == null) return null;
    let want = fv;
    if (REF_ATTRS.has(k)) { want = refName(f.ownerDocument, fv); tv = refName(t.ownerDocument, tv); }
    cur = matchText(want, tv, cur);
    if (!cur) return null;
  }
  // Text zählt nur an Blättern — sonst stünden die IDs aus <incoming> darin
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

// ── Graph eines Scopes ───────────────────────────────────────────────────────
interface Graph {
  container: Element;
  nodes: Element[];
  byId: Map<string, Element>;
  /** Knoten-ID → ausgehende Flüsse */
  out: Map<string, Element[]>;
  inCount: Map<string, number>;
  /** Knoten-ID → Boundary-Ereignisse daran */
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

/** Alles, was ab einem Knoten über Flüsse (und Boundary-Ereignisse) erreichbar ist */
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
 * Den Pfad ab `f` (Vorlage) auf den ab `t` (Diagramm) legen: Knoten für
 * Knoten, Fluss für Fluss. Liefert die Zuordnung Vorlage → Diagramm.
 */
function matchGraph(fg: Graph, f: Element, tg: Graph, t: Element, b: Binding, map: Mapping, claimed: Set<Element>): { b: Binding; map: Mapping } | null {
  const had = map.get(f);
  if (had) return had === t ? { b, map } : null;
  if (claimed.has(t) || [...map.values()].includes(t)) return null;
  const b1 = matchEl(f, t, b);
  if (!b1) return null;
  let cur = { b: b1, map: new Map(map).set(f, t) };
  const fid = f.getAttribute('id') ?? '', tid = t.getAttribute('id') ?? '';
  // Boundary-Ereignisse an Knoten des Pfads
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

// ── Das Pattern-BPMN ─────────────────────────────────────────────────────────
interface Item {
  el: Element;
  /** Sammelelement in `extensionElements` (inputOutput …) oder '' */
  container: string;
  /** direkt in `extensionElements` bzw. am Element selbst */
  inExt: boolean;
}

/** Was ein Element über seine Verdrahtung hinaus trägt: Erweiterungen, Ereignisdefinitionen … */
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
 * Welche Variable ein Mapping belegt (`camunda:in`/`out`, Input-/Output-Parameter,
 * `zeebe:input`/`output`) — `null` für alles andere und für `variables="all"`.
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
  /** null: das Pattern gilt dem Prozess selbst */
  anchor: Element | null;
  /** Typ des Ankers, bzw. `process` */
  anchorTag: string;
  graph: Graph;
  items: Item[];
  attrs: Array<[string, string]>;
  /** je Boundary-Ereignis am Anker: das Ereignis samt Pfad */
  attached: Array<{ boundary: Element; nodes: Element[]; flows: Element[] }>;
  /** losgelöste Blöcke — braucht der Prozess einmal */
  blocks: Array<{ entry: Element; nodes: Element[]; flows: Element[] }>;
  /** wie bestimmt der Anker ist (wörtliche Zeichen) — bei Konkurrenz gewinnt der bestimmtere */
  score: number;
  /** Platzhalter am Element (Anker, Pfade) bzw. nur in den gemeinsamen Blöcken */
  elementParams: Set<string>;
  blockParams: Set<string>;
  /** Hinweise für den Admin */
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
/** Der Prozess, den auch der Import nimmt: der erste mit Elementen */
function mainProcess(doc: Document): Element | null {
  const all = processes(doc);
  return all.find(p => kids(p).some(c => FLOW_NODES.has(local(c)))) ?? all[0] ?? null;
}

const fragCache = new Map<string, Fragment | string>();

/** Das Pattern-BPMN lesen: Anker, was an ihm hängt, und die Blöcke daneben */
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
  // Blöcke: der Rest, zusammenhängend über Flüsse; Einstieg ist der Knoten ohne Eingang
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
  // Inhalt eines Elements als Text — Namen, Attribute, Texte (ohne XMLSerializer, auch für die CLI)
  const ser = (el: Element): string => [local(el), ...Array.from(el.attributes).map(x => `${x.name}=${x.value}`),
    ...(el.children.length ? kids(el).map(ser) : [el.textContent ?? ''])].join(' ');
  const score = items.reduce((s, i) => s + literalLength(ser(i.el)), 0)
    + attrs.reduce((s, [k, v]) => s + k.length + literalLength(v), 0)
    + attached.reduce((s, a) => s + [a.boundary, ...a.nodes].reduce((x, e) => x + literalLength(ser(e)), 0), 0);
  const phs = (els: Element[]) => new Set(els.flatMap(e => placeholders(ser(e))));
  const elementParams = new Set([...phs(items.map(i => i.el)), ...attrs.flatMap(([, v]) => placeholders(v)),
    ...phs(attached.flatMap(a => [a.boundary, ...a.nodes, ...a.flows]))]);
  const inBlocks = phs(blocks.flatMap(b => [...b.nodes, ...b.flows]));
  // was die Blöcke über Signale/Nachrichten nennen, steht in den Root-Elementen
  for (const r of kids(doc.documentElement)) if (!['process', 'collaboration', 'BPMNDiagram'].includes(local(r))) for (const n of placeholders(ser(r))) inBlocks.add(n);
  const blockParams = new Set([...inBlocks].filter(n => !elementParams.has(n)));
  if (anchor && !items.length && !attrs.length && !attached.length) {
    warnings.push('Am Anker hängt nichts — das Pattern lässt sich einfügen, aber nicht wiedererkennen.');
  }
  return { doc, process, anchor, anchorTag: anchor ? local(anchor) : PROCESS_TARGET, graph, items, attrs, attached, blocks, score, warnings, elementParams, blockParams };
}

/** Zusammenfassung für die Admin-Ansicht */
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

// ── Erkennen ─────────────────────────────────────────────────────────────────
export interface PatternHit {
  patternId: string;
  /** Element-ID, oder null für den Prozess */
  targetId: string | null;
  params: Record<string, string>;
}

export interface Detection {
  hits: PatternHit[];
  /** Element-ID → Pattern-ID: alles, was zu einem Pattern gehört (Pfade, Blöcke) */
  owned: Map<string, string>;
}

interface AnchorMatch {
  b: Binding;
  items: Element[];
  attrs: string[];
  /** Boundary-Ereignisse samt Pfad: Knoten und Flüsse im Diagramm, je Vorlage-Element */
  attached: Mapping;
}

/** Trägt `t` alles, was am Anker hängt? */
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
 * Was ab einem Einstieg **nur** zu ihm gehört: ein Knoten zählt dazu, wenn
 * alle seine Eingänge aus dem Block kommen. So bleibt ein Pfad, der in den
 * Hauptablauf zurückführt, beim Entfernen unangetastet.
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
 * Die gemeinsamen Blöcke des Patterns im Scope suchen. Massgebend ist der
 * **Einstieg**: ein Link-Ziel mit demselben Namen, ein Ereignis-Subprozess
 * mit demselben Start — was dahinter kommt, gehört dazu, auch wenn es vom
 * Pattern abweicht. Sonst stünde ein zweites, gleichnamiges Link-Ziel im
 * Prozess, sobald ein Block ein Feld mehr oder weniger hat.
 */
function matchBlocks(fr: Fragment, tg: Graph, claimed: Set<Element>, base: Binding): Array<{ b: Binding; elements: Element[] } | null> {
  return fr.blocks.map(block => {
    const entry = block.entry;
    const esp = local(entry) === 'subProcess' && entry.getAttribute('triggeredByEvent') === 'true';
    for (const tn of tg.nodes) {
      if (claimed.has(tn) || local(tn) !== local(entry)) continue;
      let b: Binding | null = base;
      if (esp) {
        if (tn.getAttribute('triggeredByEvent') !== 'true') continue;
        // ein Ereignis-Subprozess ist, was ihn auslöst: sein Startereignis
        for (const fs of kids(entry).filter(c => local(c) === 'startEvent')) {
          let hit: Binding | null = null;
          for (const ts of kids(tn).filter(c => local(c) === 'startEvent')) { hit = matchEl(fs, ts, b!); if (hit) break; }
          b = hit;
          if (!b) break;
        }
      } else b = matchEl(entry, tn, base);
      if (b) return { b, elements: reachOwned(tg, tn) };
    }
    return null;
  });
}

const builtins = (t: Element | null, proc: Element | null): Map<string, string> => {
  const m = new Map<string, string>();
  if (t) { m.set('targetId', t.getAttribute('id') ?? ''); m.set('targetName', t.getAttribute('name') ?? ''); }
  if (proc) {
    m.set('processId', proc.getAttribute('id') ?? '');
    // Name der Nachricht, mit der der Prozess startet (Nachrichten-Startereignis)
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

/** Das Pattern-BPMN für die Engine, oder null */
export const fragmentFor = (def: PatternDef, engine: EngineId): string | null => def.bpmn[engine]?.trim() || null;

/** Was die Erkennung annimmt: das Pattern-BPMN, dahinter die weiteren Schreibweisen */
export const recognisedFor = (def: PatternDef, engine: EngineId): string[] => {
  const main = fragmentFor(def, engine);
  return main ? [main, ...(def.variants?.[engine] ?? []).map(x => x?.trim()).filter((x): x is string => !!x)] : [];
};

/**
 * Welche Pattern trägt das Diagramm, und wo? Bestimmtere Pattern zuerst —
 * was eines für sich beansprucht, kann kein anderes mehr haben.
 */
export function detectPatterns(docOrXml: Document | string, defs: PatternDef[] | undefined, engine: EngineId): Detection {
  const doc = typeof docOrXml === 'string' ? parseXml(docOrXml) : docOrXml;
  if (!doc) return { hits: [], owned: new Map() };
  const r = detectIn(doc, defs, engine);
  return { hits: r.hits.map(({ match: _, fr: __, ...h }) => h), owned: r.owned };
}

interface InternalHit extends PatternHit {
  /** was im Diagramm dazugehört — Elemente dieses Dokuments */
  match: AnchorMatch;
  /** die Schreibweise, die gepasst hat */
  fr: Fragment;
}

/**
 * Die Erkennung selbst. Entfernen arbeitet auf ihrem Ergebnis — so nimmt es
 * genau das heraus, was die Erkennung dem Pattern zugeordnet hat, und nicht
 * das erste, was irgendwie passt (ein allgemeiner Timer → Link könnte sonst
 * den Timer der Eskalation treffen).
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
      // dasselbe Pattern kann mehrmals am Element hängen (zwei Mail-Timer) —
      // was schon zugeordnet ist, steht dem nächsten nicht mehr zur Verfügung
      for (let i = 0; i < 10; i++) {
        const m = matchAnchor(fr, t, tg, claimed, builtins(t, proc));
        if (!m) break;
        m.items.forEach(e => claimed.add(e));
        own(m.attached.values(), def.id);
        res.hits.push({ patternId: def.id, targetId: t.getAttribute('id'), params: paramsOf(m.b, def), match: m, fr });
        // gemeinsame Blöcke einmal je Scope zuordnen
        if (fr.blocks.length) {
          for (const x of matchBlocks(fr, tg, claimed, m.b)) if (x) own(x.elements, def.id);
        }
        if (!m.items.length && !m.attached.size) break;
      }
    }
  }
  return res;
}

// ── Einfügen ─────────────────────────────────────────────────────────────────
export interface PatternResult {
  /** unverändert, wenn nichts geschrieben wurde */
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
/** Rahmen um die Formen und Kanten */
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

/** DI-Elemente (Formen und Kanten) je bpmnElement */
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
  /** Namensräume des Pattern-BPMN auch im Diagramm deklarieren */
  declareFrom(frag: Document) {
    for (const a of Array.from(frag.documentElement.attributes)) {
      if (!a.name.startsWith('xmlns:')) continue;
      if (!this.defs.hasAttribute(a.name)) this.defs.setAttributeNS(XMLNS_NS, a.name, a.value);
    }
  }
  /**
   * Neue IDs vorab vergeben — sonst zeigt ein <outgoing> eines Knotens noch
   * auf die alte ID eines Flusses, der erst danach übernommen wird.
   */
  reserve(els: Element[], prefix: string, idMap: Map<string, string>) {
    for (const el of els) for (const e of [el, ...descendants(el)]) {
      const id = e.getAttribute('id');
      if (id && !idMap.has(id)) idMap.set(id, this.newId(prefix ? `${prefix}_${id}` : id));
    }
  }
  /** Element aus dem Pattern-BPMN übernehmen — alle IDs darin neu (`prefix_id`, ohne prefix die ID selbst), Verweise nachgezogen */
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
  /** Signal, Nachricht, Fehler: den gleichnamigen im Diagramm nehmen, sonst übernehmen */
  rootRef(fragId: string, frag: Document): string {
    const src = byIdIn(frag.documentElement, fragId);
    if (!src) return fragId;
    const tag = local(src), name = refName(frag, fragId);
    const have = kids(this.defs).find(e => local(e) === tag && refName(this.doc, e.getAttribute('id') ?? '') === name);
    if (have) return have.getAttribute('id')!;
    const el = this.doc.importNode(src, true) as Element;
    el.setAttribute('id', this.newId(fragId));
    const before = kids(this.defs).find(e => local(e) === 'process' || local(e) === 'collaboration' || local(e) === 'BPMNDiagram');
    if (before) {
      this.defs.insertBefore(el, before);
      this.defs.insertBefore(this.doc.createTextNode('\n  '), before);
    } else appendEl(this.defs, el);
    return el.getAttribute('id')!;
  }
  /** DI des Pattern-BPMN übernehmen: verschoben, auf die neuen IDs gezogen */
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
    let out = new XMLSerializer().serializeToString(this.doc);
    const decl = /^<\?xml[^>]*\?>/.exec(original)?.[0];
    if (decl && !out.startsWith('<?xml')) out = `${decl}\n${out}`;
    return out.replace(/^(<\?xml[^>]*\?>)(?!\n)/, '$1\n');
  }
}

/**
 * Den Start des Prozesses zum Nachrichten-Startereignis machen: das leere
 * Startereignis bekommt eine Nachricht mit der Prozess-ID als Namen (die
 * vorhandene gleichen Namens, sonst eine neue). Liefert einen Hinweis, wenn
 * es kein leeres Startereignis gibt.
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
  // Präfix aus dem Tag (`bpmn:startEvent`) — `prefix` setzt nicht jedes DOM
  const pre = start.tagName.includes(':') ? start.tagName.slice(0, start.tagName.indexOf(':') + 1) : '';
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

/** Die Ebene (BPMNPlane), in der ein Element gezeichnet ist */
function planeOf(w: Writer, id: string | null): Element | null {
  const di = id ? w.di.get(id) : null;
  if (di?.parentElement && local(di.parentElement) === 'BPMNPlane') return di.parentElement;
  return descendants(w.defs).find(e => local(e) === 'BPMNPlane') ?? null;
}

/** Pool (Participant) eines Prozesses im Diagramm */
function participantOf(w: Writer, proc: Element): Element | null {
  const pid = proc.getAttribute('id');
  return descendants(w.defs).find(e => local(e) === 'participant' && e.getAttribute('processRef') === pid) ?? null;
}

/** Pool und unterste Bahn so weit aufziehen, dass die neuen Formen darin liegen */
function growPool(w: Writer, proc: Element, added: Element[], laneFor: (id: string) => Element | null, newIds: string[]) {
  const part = participantOf(w, proc);
  const pShape = part ? w.di.get(part.getAttribute('id') ?? '') : null;
  const pb = pShape ? firstNamed(pShape, 'Bounds') : null;
  const box = extent(added);
  // Bahnen: neue Knoten gehören in eine Bahn — die des Ziels, sonst die unterste
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
  // was unter dem Pool liegt (weitere Pools, Nachrichtenflüsse), rückt mit nach unten
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

/** Vorgaben der Parameter plus die eingebauten */
function valuesFor(def: PatternDef, params: Record<string, string>, t: Element | null, proc: Element | null): Record<string, string> {
  const v: Record<string, string> = {};
  for (const p of patternParams(def)) if (p.default != null) v[p.name] = p.default;
  Object.assign(v, Object.fromEntries(Object.entries(params).filter(([, x]) => x != null && x !== '')));
  for (const [k, x] of builtins(t, proc)) v[k] = x;
  return v;
}

/**
 * Ein Pattern an ein Element (bzw. den Prozess, `targetId === null`)
 * hängen. Das XML bleibt sonst, wie es ist; die neuen Teile stehen dort, wo
 * sie im Pattern-BPMN relativ zum Anker stehen, gemeinsame Blöcke unter dem
 * Diagramm.
 */
export function applyPattern(xml: string, def: PatternDef, engine: EngineId, targetId: string | null, params: Record<string, string> = {}): PatternResult {
  const same = (issues: string[]): PatternResult => ({ xml, changed: false, issues });
  const src = fragmentFor(def, engine);
  if (!src) return same([`«${def.name}» hat kein BPMN für ${engine === 'c8' ? 'Camunda 8' : 'Camunda 7'}.`]);
  const doc = parseXml(xml);
  if (!doc) return same(['Das Diagramm ist kein lesbares BPMN.']);
  const proc = mainProcess(doc);
  const t = targetId ? byIdIn(doc.documentElement, targetId) : proc;
  if (!t || !proc) return same([targetId ? `«${targetId}» steht nicht im Diagramm.` : 'Kein Prozess im Diagramm.']);
  const scope = targetId ? t.parentElement! : proc;
  const w = new Writer(doc);
  // `{{startMessage}}` braucht ein Nachrichten-Startereignis — fehlt es, wird
  // der Start des Prozesses eines (Nachricht = Prozess-ID, die Konvention)
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
  /** DI eines übernommenen Elements — samt allem darin (Inhalt eines Subprozesses) */
  const adoptDiAll = (e: Element, dx: number, dy: number) => {
    if (!plane) return;
    for (const x of [e, ...descendants(e)]) {
      const d = w.adoptDi(fragDi, x.getAttribute('id') ?? '', idMap, plane, dx, dy);
      if (d) newDi.push(d);
    }
  };

  // 1. am Element: Attribute und Erweiterungen, soweit sie fehlen
  for (const [k, v] of fr.attrs) {
    const a = fr.anchor ? Array.from(fr.anchor.attributes).find(x => attrKey(x) === k) : null;
    if (!a || attrOf(t, k) === v) continue;
    if (a.namespaceURI) t.setAttributeNS(a.namespaceURI, a.name, a.value); else t.setAttribute(a.name, a.value);
    changed = true;
  }
  const tItems = itemsOf(t);
  const usedItems = new Set<Element>();
  let ext = firstNamed(t, 'extensionElements');
  for (const fi of fr.items) {
    const have = tItems.find(ti => sameSlot(fi, ti) && !usedItems.has(ti.el) && matchEl(fi.el, ti.el, new Map()));
    if (have) { usedItems.add(have.el); continue; }
    // dieselbe Variable schon anders belegt: das Pattern gilt — sonst stünde sie doppelt da
    const key = mappingKey(fi.el);
    if (key) {
      for (const ti of tItems) {
        if (usedItems.has(ti.el) || !sameSlot(fi, ti) || mappingKey(ti.el) !== key) continue;
        usedItems.add(ti.el);
        removeEl(ti.el);
      }
    }
    const el = w.adopt(fi.el, targetId ?? 'process', idMap, fr.doc);
    if (!fi.inExt) appendEl(t, el);
    else {
      if (!ext) {
        const fext = firstNamed(fr.anchor ?? fr.process, 'extensionElements')!;
        ext = w.doc.importNode(fext, false) as Element;
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

  // 2. am Element hängend: Boundary-Ereignisse samt Pfad — relativ zum Anker
  const tBox = targetId ? boundsOf(w.di.get(targetId)) : null;
  const aBox = fr.anchor ? boundsOf(fragDi.get(ANCHOR_ID)) : null;
  const laneOfTarget = targetId ? descendants(proc).find(e => local(e) === 'lane' && kids(e).some(r => local(r) === 'flowNodeRef' && textOf(r) === targetId)) ?? null : null;
  const attachedIds: string[] = [];
  if (fr.attached.length) {
    const already = targetId ? matchAnchor({ ...fr, items: [], attrs: [] }, t, tg, new Set(), builtins(t, proc)) : null;
    if (!already) {
      // belegte Stellen am Rand: bestehende Boundary-Ereignisse
      const taken = (tg.boundaries.get(targetId ?? '') ?? []).map(b => boundsOf(w.di.get(b.getAttribute('id') ?? ''))).filter((b): b is Box => !!b);
      for (const a of fr.attached) {
        const bb = boundsOf(fragDi.get(a.boundary.getAttribute('id') ?? ''));
        let dx = 0, dy = 0;
        if (tBox && aBox && bb) {
          // Mittelpunkt relativ zur Grösse des Ankers — passt auch an grössere Elemente
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

  // 3. einmal im Prozess: Blöcke, die es im Scope noch nicht gibt — unter das Diagramm
  const matched = matchBlocks(fr, tg, new Set(), builtins(targetId ? t : null, proc));
  const missing = fr.blocks.filter((_, i) => !matched[i]);
  if (missing.length) {
    const fromDi = missing.flatMap(b => [...b.nodes, ...b.flows]).map(e => fragDi.get(e.getAttribute('id') ?? '')).filter((x): x is Element => !!x);
    const fbox = extent(fromDi);
    const scopeIds = new Set(descendants(scope).map(e => e.getAttribute('id')).filter(Boolean));
    const content = [...w.di.entries()].filter(([id]) => scopeIds.has(id)).map(([, d]) => d);
    const tb = extent([...content, ...newDi]);
    const part = participantOf(w, proc);
    const pBox = part ? boundsOf(w.di.get(part.getAttribute('id') ?? '')) : null;
    const x0 = pBox ? pBox.x + 60 : tb?.x ?? 0;
    const y0 = (tb ? tb.y + tb.h : pBox ? pBox.y : 0) + 70;
    const dx = fbox ? x0 - fbox.x : 0, dy = fbox ? y0 - fbox.y : 0;
    // gemeinsame Blöcke behalten die IDs aus dem Pattern-BPMN (Hauskonvention) — nur bei Kollision mit Zähler
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
  if (!changed) return same([`«${def.name}» ist hier schon vorhanden.`]);
  // ein namenloses Element heisst wie der Anker («Init Process») — sonst bliebe es ohne Beschriftung
  const anchorName = fr.anchor?.getAttribute('name')?.trim();
  if (targetId && anchorName && anchorName !== STARTER_NAME && !t.getAttribute('name')?.trim()) t.setAttribute('name', anchorName);
  if (!plane && (fr.attached.length || missing.length)) w.issues.push('Das Diagramm hat keine Zeichnung (DI) — die neuen Elemente stehen ohne Position darin.');
  if (newDi.length && local(scope) === 'process') growPool(w, proc, newDi, id => (attachedIds.includes(id) ? laneOfTarget : null), newIds);
  return { xml: w.serialize(xml), changed: true, issues: w.issues };
}

// ── Entfernen ────────────────────────────────────────────────────────────────
/** Element samt DI und Verweisen darauf aus dem Diagramm nehmen */
function drop(w: Writer, el: Element) {
  // der Inhalt (eines Subprozesses) hat eigene Formen
  for (const x of descendants(el)) {
    const xid = x.getAttribute('id');
    const di = xid ? w.di.get(xid) : null;
    if (di) { removeEl(di); w.di.delete(xid!); }
  }
  const id = el.getAttribute('id');
  if (id) {
    const di = w.di.get(id);
    if (di) { removeEl(di); w.di.delete(id); }
    // Verweise in Bahnen und an den Nachbarn
    for (const e of descendants(w.defs)) {
      const n = local(e);
      if ((n === 'flowNodeRef' || n === 'incoming' || n === 'outgoing') && textOf(e) === id) removeEl(e);
    }
  }
  removeEl(el);
}

/**
 * Ein Pattern von einem Element (bzw. dem Prozess) nehmen: was am Element
 * hängt, und die gemeinsamen Blöcke, wenn es sonst niemand mehr braucht.
 */
const sameParams = (a: Record<string, string> | undefined, b: Record<string, string> | undefined) => {
  const norm = (x?: Record<string, string>) => JSON.stringify(Object.entries(x ?? {}).filter(([, v]) => v !== '').sort());
  return norm(a) === norm(b);
};

/**
 * `params` wählt die Instanz, wenn dasselbe Pattern mehrmals am Element hängt.
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
  // die Schreibweise, die erkannt wurde — auch eine ältere
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
  // gemeinsame Blöcke: nur, wenn kein anderes Element im Scope das Pattern noch trägt
  if (fr.blocks.length) {
    // am Prozess sind die Blöcke das Pattern selbst; an einem Element bleiben
    // sie, solange ein anderes Element im Scope das Pattern noch trägt
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

/** Parameter ändern: herausnehmen und mit den neuen Werten wieder einfügen — an derselben Stelle */
export function updatePattern(xml: string, def: PatternDef, engine: EngineId, targetId: string | null, params: Record<string, string>, defs?: PatternDef[], previous?: Record<string, string>): PatternResult {
  const before = parseXml(xml);
  const r1 = removePattern(xml, def, engine, targetId, defs, previous);
  if (!r1.changed) return r1;
  const r2 = applyPattern(r1.xml, def, engine, targetId, params);
  if (!r2.changed || !before) return r2;
  // Lage der Formen behalten: gleiche IDs bekommen ihre alten Koordinaten zurück
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

// ── Für die Oberfläche ───────────────────────────────────────────────────────
/** Name → Pattern-ID der Ein- bzw. Ausgaben, die Pattern an einem Element beisteuern */
export interface PatternMappings {
  inputs: Map<string, string>;
  outputs: Map<string, string>;
  /**
   * Wie oft ein Name vom Pattern kommen darf — die ältere Prozess-Event-Form
   * trägt `processInstanceId` als lokale Eingabe **und** als `camunda:in`;
   * das ist kein Doppel. Fehlt der Name, gilt einmal.
   */
  times: { inputs: Map<string, number>; outputs: Map<string, number> };
}

/**
 * Welche Ein- und Ausgaben kommen von den Pattern am Element? Das ist
 * Implementation (Definition und Instanz des Prozesses, Rückgaben) und je
 * BPMN verschieden — die Oberfläche blendet sie aus; was fachlich zählt,
 * steht als Parameter am Pattern. Gelesen aus dem Anker aller Schreibweisen.
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

/** BPMN-Typen eines Schritts — wofür ein Pattern passen muss */
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

/** Wofür ein Pattern taugt: gepflegt, sonst der Typ seines Ankers */
export function appliesTo(def: PatternDef): string[] {
  if (def.appliesTo?.length) return def.appliesTo;
  for (const x of Object.values(def.bpmn)) {
    if (!x) continue;
    const fr = parseFragment(x);
    if (!('error' in fr)) return [fr.anchorTag];
  }
  return [];
}

/** Die Pattern, die an einen Schritt (bzw. den Prozess) passen und für die Engine ein BPMN haben */
export function patternsFor(defs: PatternDef[] | undefined, tags: string[], engine: EngineId): PatternDef[] {
  return (defs ?? []).filter(d => (d.builtin || fragmentFor(d, engine)) && appliesTo(d).some(t => tags.includes(t)));
}

/** Ein leeres Pattern-BPMN mit Anker — der Anfang im Admin */
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
