// BPMN → specification.
//
// The core of the PoC: the structure of the specification is derived from the
// **implementation** (the BPMN file). The flat BPMN graph becomes a
// **tree**: gateways get their branches up to the join, subprocesses
// their children, jumps back are marked as a loop. This is the basis
// for «guter Überblick», «Gateways und Loops sichtbar» and «Details einklappen».
//
// Business texts (description/notes/open) belong to the specification and
// are **kept** on re-import via the stable BPMN element ID
// (see `mergeSpec`) — the implementation only updates the structure.

import type { AppliedPattern, Branch, ErrorHandling, GatewayType, Mapping, PatternDef, ProcessSpec, Status, Step, StepKind, TimerSpec } from './types';
import { feelIfPossible, importExpression, jsonToFeel, stripNullSafe } from './juelFeel.ts';
import { detectEngine } from './engineConvert.ts';
import { detectPatterns } from './patterns.ts';
import { STATUSES } from './types.ts';
import { parseErrorList } from './errorCodes.ts';
export { feelString } from './errorCodes.ts';
import { nowIsoWithTimezone, slugify, todayIso } from './util.ts';

const BPMN_NS = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
const CAMUNDA_NS = 'http://camunda.org/schema/1.0/bpmn';
const ZEEBE_NS = 'http://camunda.org/schema/zeebe/1.0';

// The browser DOMParser returns `localName` without prefix; simpler
// XML parsers (Node tools) keep the prefix — handle both.
const local = (el: Element): string => {
  const n = el.localName || el.tagName || '';
  const i = n.indexOf(':');
  return i >= 0 ? n.slice(i + 1) : n;
};
const kids = (el: Element) => Array.from(el.children);
const childrenNamed = (el: Element, name: string) => kids(el).filter(c => local(c) === name);
const firstNamed = (el: Element, name: string): Element | null =>
  kids(el).find(c => local(c) === name) ?? null;

// Attribute without namespace fiddling (Camunda attributes are in the camunda NS,
// but in some exports also unqualified)
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

// `name=""` is common in drawn models and must be treated like «no name»
// — otherwise there are empty rows in the tree.
const nameOf = (el: Element): string => (el.getAttribute('name') ?? '').trim();

// all descendants with this local name (namespace-tolerant)
function elementsNamed(root: Element | null, name: string): Element[] {
  const out: Element[] = [];
  const visit = (el: Element) => {
    if (local(el) === name) out.push(el);
    for (const c of kids(el)) visit(c);
  };
  if (root) visit(root);
  return out;
}

// ── BPMN type → step kind ────────────────────────────────────────────────────
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

// ── Event details ────────────────────────────────────────────────────────────
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

const TIMER_KINDS: Record<string, TimerSpec['kind']> = { timeDuration: 'duration', timeDate: 'date', timeCycle: 'cycle' };

/** The variable of a timer — `= timerEscalationCancel`; null for fixed text or an expression */
export function timerVariable(timer: TimerSpec | undefined): string | null {
  const m = /^=\s*([A-Za-z_]\w*)\s*$/.exec(timer?.expression?.trim() ?? '');
  return m ? m[1] : null;
}


/** The timer of an event — as FEEL like the mappings: `${timerX}` → `= timerX`, `P7D` stays text */
function timerOf(el: Element): TimerSpec | undefined {
  const def = kids(el).find(c => local(c) === 'timerEventDefinition');
  if (!def) return undefined;
  for (const c of kids(def)) {
    const kind = TIMER_KINDS[local(c)];
    if (kind) return { kind, expression: importExpression(text(c)) };
  }
  return { kind: 'duration', expression: '' };
}

/** Boundary events that are not errors — they have their own section on the step */
const EVENT_BOUNDARY_KINDS = new Set<string>(['signal', 'message', 'escalation']);

/** A boundary event that is not an error (signal, message, escalation)? */
export const isEventBoundary = (e: ErrorHandling): boolean =>
  !!e.boundary && EVENT_BOUNDARY_KINDS.has(e.eventKind ?? 'none');

/** What an entry is called — error, side path or the kind of event */
export function boundaryLabel(e: ErrorHandling): string {
  if (isEventBoundary(e)) return EVENT_LABEL[e.eventKind!];
  return e.side ? 'Nebenpfad' : 'Fehler';
}

/** The correlation key of the message the element waits for (Camunda 8) */
function correlationKeyOf(el: Element, ctx: Pick<BuildCtx, 'correlationKeys'>): string | undefined {
  const def = local(el) === 'receiveTask' ? el : kids(el).find(c => local(c) === 'messageEventDefinition');
  return ctx.correlationKeys.get(def?.getAttribute('messageRef') ?? '');
}

/** Name of the signal or message of an event — via `signalRef` / `messageRef` */
function signalRefOf(el: Element, defs: Map<string, string>): string | undefined {
  for (const c of kids(el)) {
    const n = local(c);
    if (n !== 'signalEventDefinition' && n !== 'messageEventDefinition') continue;
    const ref = c.getAttribute('signalRef') ?? c.getAttribute('messageRef');
    if (ref && defs.has(ref)) return defs.get(ref);
  }
  return undefined;
}

// `errorRef` points to a <bpmn:error>; what matters is its errorCode/name.
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

// ── Inputs/outputs ───────────────────────────────────────────────────────────
/** A business parameter value: text becomes JUEL → FEEL; script, list and map stay descriptive. */
function fachlich(p: Element): string {
  // a script the export made from FEEL (JSON for Camunda 7): the FEEL is in the first line
  const script = firstNamed(p, 'script');
  const fromFeel = script ? /^\s*\/\/ FEEL: (.+)$/m.exec(text(script).split('\n').find(l => l.trim()) ?? '') : null;
  if (fromFeel) return `= ${fromFeel[1].trim()}`;
  if (script || firstNamed(p, 'list') || firstNamed(p, 'map')) return paramValue(p);
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
 * The mapping value of a parameter, as the import reads it — for
 * `inputParameter`/`outputParameter`, `camunda:in`/`out` and `zeebe:input`/
 * `output`. The export compares against it: what stayed the same stays
 * verbatim in the BPMN (including the Spin idiom, `#{…}` and script).
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

// Technical Orchescala parameters — not part of the business specification,
// but relevant for the Orchescala export (hence collected separately).
/** Control parameters that are not a business mapping — kept when writing. */
export const TECHNICAL = new Set([
  '_handledErrors', '_regexHandledErrors', '_outputVariables', '_outputMock',
  '_outputServiceMock', '_manualOutMapping', '_servicesMocked', '_mockedWorkers',
  '_identityCorrelation', 'impersonateUserId',
]);

/**
 * The general variables of Orchescala (`GeneralVariables`): every worker
 * accepts them, they may be overridden in any step — e.g.
 * `_idempotentId = processInstanceId`. Hence no extension of the catalog,
 * even though they are not in the service's In.
 * `_identityCorrelationPending` is deliberately missing: only the engine sets it.
 */
export const GENERAL_VARIABLES = new Set([
  '_servicesMocked', '_mockedWorkers', '_outputMock', '_outputServiceMock',
  '_manualOutMapping', '_outputVariables', '_handledErrors', '_regexHandledErrors',
  '_identityCorrelation', '_idempotentId',
  // deprecated, still read
  'impersonateUserId', 'servicesMocked', 'mockedWorkers', 'outputMock', 'outputServiceMock',
  'manualOutMapping', 'outputVariables', 'handledErrors', 'regexHandledErrors',
]);

interface IoResult {
  inputs: Mapping[];
  outputs: Mapping[];
  technical: Mapping[];
  handledErrors: string[];
  /** `_regexHandledErrors`: regular expressions for the codes */
  regexErrors: string[];
  mock?: string;
  mockKind?: 'output' | 'service';
}

/** fixed text from a zeebe source: `="a, b"` → `a, b`; everything else as it is */
function feelText(source: string): string {
  const t = source.trim();
  const lit = /^=\s*"((?:[^"\\]|\\.)*)"$/.exec(t);
  return lit ? lit[1].replace(/\\(["\\])/g, '$1') : t;
}

/** Name of the mock field in the `InConfig` for a step: «Create Contract» → `createContractMock` */
export function mockField(name: string): string {
  return `${name.replace(/[^A-Za-z0-9]/g, '').replace(/^(.)/, c => c.toLowerCase())}Mock`;
}

/**
 * The field in the InConfig the step's mock points to — as in the BPMN:
 * `#{execution.getVariable('getPoasMock')}`, `${getPoasMock}`, `=getPoasMock`
 * or `getPoasMock`. Without such a reference, the name from the step (`mockField`) —
 * likewise if the reference is a general variable (`_outputMock`): that does not
 * belong in the InConfig.
 */
export function mockFieldOf(step: { name: string; mock?: string }): string {
  const v = mockRef(step.mock);
  return v && !GENERAL_VARIABLES.has(v) && !v.startsWith('_') ? v : mockField(step.name);
}

/** The variable a mock value reads in the BPMN (`getPoasMock`, also `_outputMock`) — null if none */
export function mockRef(mock: string | undefined): string | null {
  const m = mock?.trim() ?? '';
  const v = /^#\{\s*execution\.getVariable\(\s*['"](\w+)['"]\s*\)\s*\}$/.exec(m)
    ?? /^[$#]\{\s*(\w+)\s*\}$/.exec(m) ?? /^=\s*(\w+)$/.exec(m) ?? /^([a-z_]\w*)$/.exec(m);
  return v ? v[1] : null;
}

/** Service worker: a service from the catalog — only it knows `_outputServiceMock` */
/** The assignment of a user task — Camunda 7 on the element, Camunda 8 in `zeebe:assignmentDefinition` */
export const ASSIGNMENT_KEYS = ['assignee', 'candidateGroups', 'candidateUsers'] as const;

export const isServiceWorker = (s: Step): boolean => s.kind === 'service' && (!!s.serviceId || s.mockKind === 'service');

function readIo(el: Element): IoResult {
  const res: IoResult = { inputs: [], outputs: [], technical: [], handledErrors: [], regexErrors: [] };
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
      if (n === 'in' && (target === '_outputMock' || target === '_outputServiceMock')) {
        res.mockKind = target === '_outputMock' ? 'output' : 'service';
        if (source) res.mock = source;
        continue;
      }
      // `source` is a variable name, `sourceExpression` a JUEL expression —
      // both become FEEL, the language of the specification
      const plain = attr(c, 'source');
      const expression = plain != null ? `= ${plain}` : importExpression(source ?? '');
      const m: Mapping = { name: target, expression };
      (TECHNICAL.has(target) || TECHNICAL.has(source ?? '') ? res.technical : n === 'in' ? res.inputs : res.outputs).push(m);
    }
  }

  // Camunda 8: <zeebe:ioMapping><zeebe:input source="=…" target="x"/> — the
  // source is FEEL (`=…`) or a fixed text, the target the variable.
  const zio = firstNamed(ext, 'ioMapping');
  if (zio) {
    for (const p of childrenNamed(zio, 'input')) {
      const target = attr(p, 'target') ?? '';
      if (!target) continue;
      const source = attr(p, 'source') ?? '';
      // Control parameters as in Camunda 7: handled errors and mock on the step
      if (target === '_handledErrors' || target === '_regexHandledErrors') {
        (target === '_handledErrors' ? res.handledErrors : res.regexErrors).push(...parseErrorList(source));
        continue;
      }
      if (target === '_outputMock' || target === '_outputServiceMock') { res.mock = source; res.mockKind = target === '_outputMock' ? 'output' : 'service'; continue; }
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
        (name === '_handledErrors' ? res.handledErrors : res.regexErrors).push(...parseErrorList(value));
        continue;
      }
      if (name === '_outputMock' || name === '_outputServiceMock') { res.mock = value; res.mockKind = name === '_outputMock' ? 'output' : 'service'; continue; }
      (TECHNICAL.has(name) ? res.technical : res.inputs).push({ name, expression: TECHNICAL.has(name) ? value : fachlich(p) });
    }
    for (const p of childrenNamed(io, 'outputParameter')) {
      const name = attr(p, 'name') ?? '';
      (TECHNICAL.has(name) ? res.technical : res.outputs).push({ name, expression: TECHNICAL.has(name) ? paramValue(p) : fachlich(p) });
    }
  }
  return res;
}

// ── Graph of a scope (process or subprocess) ─────────────────────────────────
interface Flow { id: string; source: string; target: string; name?: string; condition?: string }

interface Scope {
  nodes: Map<string, Element>;
  out: Map<string, Flow[]>;
  inCount: Map<string, number>;
  boundaries: Map<string, Element[]>;   // attachedToRef → boundary events
  boundaryOut: Map<string, Flow[]>;     // boundary event ID → outgoing flows
  /** catching events that only continue a throwing one (not a step of their own) */
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
    if (!nodes.has(source) || !nodes.has(target)) continue; // e.g. from boundary events
    const f: Flow = {
      id: el.getAttribute('id') ?? '',
      source, target,
      name: nameOf(el) || undefined,
      // the null-safe wrapper of Camunda 8 (`(…) = true`) belongs to the export, not the specification
      condition: stripNullSafe(importExpression(text(firstNamed(el, 'conditionExpression')))) || undefined,
    };
    out.set(source, [...(out.get(source) ?? []), f]);
    inCount.set(target, (inCount.get(target) ?? 0) + 1);
  }

  // Flows from a boundary event start a path of their own (error handling)
  for (const el of childrenNamed(container, 'sequenceFlow')) {
    const source = el.getAttribute('sourceRef') ?? '';
    if (!boundaryIds.has(source)) continue;
    const target = el.getAttribute('targetRef') ?? '';
    if (!nodes.has(target)) continue;
    const f: Flow = { id: el.getAttribute('id') ?? '', source, target, name: nameOf(el) || undefined };
    boundaryOut.set(source, [...(boundaryOut.get(source) ?? []), f]);
  }

  // Orchescala pattern: a **throwing** intermediate event without outgoing flow is
  // continued by the **catching** intermediate event of the same name without incoming flow
  // (no eventDefinition, the pairing goes via the name). Without this edge
  // paths like «output-mocked» or «send Process Event» break off midway.
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
    // no start event: take nodes without incoming edge
    for (const id of nodes.keys()) if (!inCount.get(id)) starts.push(id);
  }
  return { nodes, out, inCount, boundaries, boundaryOut, linkedCatch, starts };
}

// Find the join of a split.
//
// What we want is not just any commonly reachable node, but the
// next one that **every** path from the gateway must pass (post-dominator).
// Only then the branch stays exactly the block up to the join — otherwise
// half of the process ends up in every branch.
function postDominates(scope: Scope, splitId: string, m: string, stops: Set<string>): boolean {
  const seen = new Set<string>();
  const stack = (scope.out.get(splitId) ?? []).map(f => f.target);
  while (stack.length) {
    const id = stack.pop()!;
    if (id === m || id === splitId || seen.has(id)) continue; // target or loop
    seen.add(id);
    if (stops.has(id)) return false;              // left the block without m
    const outs = scope.out.get(id) ?? [];
    if (!outs.length) return false;               // reached the end without m
    for (const f of outs) stack.push(f.target);
  }
  return true;
}

function findMerge(scope: Scope, splitId: string, stops: Set<string> = new Set()): string | null {
  const branchTargets = (scope.out.get(splitId) ?? []).map(f => f.target);
  if (branchTargets.length < 2) return null;

  // per branch the reachable nodes, in breadth-first order (near first)
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
  // No common point (e.g. branches each end in their own end):
  // then the branch ends at the next stop of the enclosing block.
  for (const id of reach[0].order) if (stops.has(id)) return id;
  return null;
}

// ── Build the structure ──────────────────────────────────────────────────────
interface BuildCtx {
  doc: Document;
  /** Process ID — the step with this topic is the init worker */
  processId: string;
  /** Outputs of the init worker, which does not appear as a step */
  initOutputs: Mapping[];
  byId: Map<string, Step>;
  order: string[];
  /** <bpmn:error> id → errorCode or name */
  errors: Map<string, string>;
  /** <bpmn:signal> / <bpmn:message> id → name */
  signals: Map<string, string>;
  /** <bpmn:message> id → correlation key (Camunda 8: `zeebe:subscription`) */
  correlationKeys: Map<string, string>;
  /** all nodes of all levels — for the message «nicht erreichbar» */
  allNodes: Map<string, string>;
  /** element ID → pattern it belongs to (paths and blocks of a pattern) */
  owned: Map<string, string>;
  /** node → single successor (resolves removed joins) */
  succ: Map<string, string>;
}

function branchLabel(f: Flow, isDefault: boolean, index: number): string {
  if (f.name) return f.name;
  if (isDefault) return 'sonst';
  if (f.condition) return f.condition.replace(/^=\s*/, '').replace(/^\$\{|\}$/g, '');
  return `Pfad ${index + 1}`;
}

// Attach unconnected blocks.
//
// Event subprocesses and the targets of link events whose counterpart
// could not be recognized by name hang on no sequence flow. They
// still belong to the process — they are appended as blocks of their own at the end
// instead of silently disappearing.
function appendOrphans(ctx: BuildCtx, scope: Scope, steps: Step[]) {
  for (let guard = 0; guard < 50; guard++) {
    const missing = [...scope.nodes.keys()].filter(id => !ctx.byId.has(id));
    if (!missing.length) return;
    // prefers real entry points (without incoming edge), otherwise any
    const roots = missing.filter(id => !scope.inCount.get(id));
    const before = ctx.byId.size;
    for (const id of roots.length ? roots : [missing[0]]) {
      if (ctx.byId.has(id)) continue;
      const block = walk(ctx, scope, id, new Set(), new Set());
      if (block[0]) block[0].orphan = true;
      steps.push(...block);
    }
    if (ctx.byId.size === before) return; // no progress — abort
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
    status: 'implemented', // read from the implementation
  };
  // register early: jumps back from error paths mark the loop here
  ctx.byId.set(id, step);
  ctx.order.push(id);

  if (kind === 'gateway') step.gatewayType = GATEWAY_TYPE[tag] ?? 'exclusive';
  if (kind === 'event') {
    step.eventKind = eventKindOf(el);
    step.eventDirection = tag === 'intermediateThrowEvent' ? 'throw' : 'catch';
    const ref = signalRefOf(el, ctx.signals);
    if (ref) step.messageName = ref;
  }
  if (kind === 'start' || kind === 'end') {
    const ev = eventKindOf(el);
    if (ev !== 'none') step.eventKind = ev;
    const ref = signalRefOf(el, ctx.signals);
    if (ref) step.messageName = ref;
  }
  if (step.eventKind === 'timer') {
    const timer = timerOf(el);
    if (timer) step.timer = timer;
  }
  if (kind === 'receive' || kind === 'send') {
    const ref = el.getAttribute('messageRef');
    const name = ref ? ctx.signals.get(ref) : undefined;
    if (name) step.messageName = name;
  }
  // whoever waits for a message is found in Camunda 8 via its key
  if (kind === 'receive' || (kind === 'event' && step.eventKind === 'message' && step.eventDirection === 'catch')) {
    const key = correlationKeyOf(el, ctx);
    if (key) step.correlationKey = key;
  }

  const ext = firstNamed(el, 'extensionElements');
  // User task: who may work on it
  // (Camunda 7 on the element, Camunda 8 in zeebe:assignmentDefinition)
  if (kind === 'user') {
    const assign = ext ? firstNamed(ext, 'assignmentDefinition') : null;
    // as FEEL, like the mappings: `${kokRole}` → `= kokRole`, fixed text stays text
    for (const key of ASSIGNMENT_KEYS) {
      const value = attr(el, key) ?? (assign ? attr(assign, key) : undefined);
      if (value?.trim()) step[key] = importExpression(value);
    }
  }

  const template = attr(el, 'modelerTemplate');
  if (template) step.serviceId = template;
  // Camunda 7: camunda:topic on the element; Camunda 8: zeebe:taskDefinition type="…"
  const taskDef = ext ? firstNamed(ext, 'taskDefinition') : null;
  const topic = attr(el, 'topic') ?? (taskDef ? attr(taskDef, 'type') : undefined);
  if (topic) step.topic = topic;
  // Decision: the decision reference is the key into the DMN catalog
  // (Camunda 7 on the element, Camunda 8 in zeebe:calledDecision)
  const calledDecision = ext ? firstNamed(ext, 'calledDecision') : null;
  const decisionRef = attr(el, 'decisionRef') ?? (calledDecision ? attr(calledDecision, 'decisionId') : undefined);
  if (decisionRef && !step.topic) step.topic = decisionRef;
  // … and where the result goes, in which form (Camunda 7: default resultList)
  const resultVariable = attr(el, 'resultVariable') ?? (calledDecision ? attr(calledDecision, 'resultVariable') : undefined);
  if (decisionRef && resultVariable) step.resultVariable = resultVariable;
  const mapping = attr(el, 'mapDecisionResult');
  if (decisionRef && mapping && ['singleEntry', 'singleResult', 'collectEntries', 'resultList'].includes(mapping)) step.decisionResult = mapping as Step['decisionResult'];
  // Camunda 7: calledElement on the element; Camunda 8: zeebe:calledElement processId="…"
  const calledEl = ext ? firstNamed(ext, 'calledElement') : null;
  const called = el.getAttribute('calledElement') ?? (calledEl ? attr(calledEl, 'processId') : undefined);
  if (called) step.calledProcess = called;

  const mi = firstNamed(el, 'multiInstanceLoopCharacteristics');
  if (mi) {
    // Camunda 7: collection / elementVariable on the element; Camunda 8: zeebe:loopCharacteristics
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
  // `_outputVariables`: what the service returns and the process needs — without
  // own outputs (no manual mapping) these are the outputs themselves
  const ov = io.technical.find(m => m.name === '_outputVariables');
  const outVars = ov ? parseErrorList(ov.expression).filter(n => n && n.toUpperCase() !== 'NONE' && !n.startsWith('=')) : [];
  // remember `NONE` (nothing) — if `_outputVariables` is missing or empty, the worker returns everything
  if (ov && (outVars.length || /^\s*NONE\s*$/i.test(ov.expression))) step.outputVariables = outVars;
  if (outVars.length && !io.outputs.length) step.outputs = outVars.map(name => ({ name, expression: `= ${name}`, fromService: true }));
  // how the service returns its outputs — the export keeps it
  if (kind === 'service') {
    const mo = io.technical.find(m => m.name === '_manualOutMapping');
    step.manualOutMapping = !!mo && /true/i.test(mo.expression);
  }
  if (io.mock) step.mock = io.mock;
  if (io.mockKind) step.mockKind = io.mockKind;

  if (kind === 'subprocess') {
    if (el.getAttribute('triggeredByEvent') === 'true') step.eventSubprocess = true;
    const inner = readScope(el);
    register(ctx, inner);
    const children = walk(ctx, inner, inner.starts[0] ?? null, new Set(), new Set());
    appendOrphans(ctx, inner, children);
    step.children = children;
  }

  // Error handling: `_handledErrors` plus the paths of the boundary events
  const errors: ErrorHandling[] = io.handledErrors.map(code => ({ code, declared: true }));
  for (const b of scope.boundaries.get(id) ?? []) {
    const bid = b.getAttribute('id') ?? '';
    const interrupting = b.getAttribute('cancelActivity') !== 'false';
    // Path from the boundary event. The attached step counts as
    // «predecessor»: if the path leads back there, that is a repetition
    // (retry) and not a join.
    // If it runs back into the main flow (e.g. via a gateway before the
    // next step), it ends there with «weiter bei …» — otherwise it would take the
    // rest of the process with it, which is not built yet at this point.
    const flows = scope.boundaryOut.get(bid) ?? [];
    const steps = flows.length
      ? walk(ctx, scope, flows[0].target, mainFlowAfter(ctx, scope, id), new Set([...path, id]), id, {}, true)
      : undefined;
    // Without a name and without an error reference it is not an error case but a
    // side path — then its first step labels it instead of the element ID.
    const named = nameOf(b) || errorCodeOf(b, ctx.errors);
    const side = !named;
    const code = named || steps?.[0]?.name || bid;
    if (!code) continue;
    const pattern = ctx.owned.get(bid);
    // Signal, message, escalation: not an error — with kind, name and (waiting message) key
    const ev = eventKindOf(b);
    const event: Partial<ErrorHandling> = EVENT_BOUNDARY_KINDS.has(ev ?? 'none') ? {
      eventKind: ev,
      boundaryId: bid,
      ...(signalRefOf(b, ctx.signals) ? { messageName: signalRefOf(b, ctx.signals) } : {}),
      ...(correlationKeyOf(b, ctx) ? { correlationKey: correlationKeyOf(b, ctx) } : {}),
    } : {};
    if (event.eventKind) {
      errors.push({ code, interrupting, boundary: true, ...(side ? { side: true } : {}), ...(pattern ? { pattern } : {}), ...event, ...(steps?.length ? { steps } : {}) });
      continue;
    }
    // a timer together with its element — the export writes it back there
    const timer = timerOf(b);
    // two boundary events with the same code: with a timer each stays an entry of its own
    // (otherwise a timer would get lost) — the findings report the duplicate code
    const existing = errors.find(e => e.code === code && !(e.boundary && (timer || e.timer)));
    if (existing) {
      existing.interrupting = interrupting;
      existing.boundary = true;
      if (side) existing.side = true;
      if (pattern) existing.pattern = pattern;
      if (timer) {
        existing.timer = timer;
        existing.boundaryId = bid;
      }
      if (steps?.length) existing.steps = steps;
    } else {
      errors.push({ code, interrupting, boundary: true, ...(side ? { side: true } : {}), ...(pattern ? { pattern } : {}), ...(timer ? { timer, boundaryId: bid } : {}), ...(steps?.length ? { steps } : {}) });
    }
  }
  if (errors.length) step.errors = errors;
  if (io.regexErrors.length) step.regexHandledErrors = io.regexErrors;

  return step;
}

const JOIN_NAME = '\u0000join';

/**
 * A step without a label in the BPMN is named like its ID (`Activity_04tlno2`) — except
 * start, end and gateways, which get a substitute name of their own (see defaultName).
 * A name the specification sets is kept on reconciliation and goes into the BPMN on export.
 */
export const unnamed = (step: Pick<Step, 'id' | 'kind' | 'name'>): boolean =>
  step.kind !== 'goto' && (!step.name?.trim() || step.name === step.id);

function defaultName(tag: string, id: string): string {
  // Unnamed gateways are almost always joins — they carry no
  // information and are removed after building (see pruneJoins).
  if (tag.endsWith('Gateway')) return JOIN_NAME;
  if (tag === 'startEvent') return 'Start';
  if (tag === 'endEvent') return 'Ende';
  return id;
}

// Remove unnamed joins — they carry no information.
// Exception: the entry of a loop, which is called «Wiederholung ab hier».
// References that pointed to a removed join move on to the
// next real step («weiter bei ‹has Account Iban?›»).
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

// Resolve references: skip removed joins, update names.
// If a reference lands nowhere anymore, it is dropped (the path simply ends there).
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

// Walks the graph from `startId` and returns the block as a tree.
// `stops` = nodes where this block ends (its own join and
// those of all enclosing branchings — without that, branches run past their
// join and the rest of the process is multiplied).
// `path` = chain of open nodes; a hit in it is a loop.
// Reachability incl. the paths from boundary events — otherwise the retry
// («Fehler → warten → nochmal») is not recognized as a loop.
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

// Hints for labelling a loop (savings account pattern: a timer event
// «wait ${timer}» and a gateway «Tried ${max} times?»)
interface LoopHint { cond?: string; wait?: string }
const MAX_RE = /\$\{([^}]+)\}/;

/**
 * What the main flow still reaches from `id` (sequence flows only) and is not
 * built yet — that is where a path from a boundary event of `id` ends.
 * Already built nodes are recognized by `walk` itself (loop or merge).
 * Without the pairing throwing → catching event: a shared ending
 * like «activation-canceled» goes with the first path that needs it.
 */
function mainFlowAfter(ctx: BuildCtx, scope: Scope, id: string): Set<string> {
  const seen = new Set<string>();
  const stack = (scope.out.get(id) ?? []).map(f => f.target);
  while (stack.length) {
    const n = stack.pop()!;
    if (n === id || seen.has(n)) continue;
    seen.add(n);
    for (const f of scope.out.get(n) ?? []) if (!scope.linkedCatch.has(f.target)) stack.push(f.target);
  }
  for (const n of seen) if (ctx.byId.has(n)) seen.delete(n);
  return seen;
}

/** Name of the step where it continues from `id` — unnamed joins skipped */
function continuesAt(scope: Scope, id: string): string {
  const seen = new Set<string>();
  let cur: string | undefined = id;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const el = scope.nodes.get(cur);
    const n = el ? nameOf(el) : '';
    if (n || !el || !local(el).endsWith('Gateway')) return n || cur;
    const outs: Flow[] = scope.out.get(cur) ?? [];
    if (outs.length !== 1) return defaultName(local(el), cur);
    cur = outs[0].target;
  }
  return id;
}

// `rejoin`: the block is a path from a boundary event and `stops` is the
// main flow — if it ends there, a reference «weiter bei …» stands at the end.
function walk(ctx: BuildCtx, scope: Scope, startId: string | null, stops: Set<string>, path: Set<string>,
              prev: string | null = null, hint: LoopHint = {}, rejoin = false): Step[] {
  const out: Step[] = [];
  let cur = startId;
  const localSeen = new Set<string>();

  while (cur && !stops.has(cur)) {
    const known = ctx.byId.get(cur);
    if (known) {
      // Already shown: jump back (loop) or merge of two paths.
      // Both as a reference — that keeps the tree free of duplicates.
      // Jump back means: from there a path leads back here.
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
      // A gateway like «Tried ${max} times?» labels the loop behind it
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
    // The init worker (its topic is the process itself): its outputs are
    // the fields of the `InitIn` and are collected here. It stays a
    // step — selectable in the diagram, the pattern «Init Process» hangs on it;
    // it does not become an interaction or a mock field (interactions.ts).
    if (isInitWorker(step, ctx.processId)) ctx.initOutputs = step.outputs ?? [];
    // The catching counterpart of a throwing event is pure wiring
    // — it carries the same name and no statement of its own.
    if (!scope.linkedCatch.has(cur)) out.push(step);
    prev = cur;
    cur = flows[0]?.target ?? null;
  }
  if (rejoin && cur && stops.has(cur)) {
    out.push({ id: `${cur}__join__${out.length}`, kind: 'goto', name: continuesAt(scope, cur), status: 'implemented', gotoId: cur });
  }
  return out;
}

// ── Public API ───────────────────────────────────────────────────────────────
export interface ImportResult {
  spec: ProcessSpec;
  /** Number of steps in the tree (without goto) */
  stepCount: number;
  /** nodes found in the BPMN but not reachable */
  unreachable: string[];
}

export interface ImportOptions {
  /** Patterns from the admin — recognized ones are on the step or on the process */
  patterns?: PatternDef[];
}

/** The init worker: a service task with the process itself as topic */
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
  const correlationKeys = new Map<string, string>();
  for (const m of elementsNamed(doc.documentElement, 'message')) {
    const ext = firstNamed(m, 'extensionElements');
    const key = ext ? firstNamed(ext, 'subscription')?.getAttribute('correlationKey') : null;
    const id = m.getAttribute('id');
    if (id && key?.trim()) correlationKeys.set(id, key.trim());
  }
  // Camunda 8 is recognized by the zeebe namespace or the modeler info
  const engine = detectEngine(xml);
  // Patterns first: what belongs to one is shown as a pattern in the tree
  const detected = detectPatterns(doc, opts.patterns, engine);
  const ctx: BuildCtx = {
    doc, processId, initOutputs: [],
    byId: new Map(), order: [], errors: errorDefs, signals: signalDefs, correlationKeys, allNodes: new Map(), succ: new Map(),
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

  // Derive process name/project from the ID: `globex-savings-openSavingsV1`
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

/** Write recognized patterns to the steps; mark steps of a pattern block */
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

// ── Re-import: keep business texts ───────────────────────────────────────────
// Structure comes from the implementation, prose from the specification. Steps
// that no longer exist disappear; new ones are added as «Entwurf»;
// changed ones (different service/topic/mapping) are set to «Angepasst».
export interface MergeReport {
  added: string[];
  removed: string[];
  changed: string[];
  /** only renamed — «alt → neu» */
  renamed: string[];
  /** were on «Angepasst», are unchanged — get the chosen status */
  confirmed: string[];
  kept: number;
}

/**
 * Which status the reconciliation sets: `added` for new steps, `changed`
 * for technically changed ones. Without a value Entwurf or Angepasst — whoever fetches the BPMN
 * from the implementation can set both e.g. to «Umgesetzt».
 * If `changed` is not «Angepasst», it also applies to what is already on «Angepasst»
 * from an earlier reconciliation and now matches the BPMN
 * — the reconciliation confirms it (see `settle`).
 */
export interface MergeStatus {
  added: Status;
  changed: Status;
  /**
   * Take over mappings and mock of the steps from the BPMN — also where the
   * diagram did not change them. For specifications whose stored
   * rows are outdated; the meaning of the rows stays.
   */
  mappingsFromBpmn?: boolean;
}
export const DEFAULT_MERGE_STATUS: MergeStatus = { added: 'draft', changed: 'changed' };

/** Status of an unchanged element: «Angepasst» is confirmed, otherwise it stays. */
export const settle = (prev: Status | undefined, st: MergeStatus): Status | undefined =>
  prev === 'changed' && st.changed !== 'changed' ? st.changed : prev;

// What the specification defines survives the reconciliation with the BPMN.
const KEEP_KEYS = ['description', 'candidateGroups', 'candidateUsers', 'assignee', 'inVariant', 'outVariant'] as const;

function indexSteps(steps: Step[] | undefined, into: Map<string, Step>): Map<string, Step> {
  for (const s of steps ?? []) {
    into.set(s.id, s);
    indexSteps(s.children, into);
    for (const b of s.branches ?? []) indexSteps(b.steps, into);
    for (const e of s.errors ?? []) indexSteps(e.steps, into);
  }
  return into;
}

// The technical contract of a step. **Without name**: a rename is
// not a change of the implementation, but the same thing labelled differently
// — it is reported separately (`renamed`), but does not reset the status.
function sig(s: Step): string {
  return JSON.stringify([s.kind, s.serviceId ?? '', s.topic ?? '', s.calledProcess ?? '',
    (s.inputs ?? []).map(i => `${i.name}=${i.expression}`),
    (s.outputs ?? []).map(o => `${o.name}=${o.expression}`)]);
}

/**
 * What the specification sets on the step — service, topic, called
 * process, mappings, mock. It only goes into the BPMN on export; until then
 * the diagram has the old state. A reconciliation may therefore only replace it
 * where the **diagram itself** changed it (three-way reconciliation against the
 * previous BPMN) — otherwise settings would be lost as soon as someone moves
 * something in the diagram or the app aligns it.
 */
const SPEC_OWNED = ['serviceId', 'topic', 'calledProcess', 'inputs', 'outputs', 'mock', 'mockKind', 'timer', 'messageName', 'correlationKey'] as const;
/** only read by a newer import — an older specification without them gets them from the diagram */
const LATER_READ = new Set<string>(['timer', 'messageName', 'correlationKey']);

/** A value independent of its engine form: `${x}` like `=x`, `text` like `="text"` */
function normExpr(e: string): string {
  const f = feelIfPossible(e.trim());
  const lit = /^=\s*"((?:[^"\\]|\\.)*)"$/.exec(f);
  if (lit) return lit[1].replace(/\\(["\\])/g, '$1');
  return f.startsWith('=') ? `= ${f.slice(1).trim()}` : f;
}

const norm = (k: string, v: unknown): unknown =>
  (k === 'mock' || k === 'correlationKey') && typeof v === 'string' ? normExpr(v)
    // the default for the InConfig is not in the diagram
    : k === 'timer' && v && !Array.isArray(v) ? [(v as TimerSpec).kind, normExpr((v as TimerSpec).expression ?? '')]
    : (k === 'inputs' || k === 'outputs') && Array.isArray(v) ? (v as Mapping[]).map(m => [m.name, normExpr(m.expression)])
      : v;

/** does the diagram have the same — equal except for the engine's notation? */
const same = (k: string, a: unknown, b: unknown): boolean =>
  JSON.stringify(norm(k, a) ?? null) === JSON.stringify(norm(k, b) ?? null);

/**
 * What of it is in the diagram: deselected rows and outputs of the service
 * (`fromService`, an entry in `_outputVariables`) are unknown to it.
 */
const inDiagram = (k: string, v: unknown): unknown =>
  (k === 'inputs' || k === 'outputs') && Array.isArray(v)
    ? (v as Mapping[]).filter(m => !m.disabled && m.name.trim() && !m.fromService)
    : v;

function keepSpecOwned(s: Step, prev: Step, base: Step | undefined) {
  for (const k of SPEC_OWNED) {
    // without previous BPMN: just don't lose what the diagram does not know —
    // and if the diagram contains exactly what the specification writes into it, it has
    // changed nothing, even if the reference is missing or outdated (otherwise
    // the deselected rows would be lost and the step would jump to «Angepasst»)
    const diagramUnchanged = (base ? same(k, s[k], base[k]) : s[k] == null || same(k, s[k], []))
      || (prev[k] != null && same(k, s[k], inDiagram(k, prev[k])));
    if (!diagramUnchanged) continue;
    // the timer is only read by a newer import — an older specification without it gets it
    if (prev[k] === undefined) { if (!LATER_READ.has(k)) delete s[k]; }
    else (s as Record<string, unknown>)[k] = prev[k];
  }
}

/**
 * The diagram does not know the timer's default for the InConfig — it stays as long as
 * it reads the same variable (of the same kind); a different one has its own default.
 */
function withPrevDefault(timer: TimerSpec, prev: TimerSpec | undefined): TimerSpec {
  const name = timerVariable(timer);
  return prev?.default && !timer.default && timer.kind === prev.kind && name && name === timerVariable(prev)
    ? { ...timer, default: prev.default }
    : timer;
}

/**
 * The same boundary event in another version of the list (`list`): via
 * its ID — without it (a specification from before the import of the IDs) via the
 * code, with equal code in order. Only if both sides have the same
 * number without a counterpart via the ID — otherwise it is unclear which one was dropped.
 * `own` is the list that contains `e`.
 */
export function sameBoundary(list: ErrorHandling[] | undefined, e: ErrorHandling, own: ErrorHandling[]): ErrorHandling | undefined {
  if (!list) return undefined;
  if (e.boundaryId && list.some(x => x.boundaryId)) return list.find(x => x.boundaryId === e.boundaryId);
  const ids = (l: ErrorHandling[]) => new Set(l.map(x => x.boundaryId).filter(Boolean));
  const theirIds = ids(list);
  const ownIds = ids(own);
  const sameCode = (x: ErrorHandling) => x.boundary && x.code === e.code;
  const mine = own.filter(x => sameCode(x) && !(x.boundaryId && theirIds.has(x.boundaryId)));
  const theirs = list.filter(x => sameCode(x) && !(x.boundaryId && ownIds.has(x.boundaryId)));
  return mine.length === theirs.length ? theirs[mine.indexOf(e)] : undefined;
}

/**
 * The timer of a boundary event, like that of an event, belongs to the
 * specification (see `SPEC_OWNED`): if the diagram did not change it,
 * it stays as it is in the specification — and its default for the InConfig stays.
 * It is matched via the boundary event, in an older specification
 * without its ID via the code.
 */
function keepBoundaryTimers(s: Step, prev: Step, base: Step | undefined, keepEdits: boolean) {
  if (!s.errors?.some(e => e.timer)) return;
  const own = s.errors;
  const match = (list: ErrorHandling[] | undefined, e: ErrorHandling) => {
    const x = sameBoundary(list, e, own);
    return x?.timer ? x : undefined;
  };
  s.errors = s.errors.map(e => {
    const p = e.timer && match(prev.errors, e);
    if (!e.timer || !p || !p.timer) return e;
    const b = base && match(base.errors, e);
    const diagramUnchanged = (b ? same('timer', e.timer, b.timer) : false) || same('timer', e.timer, p.timer);
    const timer = keepEdits && diagramUnchanged ? p.timer : withPrevDefault(e.timer, p.timer);
    return timer === e.timer ? e : { ...e, timer };
  });
}

/**
 * Signal or message of a boundary event (name, correlation key)
 * belong to the specification as on the event: if the diagram did not change them
 * compared to the previous BPMN, what is in the specification stays.
 */
function keepBoundaryMessages(s: Step, prev: Step, base: Step | undefined) {
  if (!s.errors?.some(isEventBoundary)) return;
  const own = s.errors;
  s.errors = s.errors.map(e => {
    if (!isEventBoundary(e)) return e;
    const p = sameBoundary(prev.errors, e, own);
    if (!p) return e;
    const b = base ? sameBoundary(base.errors, e, own) : undefined;
    let next = e;
    for (const k of ['messageName', 'correlationKey'] as const) {
      const diagramUnchanged = b ? same(k, e[k], b[k]) : same(k, e[k], p[k]);
      if (diagramUnchanged && p[k] !== undefined && p[k] !== e[k]) next = { ...next, [k]: p[k] };
    }
    return next;
  });
}

/**
 * Kind, signal or message of the boundary events — a specification from before
 * their import has them as errors; it gets them from the diagram. What it
 * already has stays. Null if nothing is missing.
 */
export function syncBoundaryEvents(current: ProcessSpec, fresh: ProcessSpec): ProcessSpec | null {
  const neu = new Map(allSteps(fresh.steps).map(s => [s.id, s]));
  let changed = false;
  const walk = (steps: Step[]): Step[] => steps.map(s => {
    let next = s;
    const theirs = neu.get(s.id)?.errors;
    if (s.errors?.some(e => e.boundary && !e.eventKind) && theirs?.some(isEventBoundary)) {
      const errors = s.errors.map(e => {
        if (!e.boundary || e.eventKind) return e;
        const f = sameBoundary(theirs, e, s.errors!);
        if (!f || !isEventBoundary(f)) return e;
        changed = true;
        const { eventKind, boundaryId, messageName, correlationKey } = f;
        return { ...e, eventKind, boundaryId, ...(messageName ? { messageName } : {}), ...(correlationKey ? { correlationKey } : {}) };
      });
      next = { ...next, errors };
    }
    if (next.children) next = { ...next, children: walk(next.children) };
    if (next.branches) next = { ...next, branches: next.branches.map(b => ({ ...b, steps: walk(b.steps) })) };
    if (next.errors) next = { ...next, errors: next.errors.map(e => (e.steps ? { ...e, steps: walk(e.steps) } : e)) };
    return next;
  });
  const steps = walk(current.steps);
  return changed ? { ...current, steps } : null;
}

/**
 * Empty entries among the handled errors — a just added or
 * cleared regex or error code — do not go into the BPMN. The reconciliation
 * must therefore not discard them as long as the diagram has the others unchanged.
 */
function keepEmptyErrors(s: Step, prev: Step) {
  const regex = prev.regexHandledErrors ?? [];
  const filled = regex.map(r => r.trim()).filter(Boolean);
  if (filled.length < regex.length && JSON.stringify(filled) === JSON.stringify(s.regexHandledErrors ?? [])) {
    s.regexHandledErrors = regex;
  }
  const blank = (e: ErrorHandling) => !e.code?.trim() && !e.boundary && !e.side;
  const errs = prev.errors ?? [];
  if (!errs.some(blank)) return;
  const codes = (list: ErrorHandling[]) => JSON.stringify(list.map(e => e.code).sort());
  if (codes(errs.filter(e => !blank(e))) !== codes(s.errors ?? [])) return;
  const fresh = new Map((s.errors ?? []).map(e => [e.code, e]));
  s.errors = errs.map(e => (blank(e) ? e : fresh.get(e.code) ?? e));
}

/** `= "[6026, 102]"` (JSON as text) versus the literal from the diagram `= [6026, 102]` — the same, just read correctly */
function jsonTextUpgrade(stored: string, fromDiagram: string | undefined): boolean {
  const m = /^=\s*("(?:[^"\\]|\\.)*")\s*$/.exec(stored.trim());
  if (!m || !fromDiagram) return false;
  try {
    const value: unknown = JSON.parse(JSON.parse(m[1]) as string);
    return value !== null && typeof value === 'object' && fromDiagram.trim() === `= ${jsonToFeel(value)}`;
  } catch {
    return false;
  }
}

/**
 * `= number(a.b)` — an older import turned `….intValue()` into a call that
 * FEEL only knows for text; today the diagram reads `= a.b`. Equal except for `number(…)`
 * around paths: then the diagram wins.
 */
function numberUpgrade(stored: string, fromDiagram: string | undefined): boolean {
  if (!fromDiagram || !/(?<![\w.])number\(/.test(stored)) return false;
  const without = stored.replace(/(?<![\w.])number\(([A-Za-z_][\w.]*)\)/g, '$1');
  return without !== stored && without.trim() === fromDiagram.trim();
}
/** A value an older import read wrongly — the diagram reads it correctly today */
const importUpgrade = (stored: string, fromDiagram: string | undefined): boolean =>
  jsonTextUpgrade(stored, fromDiagram) || numberUpgrade(stored, fromDiagram);

function applyOld(steps: Step[], old: Map<string, Step>, report: MergeReport, seen: Set<string>, base: Map<string, Step> | null, st: MergeStatus) {
  for (const s of steps) {
    seen.add(s.id);
    const prev = old.get(s.id);
    if (!prev) {
      if (s.kind !== 'goto') report.added.push(s.name);
      s.status = st.added;
    } else {
      const fresh = { inputs: s.inputs, outputs: s.outputs };
      if (!st.mappingsFromBpmn) keepSpecOwned(s, prev, base?.get(s.id));
      if (s.timer) s.timer = withPrevDefault(s.timer, prev.timer);
      keepBoundaryTimers(s, prev, base?.get(s.id), !st.mappingsFromBpmn);
      keepBoundaryMessages(s, prev, base?.get(s.id));
      // `JSON('[6026, 102]')` used to come in as text `= "[6026, 102]"`, `….intValue()`
      // as `number(…)` — if the diagram reads it correctly today, that wins
      for (const list of ['inputs', 'outputs'] as const) {
        const now = new Map((fresh[list] ?? []).map(m => [m.name, m.expression]));
        if (s[list] && s[list] !== fresh[list]) {
          s[list] = s[list]!.map(m => (importUpgrade(m.expression, now.get(m.name)) ? { ...m, expression: now.get(m.name)! } : m));
        }
      }
      keepEmptyErrors(s, prev);
      // without a label in the BPMN the name from the specification wins (the export writes it in)
      if (unnamed(s) && !unnamed(prev)) s.name = prev.name;
      for (const k of KEEP_KEYS) if (prev[k] != null && prev[k] !== '') s[k] = prev[k];
      // Business meaning and deselection of the mappings belong to the specification —
      // with `mappingsFromBpmn` the deselection does not apply: what is in the BPMN is enabled
      for (const list of ['inputs', 'outputs'] as const) {
        const before = new Map((prev[list] ?? []).map(m => [m.name, m]));
        for (const m of s[list] ?? []) {
          const p = before.get(m.name);
          if (p?.description) m.description = p.description;
          if (p?.disabled && !st.mappingsFromBpmn) m.disabled = true;
        }
      }
      // The status belongs to the specification: it stays as it was set.
      // Only if something changed technically does it jump to «Angepasst»
      // (or the chosen status) — the signal that someone has to check.
      if (prev.name !== s.name && s.kind !== 'goto') report.renamed.push(`${prev.name} → ${s.name}`);
      const changed = sig(prev) !== sig(s);
      if (changed && s.kind !== 'goto') report.changed.push(s.name);
      s.status = changed ? st.changed : settle(prev.status, st)!;
      if (!changed && s.status !== prev.status && s.kind !== 'goto') report.confirmed.push(s.name);
      report.kept++;
    }
    if (s.children) applyOld(s.children, old, report, seen, base, st);
    for (const b of s.branches ?? []) applyOld(b.steps, old, report, seen, base, st);
    // Error and side paths belong to it — otherwise their business texts get
    // lost on re-import and they wrongly count as dropped.
    for (const e of s.errors ?? []) if (e.steps) applyOld(e.steps, old, report, seen, base, st);
  }
}

/**
 * Merge the freshly read BPMN (`fresh`) with the specification (`previous`).
 * `base` is the import of the **previous** BPMN: what the
 * diagram did not change compared to it stays as it is in the
 * specification (see `SPEC_OWNED`).
 */
export function mergeSpec(fresh: ProcessSpec, previous: ProcessSpec, base: ProcessSpec | null = null,
                          st: MergeStatus = DEFAULT_MERGE_STATUS): { spec: ProcessSpec; report: MergeReport } {
  const old = indexSteps(previous.steps, new Map());
  const report: MergeReport = { added: [], removed: [], changed: [], renamed: [], confirmed: [], kept: 0 };
  const seen = new Set<string>();
  applyOld(fresh.steps, old, report, seen, base ? indexSteps(base.steps, new Map()) : null, st);
  for (const [id, s] of old) if (!seen.has(id) && s.kind !== 'goto') report.removed.push(s.name || id);

  const spec: ProcessSpec = {
    ...previous,
    ...fresh,
    slug: previous.slug,
    title: previous.title || fresh.title,
    description: previous.description ?? '',
    epics: previous.epics,
    variables: previous.variables ?? [],
    ...(fresh.initOutputs?.length ? { initOutputs: fresh.initOutputs } : {}),
    // Patterns on the process come from the BPMN — like the structure
    patterns: fresh.patterns,
    timeToLive: previous.timeToLive ?? fresh.timeToLive,
    // the process only jumps to «Angepasst» if that also applies to the steps
    status: previous.status === 'draft' ? 'draft'
      : st.changed !== 'changed' ? settle(previous.status, st)!
        : (report.added.length || report.changed.length || report.removed.length ? 'changed' : previous.status),
    createdAt: previous.createdAt,
    updatedAt: nowIsoWithTimezone(),
  };
  return { spec, report };
}

// ── Helpers for the UI ───────────────────────────────────────────────────────
const EVENT_LABEL: Record<NonNullable<Step['eventKind']>, string> = {
  timer: 'Timer', signal: 'Signal', message: 'Nachricht', error: 'Fehler', escalation: 'Eskalation', none: 'Ereignis',
};

/**
 * How a block of its own starts — for the bracket in the tree and in the export:
 * «startet mit Signal «send»» or the hint to a link target.
 */
export function blockStart(first: Step): string {
  if (first.kind === 'start') {
    const art = first.eventKind && first.eventKind !== 'none' ? EVENT_LABEL[first.eventKind] : 'eigenem Start';
    return `startet mit ${art} «${first.name}»`;
  }
  return 'hängt an keinem Sequenzfluss — z. B. Ziel eines Link-Ereignisses';
}

/**
 * The steps of a level in groups: a step with `orphan` starts
 * a new one; `head` is set if the group needs a bracket (an
 * event subprocess has its own container and stays on its own).
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

/** In which block of its own or event subprocess a step is. */
export interface BlockRef { head: Step; eventSub: boolean }

/**
 * Per step ID the block it belongs to — for the bracket in the data model.
 * Steps of the main flow are missing in the map.
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

/**
 * Set one status for everything an import creates: process, steps on
 * all levels (sub-steps, branches, error paths) and the data model from
 * the domain. Prepared items without a domain object stay Entwurf — that is
 * not implemented anywhere.
 */
export function withStatus(spec: ProcessSpec, status: Status): ProcessSpec {
  const walk = (steps: Step[]): Step[] => steps.map(s => ({
    ...s,
    status,
    ...(s.children ? { children: walk(s.children) } : {}),
    ...(s.branches ? { branches: s.branches.map(b => ({ ...b, steps: walk(b.steps) })) } : {}),
    ...(s.errors ? { errors: s.errors.map(e => (e.steps ? { ...e, steps: walk(e.steps) } : e)) } : {}),
  }));
  const keep = <T extends { status?: Status }>(x: T): T => (x.status === 'draft' ? x : { ...x, status });
  return {
    ...spec,
    status,
    steps: walk(spec.steps),
    ...(spec.types ? { types: spec.types.map(keep) } : {}),
    ...(spec.interactions ? { interactions: spec.interactions.map(keep) } : {}),
  };
}

export function statusCounts(spec: ProcessSpec): Record<Status, number> {
  // built from STATUSES, so that a new status is never forgotten anywhere
  const counts = Object.fromEntries(STATUSES.map(s => [s, 0])) as Record<Status, number>;
  for (const s of allSteps(spec.steps)) if (s.kind !== 'goto') counts[s.status] = (counts[s.status] ?? 0) + 1;
  return counts;
}

// ── Patterns at a glance ─────────────────────────────────────────────────────

/** An applied pattern and where it is — `stepId` null: on the process. */
export interface PatternUse { id: string; stepId: string | null; where: string; params: Record<string, string> }

/** All patterns of a specification: on the process and on the steps (not their parts). */
export function patternUses(spec: ProcessSpec): PatternUse[] {
  const out: PatternUse[] = (spec.patterns ?? []).map(p => ({ id: p.id, stepId: null, where: 'Prozess', params: p.params ?? {} }));
  for (const s of allSteps(spec.steps)) {
    if (s.kind === 'goto') continue;
    for (const p of s.patterns ?? []) out.push({ id: p.id, stepId: s.id, where: s.name || s.id, params: p.params ?? {} });
  }
  return out;
}

/** Per pattern: how often and where — in the order of first occurrence. */
export function patternSummary(spec: ProcessSpec): Array<{ id: string; where: string[] }> {
  const by = new Map<string, string[]>();
  for (const u of patternUses(spec)) by.set(u.id, [...(by.get(u.id) ?? []), u.where]);
  return [...by.entries()].map(([id, where]) => ({ id, where }));
}

export interface PatternDiff {
  added: PatternUse[];
  removed: PatternUse[];
  /** same pattern at the same place, different parameters */
  changed: Array<{ use: PatternUse; before: Record<string, string> }>;
}

/**
 * What changed in the patterns — compared per place (process or step ID).
 * If a pattern occurs several times at one place (two
 * mail timers), the occurrences are paired in order.
 */
export function patternDiff(before: ProcessSpec, after: ProcessSpec): PatternDiff {
  const key = (u: PatternUse) => `${u.stepId ?? ''}\u0000${u.id}`;
  const group = (us: PatternUse[]) => {
    const m = new Map<string, PatternUse[]>();
    for (const u of us) m.set(key(u), [...(m.get(key(u)) ?? []), u]);
    return m;
  };
  const vorher = group(patternUses(before));
  const diff: PatternDiff = { added: [], removed: [], changed: [] };
  for (const [k, list] of group(patternUses(after))) {
    const alt = vorher.get(k) ?? [];
    vorher.delete(k);
    list.forEach((u, i) => {
      const a = alt[i];
      if (!a) diff.added.push(u);
      else if (JSON.stringify(a.params) !== JSON.stringify(u.params)) diff.changed.push({ use: u, before: a.params });
    });
    diff.removed.push(...alt.slice(list.length));
  }
  for (const list of vorher.values()) diff.removed.push(...list);
  return diff;
}

/**
 * Timers from the diagram where the specification has none yet — it dates from
 * before the import of the timers (on the boundary event also only without its ID). What
 * it already has (including the default for the InConfig) stays; a timer is changed
 * via the reconciliation. Null if nothing is missing.
 */
export function syncTimers(current: ProcessSpec, fresh: ProcessSpec): ProcessSpec | null {
  const neu = new Map(allSteps(fresh.steps).map(s => [s.id, s]));
  let changed = false;
  const walk = (steps: Step[]): Step[] => steps.map(s => {
    const f = neu.get(s.id);
    let next = s;
    if (!s.timer && f?.timer) { changed = true; next = { ...next, timer: f.timer }; }
    // on the boundary event the timer together with the element the export writes it into
    // same code on several boundary events: in order (see sameBoundary)
    const fill = (e: ErrorHandling, all: ErrorHandling[]): Partial<ErrorHandling> | undefined => {
      if (!e.boundary || (e.timer && e.boundaryId)) return undefined;
      const fe = sameBoundary(f?.errors, e, all);
      return fe?.timer ? { ...(e.timer ? {} : { timer: fe.timer }), boundaryId: fe.boundaryId } : undefined;
    };
    if (next.errors?.some(e => fill(e, next.errors!))) {
      changed = true;
      next = { ...next, errors: next.errors.map((e, _, all) => { const p = fill(e, all); return p ? { ...e, ...p } : e; }) };
    }
    if (next.children) next = { ...next, children: walk(next.children) };
    if (next.branches) next = { ...next, branches: next.branches.map(b => ({ ...b, steps: walk(b.steps) })) };
    if (next.errors) next = { ...next, errors: next.errors.map(e => (e.steps ? { ...e, steps: walk(e.steps) } : e)) };
    return next;
  });
  const steps = walk(current.steps);
  return changed ? { ...current, steps } : null;
}

/**
 * The correlation key of a waiting message (`zeebe:subscription`):
 * a specification from before its import gets it from the diagram. What it
 * already has stays — it is changed on the step, the export writes it.
 * Null if nothing is missing.
 */
export function syncCorrelationKeys(current: ProcessSpec, fresh: ProcessSpec): ProcessSpec | null {
  const neu = new Map(allSteps(fresh.steps).map(s => [s.id, s.correlationKey]));
  let changed = false;
  const walk = (steps: Step[]): Step[] => steps.map(s => {
    let next = s;
    const key = neu.get(s.id);
    if (key && s.correlationKey === undefined) {
      changed = true;
      next = { ...next, correlationKey: key };
    }
    if (next.children) next = { ...next, children: walk(next.children) };
    if (next.branches) next = { ...next, branches: next.branches.map(b => ({ ...b, steps: walk(b.steps) })) };
    if (next.errors) next = { ...next, errors: next.errors.map(e => (e.steps ? { ...e, steps: walk(e.steps) } : e)) };
    return next;
  });
  const steps = walk(current.steps);
  return changed ? { ...current, steps } : null;
}

/**
 * Take over only the pattern information from a fresh import — for a
 * stored specification whose patterns changed in the admin.
 * Everything else stays as it is. `null`: nothing to do.
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
 * JUEL from an older state (or the catalog) to FEEL: mappings,
 * branch conditions and assignment, as far as translatable — the rest stays JUEL and is
 * reported on the field. Nothing to do → null.
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
    for (const key of ASSIGNMENT_KEYS) {
      const v = s[key] ? feelIfPossible(s[key]) : s[key];
      if (v !== s[key]) { next[key] = v; changed = true; }
    }
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
