// BPMN → Spezifikation.
//
// Der Kern des PoC: aus der **Implementation** (der BPMN-Datei) wird die
// Struktur der Spezifikation abgeleitet. Aus dem flachen BPMN-Graph wird ein
// **Baum**: Gateways bekommen ihre Zweige bis zur Zusammenführung, Subprozesse
// ihre Kinder, Rücksprünge werden als Schleife markiert. Das ist die Grundlage
// für «guter Überblick», «Gateways und Loops sichtbar» und «Details einklappen».
//
// Fachliche Texte (description/notes/open) gehören der Spezifikation und
// werden beim erneuten Import über die stabile BPMN-Element-ID **behalten**
// (siehe `mergeSpec`) — die Implementation aktualisiert nur die Struktur.

import type { AppliedPattern, Branch, ErrorHandling, GatewayType, Mapping, PatternDef, ProcessSpec, Status, Step, StepKind } from './types';
import { feelIfPossible, importExpression } from './juelFeel.ts';
import { detectEngine } from './engineConvert.ts';
import { detectPatterns } from './patterns.ts';
import { STATUSES } from './types.ts';
import { nowIsoWithTimezone, slugify, todayIso } from './util.ts';

const BPMN_NS = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
const CAMUNDA_NS = 'http://camunda.org/schema/1.0/bpmn';
const ZEEBE_NS = 'http://camunda.org/schema/zeebe/1.0';

// Der Browser-DOMParser liefert `localName` ohne Prefix; einfachere
// XML-Parser (Node-Werkzeuge) lassen den Prefix stehen — beides abfangen.
const local = (el: Element): string => {
  const n = el.localName || el.tagName || '';
  const i = n.indexOf(':');
  return i >= 0 ? n.slice(i + 1) : n;
};
const kids = (el: Element) => Array.from(el.children);
const childrenNamed = (el: Element, name: string) => kids(el).filter(c => local(c) === name);
const firstNamed = (el: Element, name: string): Element | null =>
  kids(el).find(c => local(c) === name) ?? null;

// Attribut ohne Namespace-Gefrickel (Camunda-Attribute stehen im camunda-NS,
// bei manchen Exporten aber auch unqualifiziert)
function attr(el: Element, name: string): string | undefined {
  const ns = (uri: string) => {
    try { return el.getAttributeNS(uri, name); } catch { return null; }
  };
  return ns(CAMUNDA_NS)
    ?? ns(ZEEBE_NS)
    ?? el.getAttribute(`camunda:${name}`)
    ?? el.getAttribute(`zeebe:${name}`)
    ?? el.getAttribute(name)
    ?? undefined;
}

const text = (el: Element | null): string => (el?.textContent ?? '').trim();

// `name=""` kommt in gezeichneten Modellen oft vor und muss wie «kein Name»
// behandelt werden — sonst stehen leere Zeilen im Baum.
const nameOf = (el: Element): string => (el.getAttribute('name') ?? '').trim();

// alle Nachfahren mit diesem lokalen Namen (namespace-tolerant)
function elementsNamed(root: Element | null, name: string): Element[] {
  const out: Element[] = [];
  const visit = (el: Element) => {
    if (local(el) === name) out.push(el);
    for (const c of kids(el)) visit(c);
  };
  if (root) visit(root);
  return out;
}

// ── BPMN-Typ → Schritt-Art ───────────────────────────────────────────────────
const KIND_BY_TAG: Record<string, StepKind> = {
  startEvent: 'start',
  endEvent: 'end',
  serviceTask: 'service',
  userTask: 'user',
  sendTask: 'send',
  receiveTask: 'receive',
  businessRuleTask: 'rule',
  scriptTask: 'script',
  manualTask: 'manual',
  task: 'manual',
  callActivity: 'call',
  subProcess: 'subprocess',
  transaction: 'subprocess',
  adHocSubProcess: 'subprocess',
  exclusiveGateway: 'gateway',
  parallelGateway: 'gateway',
  inclusiveGateway: 'gateway',
  eventBasedGateway: 'gateway',
  complexGateway: 'gateway',
  intermediateCatchEvent: 'event',
  intermediateThrowEvent: 'event',
};

const GATEWAY_TYPE: Record<string, GatewayType> = {
  exclusiveGateway: 'exclusive',
  parallelGateway: 'parallel',
  inclusiveGateway: 'inclusive',
  eventBasedGateway: 'eventBased',
  complexGateway: 'inclusive',
};

const FLOW_NODE_TAGS = new Set(Object.keys(KIND_BY_TAG));

// ── Ereignis-Details ─────────────────────────────────────────────────────────
function eventKindOf(el: Element): Step['eventKind'] {
  for (const c of kids(el)) {
    const n = local(c);
    if (n.endsWith('EventDefinition')) {
      const base = n.replace('EventDefinition', '');
      if (base === 'timer') return 'timer';
      if (base === 'signal') return 'signal';
      if (base === 'message') return 'message';
      if (base === 'error') return 'error';
      if (base === 'escalation') return 'escalation';
    }
  }
  return 'none';
}

/** Name des Signals bzw. der Nachricht eines Ereignisses — über `signalRef` / `messageRef` */
function signalRefOf(el: Element, defs: Map<string, string>): string | undefined {
  for (const c of kids(el)) {
    const n = local(c);
    if (n !== 'signalEventDefinition' && n !== 'messageEventDefinition') continue;
    const ref = c.getAttribute('signalRef') ?? c.getAttribute('messageRef');
    if (ref && defs.has(ref)) return defs.get(ref);
  }
  return undefined;
}

function timerExpression(el: Element): string | undefined {
  for (const c of kids(el)) {
    if (local(c) === 'timerEventDefinition') {
      const v = kids(c).map(text).filter(Boolean)[0];
      if (v) return v;
    }
  }
  return undefined;
}

// `errorRef` zeigt auf ein <bpmn:error>; interessant ist dessen errorCode/name.
function errorCodeOf(el: Element, errors: Map<string, string>): string | undefined {
  for (const c of kids(el)) {
    if (!local(c).endsWith('EventDefinition')) continue;
    const ref = attr(c, 'errorRef');
    if (ref) return errors.get(ref) ?? ref;
    const v = attr(c, 'errorCodeVariable');
    if (v) return v;
  }
  return undefined;
}

// ── Ein-/Ausgaben ────────────────────────────────────────────────────────────
/** Ein fachlicher Parameterwert: Text wird JUEL → FEEL; Skript, Liste und Map bleiben beschreibend. */
function fachlich(p: Element): string {
  if (firstNamed(p, 'script') || firstNamed(p, 'list') || firstNamed(p, 'map')) return paramValue(p);
  return importExpression(text(p));
}

function paramValue(p: Element): string {
  const script = firstNamed(p, 'script');
  if (script) return `«${attr(script, 'scriptFormat') ?? 'script'}» ${text(script)}`;
  const list = firstNamed(p, 'list');
  if (list) return kids(list).map(text).join(', ');
  const map = firstNamed(p, 'map');
  if (map) return kids(map).map(e => `${attr(e, 'key') ?? ''}: ${text(e)}`).join(', ');
  return text(p);
}

/**
 * Der Mapping-Wert eines Parameters, so wie der Import ihn liest — für
 * `inputParameter`/`outputParameter`, `camunda:in`/`out` und `zeebe:input`/
 * `output`. Der Export vergleicht damit: was gleich geblieben ist, bleibt
 * im BPMN wörtlich stehen (samt Spin-Idiom, `#{…}` und Skript).
 */
export function paramExpression(p: Element): string {
  const n = local(p);
  if (n === 'inputParameter' || n === 'outputParameter') return fachlich(p);
  if (n === 'in' || n === 'out') {
    const plain = attr(p, 'source');
    return plain != null ? `= ${plain}` : importExpression(attr(p, 'sourceExpression') ?? '');
  }
  const source = attr(p, 'source') ?? '';
  return /^=/.test(source) ? `= ${source.slice(1).trim()}` : source;
}

// Technische Orchescala-Parameter — nicht Teil der fachlichen Spezifikation,
// aber für den Orchescala-Export relevant (deshalb separat gesammelt).
/** Steuerparameter, die kein fachliches Mapping sind — bleiben beim Schreiben stehen. */
export const TECHNICAL = new Set([
  '_handledErrors', '_regexHandledErrors', '_outputVariables', '_outputMock',
  '_outputServiceMock', '_manualOutMapping', '_servicesMocked', '_mockedWorkers',
  '_identityCorrelation', 'impersonateUserId',
]);

interface IoResult {
  inputs: Mapping[];
  outputs: Mapping[];
  technical: Mapping[];
  handledErrors: string[];
  mock?: string;
}

/** fester Text aus einer zeebe-Quelle: `="a, b"` → `a, b`; alles andere, wie es steht */
function feelText(source: string): string {
  const t = source.trim();
  const lit = /^=\s*"((?:[^"\\]|\\.)*)"$/.exec(t);
  return lit ? lit[1].replace(/\\(["\\])/g, '$1') : t;
}

function readIo(el: Element): IoResult {
  const res: IoResult = { inputs: [], outputs: [], technical: [], handledErrors: [] };
  const ext = firstNamed(el, 'extensionElements');
  if (!ext) return res;

  // callActivity: <camunda:in> / <camunda:out>
  for (const c of kids(ext)) {
    const n = local(c);
    if (n === 'in' || n === 'out') {
      const target = attr(c, 'target') ?? attr(c, 'targetVariable');
      const source = attr(c, 'source') ?? attr(c, 'sourceExpression');
      const business = attr(c, 'businessKey');
      if (business) { res.technical.push({ name: 'businessKey', expression: business }); continue; }
      if (!target) continue;
      // `source` ist ein Variablenname, `sourceExpression` ein JUEL-Ausdruck —
      // beides wird zu FEEL, der Sprache der Spezifikation
      const plain = attr(c, 'source');
      const expression = plain != null ? `= ${plain}` : importExpression(source ?? '');
      const m: Mapping = { name: target, expression };
      (TECHNICAL.has(target) || TECHNICAL.has(source ?? '') ? res.technical : n === 'in' ? res.inputs : res.outputs).push(m);
    }
  }

  // Camunda 8: <zeebe:ioMapping><zeebe:input source="=…" target="x"/> — die
  // Quelle ist FEEL (`=…`) oder ein fester Text, das Ziel die Variable.
  const zio = firstNamed(ext, 'ioMapping');
  if (zio) {
    for (const p of childrenNamed(zio, 'input')) {
      const target = attr(p, 'target') ?? '';
      if (!target) continue;
      const source = attr(p, 'source') ?? '';
      // Steuerparameter wie in Camunda 7: behandelte Fehler und Mock am Schritt
      if (target === '_handledErrors' || target === '_regexHandledErrors') {
        res.handledErrors.push(...feelText(source).split(',').map(s => s.trim()).filter(Boolean));
        continue;
      }
      if (target === '_outputMock' || target === '_outputServiceMock') { res.mock = source; continue; }
      const m: Mapping = { name: target, expression: /^=/.test(source) ? `= ${source.slice(1).trim()}` : source };
      (TECHNICAL.has(target) ? res.technical : res.inputs).push(m);
    }
    for (const p of childrenNamed(zio, 'output')) {
      const target = attr(p, 'target') ?? '';
      if (!target) continue;
      const source = attr(p, 'source') ?? '';
      const m: Mapping = { name: target, expression: /^=/.test(source) ? `= ${source.slice(1).trim()}` : source };
      (TECHNICAL.has(target) ? res.technical : res.outputs).push(m);
    }
  }

  const io = firstNamed(ext, 'inputOutput');
  if (io) {
    for (const p of childrenNamed(io, 'inputParameter')) {
      const name = attr(p, 'name') ?? '';
      const value = paramValue(p);
      if (name === '_handledErrors' || name === '_regexHandledErrors') {
        res.handledErrors.push(...value.split(',').map(s => s.trim()).filter(Boolean));
        continue;
      }
      if (name === '_outputMock' || name === '_outputServiceMock') { res.mock = value; continue; }
      (TECHNICAL.has(name) ? res.technical : res.inputs).push({ name, expression: TECHNICAL.has(name) ? value : fachlich(p) });
    }
    for (const p of childrenNamed(io, 'outputParameter')) {
      const name = attr(p, 'name') ?? '';
      (TECHNICAL.has(name) ? res.technical : res.outputs).push({ name, expression: TECHNICAL.has(name) ? paramValue(p) : fachlich(p) });
    }
  }
  return res;
}

// ── Graph eines Scopes (Prozess oder Subprozess) ─────────────────────────────
interface Flow { id: string; source: string; target: string; name?: string; condition?: string }

interface Scope {
  nodes: Map<string, Element>;
  out: Map<string, Flow[]>;
  inCount: Map<string, number>;
  boundaries: Map<string, Element[]>;   // attachedToRef → Boundary-Events
  boundaryOut: Map<string, Flow[]>;     // Boundary-Event-ID → ausgehende Flows
  /** fangende Ereignisse, die nur ein werfendes fortsetzen (kein eigener Schritt) */
  linkedCatch: Set<string>;
  starts: string[];
}

function readScope(container: Element): Scope {
  const nodes = new Map<string, Element>();
  const out = new Map<string, Flow[]>();
  const inCount = new Map<string, number>();
  const boundaries = new Map<string, Element[]>();
  const boundaryOut = new Map<string, Flow[]>();
  const linkedCatch = new Set<string>();
  const starts: string[] = [];
  const boundaryIds = new Set<string>();

  for (const el of kids(container)) {
    const tag = local(el);
    const id = el.getAttribute('id');
    if (!id) continue;
    if (tag === 'boundaryEvent') {
      const to = el.getAttribute('attachedToRef');
      boundaryIds.add(id);
      if (to) boundaries.set(to, [...(boundaries.get(to) ?? []), el]);
      continue;
    }
    if (tag === 'sequenceFlow') continue;
    if (!FLOW_NODE_TAGS.has(tag)) continue;
    nodes.set(id, el);
    if (tag === 'startEvent') starts.push(id);
  }

  for (const el of childrenNamed(container, 'sequenceFlow')) {
    const source = el.getAttribute('sourceRef') ?? '';
    const target = el.getAttribute('targetRef') ?? '';
    if (!nodes.has(source) || !nodes.has(target)) continue; // z. B. von Boundary-Events
    const f: Flow = {
      id: el.getAttribute('id') ?? '',
      source, target,
      name: nameOf(el) || undefined,
      condition: importExpression(text(firstNamed(el, 'conditionExpression'))) || undefined,
    };
    out.set(source, [...(out.get(source) ?? []), f]);
    inCount.set(target, (inCount.get(target) ?? 0) + 1);
  }

  // Flows ab einem Boundary-Event beginnen einen eigenen Pfad (Fehlerbehandlung)
  for (const el of childrenNamed(container, 'sequenceFlow')) {
    const source = el.getAttribute('sourceRef') ?? '';
    if (!boundaryIds.has(source)) continue;
    const target = el.getAttribute('targetRef') ?? '';
    if (!nodes.has(target)) continue;
    const f: Flow = { id: el.getAttribute('id') ?? '', source, target, name: nameOf(el) || undefined };
    boundaryOut.set(source, [...(boundaryOut.get(source) ?? []), f]);
  }

  // Orchescala-Muster: ein **werfendes** Zwischenereignis ohne Ausgang wird von
  // dem gleichnamigen **fangenden** Zwischenereignis ohne Eingang fortgesetzt
  // (kein eventDefinition, die Paarung läuft über den Namen). Ohne diese Kante
  // brechen Pfade wie «output-mocked» oder «send Process Event» mittendrin ab.
  const catchByName = new Map<string, string>();
  for (const [id, el] of nodes) {
    if (local(el) !== 'intermediateCatchEvent' || inCount.get(id)) continue;
    const n = nameOf(el);
    if (n && !catchByName.has(n)) catchByName.set(n, id);
  }
  for (const [id, el] of nodes) {
    if (local(el) !== 'intermediateThrowEvent' || (out.get(id) ?? []).length) continue;
    const target = catchByName.get(nameOf(el));
    if (!target || target === id) continue;
    out.set(id, [{ id: `${id}__link`, source: id, target }]);
    inCount.set(target, (inCount.get(target) ?? 0) + 1);
    linkedCatch.add(target);
  }

  if (!starts.length && nodes.size) {
    // kein Start-Event: Knoten ohne eingehende Kante nehmen
    for (const id of nodes.keys()) if (!inCount.get(id)) starts.push(id);
  }
  return { nodes, out, inCount, boundaries, boundaryOut, linkedCatch, starts };
}

// Zusammenführung eines Splits finden.
//
// Gesucht ist nicht irgendein gemeinsam erreichbarer Knoten, sondern der
// nächste, den **jeder** Pfad ab dem Gateway passieren muss (Post-Dominator).
// Nur so bleibt der Zweig genau der Block bis zur Zusammenführung — sonst
// steht der halbe Prozess in jedem Zweig.
function postDominates(scope: Scope, splitId: string, m: string, stops: Set<string>): boolean {
  const seen = new Set<string>();
  const stack = (scope.out.get(splitId) ?? []).map(f => f.target);
  while (stack.length) {
    const id = stack.pop()!;
    if (id === m || id === splitId || seen.has(id)) continue; // Ziel bzw. Schleife
    seen.add(id);
    if (stops.has(id)) return false;              // Block verlassen, ohne m
    const outs = scope.out.get(id) ?? [];
    if (!outs.length) return false;               // Ende erreicht, ohne m
    for (const f of outs) stack.push(f.target);
  }
  return true;
}

function findMerge(scope: Scope, splitId: string, stops: Set<string> = new Set()): string | null {
  const branchTargets = (scope.out.get(splitId) ?? []).map(f => f.target);
  if (branchTargets.length < 2) return null;

  // je Zweig die erreichbaren Knoten, in Breitensuche-Reihenfolge (nah zuerst)
  const reach = branchTargets.map(t => {
    const seen = new Set<string>();
    const order: string[] = [];
    const queue = [t];
    while (queue.length) {
      const id = queue.shift()!;
      if (id === splitId || seen.has(id)) continue;
      seen.add(id);
      order.push(id);
      for (const f of scope.out.get(id) ?? []) queue.push(f.target);
    }
    return { seen, order };
  });

  for (const id of reach[0].order) {
    if (!reach.every(r => r.seen.has(id))) continue;
    if (postDominates(scope, splitId, id, stops)) return id;
  }
  // Kein gemeinsamer Punkt (z. B. Zweige enden je in einem eigenen Ende):
  // dann endet der Zweig am nächsten Stopp des umschliessenden Blocks.
  for (const id of reach[0].order) if (stops.has(id)) return id;
  return null;
}

// ── Struktur aufbauen ────────────────────────────────────────────────────────
interface BuildCtx {
  doc: Document;
  /** Prozess-ID — der Schritt mit diesem Topic ist der Init-Worker */
  processId: string;
  /** Ausgaben des Init-Workers, der nicht als Schritt erscheint */
  initOutputs: Mapping[];
  byId: Map<string, Step>;
  order: string[];
  /** <bpmn:error> id → errorCode bzw. name */
  errors: Map<string, string>;
  /** <bpmn:signal> / <bpmn:message> id → name */
  signals: Map<string, string>;
  /** alle Knoten aller Ebenen — für die Meldung «nicht erreichbar» */
  allNodes: Map<string, string>;
  /** Element-ID → Pattern, zu dem es gehört (Pfade und Blöcke eines Patterns) */
  owned: Map<string, string>;
  /** Knoten → einziger Nachfolger (löst entfernte Zusammenführungen auf) */
  succ: Map<string, string>;
}

function branchLabel(f: Flow, isDefault: boolean, index: number): string {
  if (f.name) return f.name;
  if (isDefault) return 'sonst';
  if (f.condition) return f.condition.replace(/^=\s*/, '').replace(/^\$\{|\}$/g, '');
  return `Pfad ${index + 1}`;
}

// Nicht verbundene Blöcke anhängen.
//
// Ereignis-Subprozesse und die Ziele von Link-Ereignissen, deren Gegenstück
// nicht über den Namen zu erkennen war, hängen an keinem Sequenzfluss. Sie
// gehören trotzdem zum Prozess — sie kommen als eigene Blöcke ans Ende, statt
// stillschweigend zu verschwinden.
function appendOrphans(ctx: BuildCtx, scope: Scope, steps: Step[]) {
  for (let guard = 0; guard < 50; guard++) {
    const missing = [...scope.nodes.keys()].filter(id => !ctx.byId.has(id));
    if (!missing.length) return;
    // bevorzugt echte Einstiegspunkte (ohne eingehende Kante), sonst irgendeinen
    const roots = missing.filter(id => !scope.inCount.get(id));
    const before = ctx.byId.size;
    for (const id of roots.length ? roots : [missing[0]]) {
      if (ctx.byId.has(id)) continue;
      const block = walk(ctx, scope, id, new Set(), new Set());
      if (block[0]) block[0].orphan = true;
      steps.push(...block);
    }
    if (ctx.byId.size === before) return; // kein Fortschritt — abbrechen
  }
}

function register(ctx: BuildCtx, scope: Scope) {
  for (const [id, el] of scope.nodes) {
    ctx.allNodes.set(id, nameOf(el) || id);
    const flows = scope.out.get(id) ?? [];
    if (flows.length === 1) ctx.succ.set(id, flows[0].target);
  }
}

function buildStep(ctx: BuildCtx, scope: Scope, el: Element, path: Set<string>): Step {
  const tag = local(el);
  const id = el.getAttribute('id')!;
  const kind = KIND_BY_TAG[tag] ?? 'manual';
  const io = readIo(el);
  const step: Step = {
    id,
    kind,
    name: nameOf(el) || defaultName(tag, id),
    status: 'implemented', // aus der Implementation gelesen
  };
  // früh registrieren: Rücksprünge aus Fehlerpfaden markieren die Schleife hier
  ctx.byId.set(id, step);
  ctx.order.push(id);

  if (kind === 'gateway') step.gatewayType = GATEWAY_TYPE[tag] ?? 'exclusive';
  if (kind === 'event') {
    step.eventKind = eventKindOf(el);
    step.eventDirection = tag === 'intermediateThrowEvent' ? 'throw' : 'catch';
    const ref = signalRefOf(el, ctx.signals);
    if (ref) step.messageName = ref;
    const timer = timerExpression(el);
    if (timer) step.notes = `Timer: ${timer}`;
  }
  if (kind === 'start' || kind === 'end') {
    const ev = eventKindOf(el);
    if (ev !== 'none') step.eventKind = ev;
    const ref = signalRefOf(el, ctx.signals);
    if (ref) step.messageName = ref;
  }
  if (kind === 'receive' || kind === 'send') {
    const ref = el.getAttribute('messageRef');
    const name = ref ? ctx.signals.get(ref) : undefined;
    if (name) step.messageName = name;
  }

  const ext = firstNamed(el, 'extensionElements');
  // Benutzeraufgabe: wer sie bearbeiten darf
  // (Camunda 7 am Element, Camunda 8 in zeebe:assignmentDefinition)
  if (kind === 'user') {
    const assign = ext ? firstNamed(ext, 'assignmentDefinition') : null;
    const groups = attr(el, 'candidateGroups') ?? (assign ? attr(assign, 'candidateGroups') : undefined);
    if (groups) step.candidateGroups = groups;
    const assignee = attr(el, 'assignee') ?? (assign ? attr(assign, 'assignee') : undefined);
    if (assignee) step.assignee = assignee;
  }

  const template = attr(el, 'modelerTemplate');
  if (template) step.serviceId = template;
  // Camunda 7: camunda:topic am Element; Camunda 8: zeebe:taskDefinition type="…"
  const taskDef = ext ? firstNamed(ext, 'taskDefinition') : null;
  const topic = attr(el, 'topic') ?? (taskDef ? attr(taskDef, 'type') : undefined);
  if (topic) step.topic = topic;
  // Entscheidung: die Decision Reference ist der Schlüssel in den DMN-Katalog
  // (Camunda 7 am Element, Camunda 8 in zeebe:calledDecision)
  const calledDecision = ext ? firstNamed(ext, 'calledDecision') : null;
  const decisionRef = attr(el, 'decisionRef') ?? (calledDecision ? attr(calledDecision, 'decisionId') : undefined);
  if (decisionRef && !step.topic) step.topic = decisionRef;
  // Camunda 7: calledElement am Element; Camunda 8: zeebe:calledElement processId="…"
  const calledEl = ext ? firstNamed(ext, 'calledElement') : null;
  const called = el.getAttribute('calledElement') ?? (calledEl ? attr(calledEl, 'processId') : undefined);
  if (called) step.calledProcess = called;

  const mi = firstNamed(el, 'multiInstanceLoopCharacteristics');
  if (mi) {
    // Camunda 7: collection / elementVariable am Element; Camunda 8: zeebe:loopCharacteristics
    const lc = firstNamed(mi, 'extensionElements');
    const zb = lc ? firstNamed(lc, 'loopCharacteristics') : null;
    const coll = (zb ? attr(zb, 'inputCollection') : undefined) ?? attr(mi, 'collection');
    const elem = (zb ? attr(zb, 'inputElement') : undefined) ?? attr(mi, 'elementVariable');
    const imported = coll ? importExpression(coll) : '';
    const collection = imported.startsWith('=') ? imported.slice(1).trim() : imported || undefined;
    step.multiInstance = {
      ...(collection ? { collection } : {}),
      ...(elem?.trim() ? { element: elem.trim() } : {}),
      ...(mi.getAttribute('isSequential') === 'true' ? { sequential: true } : {}),
    };
  }

  if (io.inputs.length) step.inputs = io.inputs;
  if (io.outputs.length) step.outputs = io.outputs;
  if (io.mock) step.mock = io.mock;

  if (kind === 'subprocess') {
    if (el.getAttribute('triggeredByEvent') === 'true') step.eventSubprocess = true;
    const inner = readScope(el);
    register(ctx, inner);
    const children = walk(ctx, inner, inner.starts[0] ?? null, new Set(), new Set());
    appendOrphans(ctx, inner, children);
    step.children = children;
  }

  // Fehlerbehandlung: `_handledErrors` plus die Pfade der Boundary-Events
  const errors: ErrorHandling[] = io.handledErrors.map(code => ({ code, declared: true }));
  for (const b of scope.boundaries.get(id) ?? []) {
    const bid = b.getAttribute('id') ?? '';
    const interrupting = b.getAttribute('cancelActivity') !== 'false';
    // Pfad ab dem Boundary-Event. Der angehängte Schritt gilt dabei als
    // «Vorgänger»: führt der Pfad dorthin zurück, ist das eine Wiederholung
    // (Retry) und keine Zusammenführung.
    const flows = scope.boundaryOut.get(bid) ?? [];
    const steps = flows.length
      ? walk(ctx, scope, flows[0].target, new Set(), new Set([...path, id]), id)
      : undefined;
    // Ohne Namen und ohne Fehlerbezug ist es kein Fehlerfall, sondern ein
    // Nebenpfad — dann beschriftet ihn sein erster Schritt statt der Element-ID.
    const named = nameOf(b) || errorCodeOf(b, ctx.errors);
    const side = !named;
    const code = named || steps?.[0]?.name || bid;
    if (!code) continue;
    const existing = errors.find(e => e.code === code);
    const pattern = ctx.owned.get(bid);
    if (existing) {
      existing.interrupting = interrupting;
      existing.boundary = true;
      if (side) existing.side = true;
      if (pattern) existing.pattern = pattern;
      if (steps?.length) existing.steps = steps;
    } else {
      errors.push({ code, interrupting, boundary: true, ...(side ? { side: true } : {}), ...(pattern ? { pattern } : {}), ...(steps?.length ? { steps } : {}) });
    }
  }
  if (errors.length) step.errors = errors;

  return step;
}

const JOIN_NAME = '\u0000join';

function defaultName(tag: string, id: string): string {
  // Namenlose Gateways sind fast immer Zusammenführungen — sie tragen keine
  // Information und werden nach dem Aufbau entfernt (siehe pruneJoins).
  if (tag.endsWith('Gateway')) return JOIN_NAME;
  if (tag === 'startEvent') return 'Start';
  if (tag === 'endEvent') return 'Ende';
  return id;
}

// Namenlose Zusammenführungen entfernen — sie tragen keine Information.
// Ausnahme: der Einstieg einer Schleife, der heisst «Wiederholung ab hier».
// Verweise, die auf eine entfernte Zusammenführung zeigten, wandern auf den
// nächsten echten Schritt weiter («weiter bei ‹has Account Iban?›»).
function pruneJoins(steps: Step[], pruned: Set<string>): Step[] {
  const out: Step[] = [];
  for (const s of steps) {
    if (s.children) s.children = pruneJoins(s.children, pruned);
    for (const b of s.branches ?? []) b.steps = pruneJoins(b.steps, pruned);
    for (const e of s.errors ?? []) if (e.steps) e.steps = pruneJoins(e.steps, pruned);
    if (s.kind === 'gateway' && s.name === JOIN_NAME && !s.branches?.length && !s.loop) {
      pruned.add(s.id);
      continue;
    }
    if (s.name === JOIN_NAME) {
      s.name = s.branches?.length
        ? (s.gatewayType === 'parallel' ? 'Parallel — alle Pfade' : 'Verzweigung')
        : s.loop ? 'Wiederholung ab hier' : 'Zusammenführung';
    }
    out.push(s);
  }
  return out;
}

// Verweise auflösen: entfernte Zusammenführungen überspringen, Namen nachziehen.
// Landet ein Verweis nirgends mehr, fällt er weg (der Pfad endet dort schlicht).
function fixGotos(steps: Step[], ctx: BuildCtx, pruned: Set<string>): Step[] {
  const out: Step[] = [];
  for (const s of steps) {
    if (s.children) s.children = fixGotos(s.children, ctx, pruned);
    for (const b of s.branches ?? []) b.steps = fixGotos(b.steps, ctx, pruned);
    for (const e of s.errors ?? []) if (e.steps) e.steps = fixGotos(e.steps, ctx, pruned);
    if (s.kind === 'goto' && s.gotoId) {
      let id: string | undefined = s.gotoId;
      const seen = new Set<string>();
      while (id && pruned.has(id) && !seen.has(id)) { seen.add(id); id = ctx.succ.get(id); }
      const target = id ? ctx.byId.get(id) : undefined;
      if (!id || !target) continue;
      s.gotoId = id;
      s.name = target.name;
    }
    out.push(s);
  }
  return out;
}

// Läuft den Graph von `startId` ab und liefert den Block als Baum.
// `stops` = Knoten, an denen dieser Block endet (die eigene Zusammenführung und
// die aller umschliessenden Verzweigungen — ohne das laufen Zweige über ihre
// Zusammenführung hinaus und der Rest des Prozesses wird vervielfacht).
// `path` = Kette der offenen Knoten; ein Treffer darin ist eine Schleife.
// Erreichbarkeit inkl. der Pfade ab Boundary-Events — sonst wird der Retry
// («Fehler → warten → nochmal») nicht als Schleife erkannt.
function canReach(scope: Scope, from: string, to: string): boolean {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === to) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const f of scope.out.get(id) ?? []) stack.push(f.target);
    for (const b of scope.boundaries.get(id) ?? []) {
      const bid = b.getAttribute('id') ?? '';
      for (const f of scope.boundaryOut.get(bid) ?? []) stack.push(f.target);
    }
  }
  return false;
}

// Hinweise für die Beschriftung einer Schleife (Sparkonto-Muster: ein Timer-Ereignis
// «wait ${timer}» und ein Gateway «Tried ${max} times?»)
interface LoopHint { cond?: string; wait?: string }
const MAX_RE = /\$\{([^}]+)\}/;

function walk(ctx: BuildCtx, scope: Scope, startId: string | null, stops: Set<string>, path: Set<string>,
              prev: string | null = null, hint: LoopHint = {}): Step[] {
  const out: Step[] = [];
  let cur = startId;
  const localSeen = new Set<string>();

  while (cur && !stops.has(cur)) {
    const known = ctx.byId.get(cur);
    if (known) {
      // Schon gezeigt: Rücksprung (Schleife) oder Zusammenlauf zweier Pfade.
      // Beides als Verweis — so bleibt der Baum frei von Dubletten.
      // Rücksprung heisst: von dort führt ein Weg wieder hierher.
      const back = path.has(cur) || localSeen.has(cur) || (!!prev && canReach(scope, cur, prev));
      out.push({
        id: `${cur}__${back ? 'loop' : 'join'}__${out.length}`,
        kind: 'goto', name: known.name, status: known.status,
        gotoId: cur, ...(back ? { back: true } : {}),
      });
      if (back && !known.loop) {
        known.loop = {
          condition: hint.cond ?? 'Wiederholung',
          ...(hint.cond && MAX_RE.test(hint.cond) ? { maxAttempts: MAX_RE.exec(hint.cond)![0] } : {}),
          ...(hint.wait ? { waitFor: hint.wait } : {}),
        };
      }
      break;
    }
    const el = scope.nodes.get(cur);
    if (!el) break;
    localSeen.add(cur);

    const flows = scope.out.get(cur) ?? [];
    if (flows.length > 1) {
      const nextPath = new Set([...path, cur]);
      const step = buildStep(ctx, scope, el, nextPath);
      const merge = findMerge(scope, cur, stops);
      const branchStops = new Set(stops);
      if (merge) branchStops.add(merge);
      const defaultFlow = attr(el, 'default') ?? el.getAttribute('default');
      // Ein Gateway wie «Tried ${max} times?» beschriftet die Schleife dahinter
      const branchHint: LoopHint = /tried|versuch|retry|nochmal|max/i.test(step.name)
        ? { ...hint, cond: step.name } : { ...hint };
      step.branches = flows.map((f, i) => ({
        id: f.id || `${cur}-${f.target}`,
        label: branchLabel(f, f.id === defaultFlow, i),
        ...(f.condition ? { condition: f.condition } : {}),
        ...(f.id === defaultFlow ? { isDefault: true } : {}),
        steps: walk(ctx, scope, f.target, branchStops, nextPath, cur, { ...branchHint }),
      }));
      out.push(step);
      prev = cur;
      cur = merge;
      continue;
    }

    const step = buildStep(ctx, scope, el, path);
    if (step.kind === 'event' && step.eventKind === 'timer') hint.wait = step.name;
    // Der Init-Worker (sein Topic ist der Prozess selbst): seine Ausgaben sind
    // die Felder des `InitIn` und werden hier eingesammelt. Er bleibt ein
    // Schritt — im Diagramm wählbar, das Pattern «Init Process» hängt an ihm;
    // eine Interaktion oder ein Mock-Feld wird er nicht (interactions.ts).
    if (isInitWorker(step, ctx.processId)) ctx.initOutputs = step.outputs ?? [];
    // Das fangende Gegenstück eines werfenden Ereignisses ist reine Verdrahtung
    // — es trägt denselben Namen und keine eigene Aussage.
    if (!scope.linkedCatch.has(cur)) out.push(step);
    prev = cur;
    cur = flows[0]?.target ?? null;
  }
  return out;
}

// ── Öffentliche API ──────────────────────────────────────────────────────────
export interface ImportResult {
  spec: ProcessSpec;
  /** Anzahl Schritte im Baum (ohne goto) */
  stepCount: number;
  /** im BPMN gefundene, aber nicht erreichbare Knoten */
  unreachable: string[];
}

export interface ImportOptions {
  /** Pattern aus dem Admin — erkannte stehen am Schritt bzw. am Prozess */
  patterns?: PatternDef[];
}

/** Der Init-Worker: ein Service-Task mit dem Prozess selbst als Topic */
export const isInitWorker = (step: Step, processId: string | undefined): boolean =>
  step.kind === 'service' && !!processId && step.topic === processId;

export function importBpmn(xml: string, fileName = 'prozess.bpmn', opts: ImportOptions = {}): ImportResult {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  try {
    if (doc.querySelector?.('parsererror')) throw new Error('BPMN-Datei ist kein gültiges XML.');
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('BPMN-Datei')) throw e;
  }

  const all = elementsNamed(doc.documentElement, 'process');
  const proc = all.find(p => readScope(p).nodes.size > 0);
  if (!proc) throw new Error('Kein Prozess mit Elementen in der BPMN-Datei gefunden.');

  const processId = proc.getAttribute('id') ?? '';
  const scope = readScope(proc);
  const errorDefs = new Map<string, string>();
  for (const e of elementsNamed(doc.documentElement, 'error')) {
    const id = e.getAttribute('id');
    const code = e.getAttribute('errorCode') || e.getAttribute('name');
    if (id && code) errorDefs.set(id, code);
  }
  const signalDefs = new Map<string, string>();
  for (const tag of ['signal', 'message']) {
    for (const e of elementsNamed(doc.documentElement, tag)) {
      const id = e.getAttribute('id');
      const name = e.getAttribute('name');
      if (id && name) signalDefs.set(id, name);
    }
  }
  // Camunda 8 erkennt man am zeebe-Namensraum bzw. der Modeler-Angabe
  const engine = detectEngine(xml);
  // Pattern zuerst: was zu einem gehört, wird im Baum als Pattern gezeigt
  const detected = detectPatterns(doc, opts.patterns, engine);
  const ctx: BuildCtx = {
    doc, processId, initOutputs: [],
    byId: new Map(), order: [], errors: errorDefs, signals: signalDefs, allNodes: new Map(), succ: new Map(),
    owned: detected.owned,
  };
  register(ctx, scope);
  let steps = walk(ctx, scope, scope.starts[0] ?? null, new Set(), new Set());
  appendOrphans(ctx, scope, steps);
  const pruned = new Set<string>();
  steps = pruneJoins(steps, pruned);
  steps = fixGotos(steps, ctx, pruned);
  markPatterns(steps, detected.hits, detected.owned);

  const processPatterns: AppliedPattern[] = detected.hits.filter(h => !h.targetId)
    .map(h => ({ id: h.patternId, ...(Object.keys(h.params).length ? { params: h.params } : {}) }));

  const unreachable = [...ctx.allNodes.entries()]
    .filter(([id]) => !ctx.byId.has(id) && !ctx.order.includes(id))
    .map(([id, name]) => `${name} (${id})`);

  // Prozessname/Projekt aus der ID ableiten: `globex-savings-openSavingsV1`
  const m = /^(.*?)-([A-Za-z][A-Za-z0-9]*V\d+)$/.exec(processId);
  const project = m?.[1] ?? processId.split('-').slice(0, 2).join('-');
  const name = m?.[2] || nameOf(proc) || fileName.replace(/\.bpmn$/i, '');

  const spec: ProcessSpec = {
    version: 1,
    slug: slugify(processId || name),
    name,
    title: nameOf(proc) || name,
    processId,
    project,
    engine,
    status: 'implemented',
    description: '',
    createdAt: todayIso(),
    updatedAt: nowIsoWithTimezone(),
    variables: [],
    ...(attr(proc, 'historyTimeToLive') ? { timeToLive: attr(proc, 'historyTimeToLive') } : {}),
    ...(ctx.initOutputs.length ? { initOutputs: ctx.initOutputs } : {}),
    ...(processPatterns.length ? { patterns: processPatterns } : {}),
    steps,
  };
  return { spec, stepCount: ctx.byId.size, unreachable };
}

/** Erkannte Pattern an die Schritte schreiben; Schritte eines Pattern-Blocks markieren */
function markPatterns(steps: Step[], hits: Array<{ patternId: string; targetId: string | null; params: Record<string, string> }>, owned: Map<string, string>) {
  const at = new Map<string, AppliedPattern[]>();
  for (const h of hits) {
    if (!h.targetId) continue;
    at.set(h.targetId, [...(at.get(h.targetId) ?? []), { id: h.patternId, ...(Object.keys(h.params).length ? { params: h.params } : {}) }]);
  }
  for (const s of allSteps(steps)) {
    const ps = at.get(s.id);
    if (ps) s.patterns = ps;
    const own = owned.get(s.id);
    if (own) s.pattern = own;
  }
}

// ── Erneuter Import: fachliche Texte behalten ────────────────────────────────
// Struktur kommt aus der Implementation, Prosa aus der Spezifikation. Schritte,
// die es nicht mehr gibt, verschwinden; neue kommen als «Entwurf» dazu;
// geänderte (anderer Service/Topic/Mapping) werden auf «Angepasst» gesetzt.
export interface MergeReport {
  added: string[];
  removed: string[];
  changed: string[];
  /** nur umbenannt — «alt → neu» */
  renamed: string[];
  kept: number;
}

// Was die Spezifikation festlegt, überlebt den Abgleich mit dem BPMN.
const KEEP_KEYS = ['description', 'notes', 'open', 'candidateGroups', 'assignee', 'inVariant', 'outVariant'] as const;

function indexSteps(steps: Step[] | undefined, into: Map<string, Step>): Map<string, Step> {
  for (const s of steps ?? []) {
    into.set(s.id, s);
    indexSteps(s.children, into);
    for (const b of s.branches ?? []) indexSteps(b.steps, into);
    for (const e of s.errors ?? []) indexSteps(e.steps, into);
  }
  return into;
}

// Der technische Vertrag eines Schritts. **Ohne Namen**: ein Umbenennen ist
// keine Änderung der Implementation, sondern dieselbe Sache anders beschriftet
// — es wird separat gemeldet (`renamed`), setzt den Status aber nicht zurück.
function sig(s: Step): string {
  return JSON.stringify([s.kind, s.serviceId ?? '', s.topic ?? '', s.calledProcess ?? '',
    (s.inputs ?? []).map(i => `${i.name}=${i.expression}`),
    (s.outputs ?? []).map(o => `${o.name}=${o.expression}`)]);
}

/**
 * Was die Spezifikation am Schritt einstellt — Service, Topic, gerufener
 * Prozess, Mappings, Mock. Ins BPMN kommt das erst beim Export; bis dahin
 * steht im Diagramm der alte Stand. Ein Abgleich darf es darum nur ersetzen,
 * wo das **Diagramm selbst** es geändert hat (Drei-Wege-Abgleich gegen das
 * vorige BPMN) — sonst gingen Einstellungen verloren, sobald jemand im
 * Diagramm etwas verschiebt oder die App es angleicht.
 */
const SPEC_OWNED = ['serviceId', 'topic', 'calledProcess', 'inputs', 'outputs', 'mock'] as const;

/** Ein Wert unabhängig von seiner Engine-Form: `${x}` wie `=x`, `text` wie `="text"` */
function normExpr(e: string): string {
  const f = feelIfPossible(e.trim());
  const lit = /^=\s*"((?:[^"\\]|\\.)*)"$/.exec(f);
  if (lit) return lit[1].replace(/\\(["\\])/g, '$1');
  return f.startsWith('=') ? `= ${f.slice(1).trim()}` : f;
}

const norm = (k: string, v: unknown): unknown =>
  k === 'mock' && typeof v === 'string' ? normExpr(v)
    : (k === 'inputs' || k === 'outputs') && Array.isArray(v) ? (v as Mapping[]).map(m => [m.name, normExpr(m.expression)])
      : v;

/** hat das Diagramm dasselbe — gleich bis auf die Schreibweise der Engine? */
const same = (k: string, a: unknown, b: unknown): boolean =>
  JSON.stringify(norm(k, a) ?? null) === JSON.stringify(norm(k, b) ?? null);

function keepSpecOwned(s: Step, prev: Step, base: Step | undefined) {
  for (const k of SPEC_OWNED) {
    // ohne voriges BPMN: nur nicht verlieren, was das Diagramm nicht kennt
    const diagramUnchanged = base ? same(k, s[k], base[k]) : s[k] == null || same(k, s[k], []);
    if (!diagramUnchanged) continue;
    if (prev[k] === undefined) delete s[k];
    else (s as Record<string, unknown>)[k] = prev[k];
  }
}

function applyOld(steps: Step[], old: Map<string, Step>, report: MergeReport, seen: Set<string>, base: Map<string, Step> | null) {
  for (const s of steps) {
    seen.add(s.id);
    const prev = old.get(s.id);
    if (!prev) {
      if (s.kind !== 'goto') report.added.push(s.name);
      s.status = 'draft';
    } else {
      keepSpecOwned(s, prev, base?.get(s.id));
      for (const k of KEEP_KEYS) if (prev[k] != null && prev[k] !== '') s[k] = prev[k];
      // Fachliche Bedeutung und Abwahl der Mappings gehören der Spezifikation
      for (const list of ['inputs', 'outputs'] as const) {
        const before = new Map((prev[list] ?? []).map(m => [m.name, m]));
        for (const m of s[list] ?? []) {
          const p = before.get(m.name);
          if (p?.description) m.description = p.description;
          if (p?.disabled) m.disabled = true;
        }
      }
      // Status gehört der Spezifikation: er bleibt, wie er gesetzt wurde.
      // Nur wenn sich technisch etwas geändert hat, springt er auf «Angepasst»
      // — das ist genau das Signal, das jemand prüfen muss.
      if (prev.name !== s.name && s.kind !== 'goto') report.renamed.push(`${prev.name} → ${s.name}`);
      const changed = sig(prev) !== sig(s);
      if (changed && s.kind !== 'goto') report.changed.push(s.name);
      s.status = changed ? 'changed' : prev.status;
      report.kept++;
    }
    if (s.children) applyOld(s.children, old, report, seen, base);
    for (const b of s.branches ?? []) applyOld(b.steps, old, report, seen, base);
    // Fehler- und Nebenpfade gehören dazu — sonst gehen ihre fachlichen Texte
    // beim erneuten Import verloren und sie gelten fälschlich als entfallen.
    for (const e of s.errors ?? []) if (e.steps) applyOld(e.steps, old, report, seen, base);
  }
}

/**
 * Das neu eingelesene BPMN (`fresh`) mit der Spezifikation (`previous`)
 * zusammenführen. `base` ist der Import des **vorigen** BPMN: was das
 * Diagramm gegenüber ihm nicht geändert hat, bleibt, wie es in der
 * Spezifikation steht (siehe `SPEC_OWNED`).
 */
export function mergeSpec(fresh: ProcessSpec, previous: ProcessSpec, base: ProcessSpec | null = null): { spec: ProcessSpec; report: MergeReport } {
  const old = indexSteps(previous.steps, new Map());
  const report: MergeReport = { added: [], removed: [], changed: [], renamed: [], kept: 0 };
  const seen = new Set<string>();
  applyOld(fresh.steps, old, report, seen, base ? indexSteps(base.steps, new Map()) : null);
  for (const [id, s] of old) if (!seen.has(id) && s.kind !== 'goto') report.removed.push(s.name || id);

  const spec: ProcessSpec = {
    ...previous,
    ...fresh,
    slug: previous.slug,
    title: previous.title || fresh.title,
    description: previous.description ?? '',
    sourceUrl: previous.sourceUrl,
    variables: previous.variables ?? [],
    ...(fresh.initOutputs?.length ? { initOutputs: fresh.initOutputs } : {}),
    // Pattern am Prozess kommen aus dem BPMN — wie die Struktur
    patterns: fresh.patterns,
    timeToLive: previous.timeToLive ?? fresh.timeToLive,
    status: previous.status === 'draft' ? 'draft' : (report.added.length || report.changed.length || report.removed.length ? 'changed' : previous.status),
    createdAt: previous.createdAt,
    updatedAt: nowIsoWithTimezone(),
  };
  return { spec, report };
}

// ── Hilfen für die Oberfläche ────────────────────────────────────────────────
const EVENT_LABEL: Record<NonNullable<Step['eventKind']>, string> = {
  timer: 'Timer', signal: 'Signal', message: 'Nachricht', error: 'Fehler', escalation: 'Eskalation', none: 'Ereignis',
};

/**
 * Wie ein eigener Block anfängt — für die Klammer im Baum und im Export:
 * «startet mit Signal «send»» bzw. der Hinweis auf ein Link-Ziel.
 */
export function blockStart(first: Step): string {
  if (first.kind === 'start') {
    const art = first.eventKind && first.eventKind !== 'none' ? EVENT_LABEL[first.eventKind] : 'eigenem Start';
    return `startet mit ${art} «${first.name}»`;
  }
  return 'hängt an keinem Sequenzfluss — z. B. Ziel eines Link-Ereignisses';
}

/**
 * Die Schritte einer Ebene in Gruppen: ein Schritt mit `orphan` beginnt
 * eine neue; `head` ist gesetzt, wenn die Gruppe eine Klammer braucht (ein
 * Ereignis-Subprozess hat seinen eigenen Container und bleibt für sich).
 */
export function blockGroups(steps: Step[]): Array<{ head: Step | null; steps: Step[] }> {
  const groups: Array<{ head: Step | null; steps: Step[] }> = [];
  for (const s of steps) {
    const opens = !!s.orphan && !s.eventSubprocess;
    const last = groups[groups.length - 1];
    if (s.orphan || !last) groups.push({ head: opens ? s : null, steps: [s] });
    else last.steps.push(s);
  }
  return groups;
}

/** In welchem eigenen Block oder Ereignis-Subprozess ein Schritt steht. */
export interface BlockRef { head: Step; eventSub: boolean }

/**
 * Je Schritt-ID der Block, zu dem er gehört — für die Klammer im Datenmodell.
 * Schritte des Hauptablaufs fehlen in der Map.
 */
export function blockIndex(steps: Step[], into = new Map<string, BlockRef>(), ctx: BlockRef | null = null): Map<string, BlockRef> {
  const mark = (s: Step, ref: BlockRef | null) => {
    if (ref) into.set(s.id, ref);
    const inner = s.eventSubprocess ? { head: s, eventSub: true } : ref;
    if (s.children?.length) blockIndex(s.children, into, inner);
    for (const b of s.branches ?? []) blockIndex(b.steps, into, ref);
    for (const e of s.errors ?? []) if (e.steps?.length) blockIndex(e.steps, into, ref);
  };
  for (const g of blockGroups(steps)) {
    const ref = g.head ? { head: g.head, eventSub: false } : ctx;
    for (const s of g.steps) mark(s, ref);
  }
  return into;
}

export function allSteps(steps: Step[] | undefined, out: Step[] = []): Step[] {
  for (const s of steps ?? []) {
    out.push(s);
    allSteps(s.children, out);
    for (const b of s.branches ?? []) allSteps(b.steps, out);
    for (const e of s.errors ?? []) allSteps(e.steps, out);
  }
  return out;
}

export function statusCounts(spec: ProcessSpec): Record<Status, number> {
  // aus STATUSES aufgebaut, damit ein neuer Status nirgends vergessen wird
  const counts = Object.fromEntries(STATUSES.map(s => [s, 0])) as Record<Status, number>;
  for (const s of allSteps(spec.steps)) if (s.kind !== 'goto') counts[s.status] = (counts[s.status] ?? 0) + 1;
  return counts;
}

/**
 * Nur die Pattern-Angaben aus einem frischen Import übernehmen — für eine
 * gespeicherte Spezifikation, deren Pattern sich im Admin geändert haben.
 * Alles andere bleibt, wie es ist. `null`: nichts zu tun.
 */
export function syncPatterns(current: ProcessSpec, fresh: ProcessSpec): ProcessSpec | null {
  const neu = new Map(allSteps(fresh.steps).map(s => [s.id, s]));
  const key = (s: Step | undefined) => JSON.stringify([s?.patterns ?? null, s?.pattern ?? null, (s?.errors ?? []).map(e => [e.code, e.pattern ?? null])]);
  let changed = JSON.stringify(current.patterns ?? null) !== JSON.stringify(fresh.patterns ?? null);
  const walk = (steps: Step[]): Step[] => steps.map(s => {
    const f = neu.get(s.id);
    const next: Step = { ...s };
    if (f && key(f) !== key(s)) {
      changed = true;
      if (f.patterns) next.patterns = f.patterns; else delete next.patterns;
      if (f.pattern) next.pattern = f.pattern; else delete next.pattern;
      if (s.errors) {
        next.errors = s.errors.map(e => {
          const fe = f.errors?.find(x => x.code === e.code);
          const { pattern: _, ...rest } = e;
          return fe?.pattern ? { ...rest, pattern: fe.pattern } : rest;
        });
      }
    }
    if (next.children) next.children = walk(next.children);
    if (next.branches) next.branches = next.branches.map(b => ({ ...b, steps: walk(b.steps) }));
    if (next.errors) next.errors = next.errors.map(e => (e.steps ? { ...e, steps: walk(e.steps) } : e));
    return next;
  });
  const steps = walk(current.steps);
  if (!changed) return null;
  const { patterns: _, ...rest } = current;
  return { ...rest, ...(fresh.patterns?.length ? { patterns: fresh.patterns } : {}), steps };
}

/**
 * JUEL aus einem älteren Stand (oder dem Katalog) nach FEEL: Mappings und
 * Zweigbedingungen, soweit übersetzbar — der Rest bleibt JUEL und wird am
 * Feld gemeldet. Nichts zu tun → null.
 */
export function healJuel(spec: ProcessSpec): ProcessSpec | null {
  let changed = false;
  const rows = (ms: Mapping[] | undefined) => ms?.map(m => {
    const e = feelIfPossible(m.expression);
    if (e === m.expression) return m;
    changed = true;
    return { ...m, expression: e };
  });
  const walk = (steps: Step[]): Step[] => steps.map(s => {
    const next: Step = { ...s };
    if (s.inputs) next.inputs = rows(s.inputs);
    if (s.outputs) next.outputs = rows(s.outputs);
    if (s.children) next.children = walk(s.children);
    if (s.branches) next.branches = s.branches.map(b => {
      const cond = b.condition ? feelIfPossible(b.condition) : b.condition;
      if (cond !== b.condition) changed = true;
      return { ...b, condition: cond, steps: walk(b.steps) };
    });
    if (s.errors) next.errors = s.errors.map(e => (e.steps ? { ...e, steps: walk(e.steps) } : e));
    return next;
  });
  const steps = walk(spec.steps);
  return changed ? { ...spec, steps } : null;
}
