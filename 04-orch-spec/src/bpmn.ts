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

import type { Branch, ErrorHandling, GatewayType, Mapping, ProcessSpec, Status, Step, StepKind } from './types';
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
function paramValue(p: Element): string {
  const script = firstNamed(p, 'script');
  if (script) return `«${attr(script, 'scriptFormat') ?? 'script'}» ${text(script)}`;
  const list = firstNamed(p, 'list');
  if (list) return kids(list).map(text).join(', ');
  const map = firstNamed(p, 'map');
  if (map) return kids(map).map(e => `${attr(e, 'key') ?? ''}: ${text(e)}`).join(', ');
  return text(p);
}

// Technische Orchescala-Parameter — nicht Teil der fachlichen Spezifikation,
// aber für den Orchescala-Export relevant (deshalb separat gesammelt).
const TECHNICAL = new Set([
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
      const m: Mapping = { name: target, expression: source ?? '' };
      (TECHNICAL.has(target) || TECHNICAL.has(source ?? '') ? res.technical : n === 'in' ? res.inputs : res.outputs).push(m);
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
      (TECHNICAL.has(name) ? res.technical : res.inputs).push({ name, expression: value });
    }
    for (const p of childrenNamed(io, 'outputParameter')) {
      const name = attr(p, 'name') ?? '';
      (TECHNICAL.has(name) ? res.technical : res.outputs).push({ name, expression: paramValue(p) });
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
      condition: text(firstNamed(el, 'conditionExpression')) || undefined,
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
  /** alle Knoten aller Ebenen — für die Meldung «nicht erreichbar» */
  allNodes: Map<string, string>;
  /** Knoten → einziger Nachfolger (löst entfernte Zusammenführungen auf) */
  succ: Map<string, string>;
}

function branchLabel(f: Flow, isDefault: boolean, index: number): string {
  if (f.name) return f.name;
  if (isDefault) return 'sonst';
  if (f.condition) return f.condition.replace(/^\$\{|\}$/g, '');
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
    const timer = timerExpression(el);
    if (timer) step.notes = `Timer: ${timer}`;
  }
  if (kind === 'start' || kind === 'end') {
    const ev = eventKindOf(el);
    if (ev !== 'none') step.eventKind = ev;
  }

  // Benutzeraufgabe: wer sie bearbeiten darf
  if (kind === 'user') {
    const groups = attr(el, 'candidateGroups');
    if (groups) step.candidateGroups = groups;
    const assignee = attr(el, 'assignee');
    if (assignee) step.assignee = assignee;
  }

  const template = attr(el, 'modelerTemplate');
  if (template) step.serviceId = template;
  const topic = attr(el, 'topic');
  if (topic) step.topic = topic;
  // Entscheidung: die Decision Reference ist der Schlüssel in den DMN-Katalog
  const decisionRef = attr(el, 'decisionRef');
  if (decisionRef && !step.topic) step.topic = decisionRef;
  const called = el.getAttribute('calledElement') ?? attr(el, 'processId');
  if (called) step.calledProcess = called;

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
    if (existing) {
      existing.interrupting = interrupting;
      existing.boundary = true;
      if (side) existing.side = true;
      if (steps?.length) existing.steps = steps;
    } else {
      errors.push({ code, interrupting, boundary: true, ...(side ? { side: true } : {}), ...(steps?.length ? { steps } : {}) });
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

// Hinweise für die Beschriftung einer Schleife (MKK-Muster: ein Timer-Ereignis
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
    // Der Init-Worker ist Verdrahtung, kein fachlicher Schritt: sein Topic ist
    // der Prozess selbst. Er wird nicht beschrieben — seine Ausgaben sind die
    // Felder des `InitIn` und werden hier eingesammelt.
    if (step.kind === 'service' && ctx.processId && step.topic === ctx.processId) {
      ctx.initOutputs = step.outputs ?? [];
      ctx.byId.delete(cur);
      cur = flows[0]?.target ?? null;
      continue;
    }
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

export function importBpmn(xml: string, fileName = 'prozess.bpmn'): ImportResult {
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
  const ctx: BuildCtx = {
    doc, processId, initOutputs: [],
    byId: new Map(), order: [], errors: errorDefs, allNodes: new Map(), succ: new Map(),
  };
  register(ctx, scope);
  let steps = walk(ctx, scope, scope.starts[0] ?? null, new Set(), new Set());
  appendOrphans(ctx, scope, steps);
  const pruned = new Set<string>();
  steps = pruneJoins(steps, pruned);
  steps = fixGotos(steps, ctx, pruned);

  const unreachable = [...ctx.allNodes.entries()]
    .filter(([id]) => !ctx.byId.has(id) && !ctx.order.includes(id))
    .map(([id, name]) => `${name} (${id})`);

  // Prozessname/Projekt aus der ID ableiten: `valiant-mkk-openMkkV1`
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
    status: 'implemented',
    description: '',
    createdAt: todayIso(),
    updatedAt: nowIsoWithTimezone(),
    variables: [],
    ...(attr(proc, 'historyTimeToLive') ? { timeToLive: attr(proc, 'historyTimeToLive') } : {}),
    ...(ctx.initOutputs.length ? { initOutputs: ctx.initOutputs } : {}),
    steps,
  };
  return { spec, stepCount: ctx.byId.size, unreachable };
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
const KEEP_KEYS = ['description', 'notes', 'open', 'candidateGroups', 'assignee'] as const;

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

function applyOld(steps: Step[], old: Map<string, Step>, report: MergeReport, seen: Set<string>) {
  for (const s of steps) {
    seen.add(s.id);
    const prev = old.get(s.id);
    if (!prev) {
      if (s.kind !== 'goto') report.added.push(s.name);
      s.status = 'draft';
    } else {
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
    if (s.children) applyOld(s.children, old, report, seen);
    for (const b of s.branches ?? []) applyOld(b.steps, old, report, seen);
    // Fehler- und Nebenpfade gehören dazu — sonst gehen ihre fachlichen Texte
    // beim erneuten Import verloren und sie gelten fälschlich als entfallen.
    for (const e of s.errors ?? []) if (e.steps) applyOld(e.steps, old, report, seen);
  }
}

export function mergeSpec(fresh: ProcessSpec, previous: ProcessSpec): { spec: ProcessSpec; report: MergeReport } {
  const old = indexSteps(previous.steps, new Map());
  const report: MergeReport = { added: [], removed: [], changed: [], renamed: [], kept: 0 };
  const seen = new Set<string>();
  applyOld(fresh.steps, old, report, seen);
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
    timeToLive: previous.timeToLive ?? fresh.timeToLive,
    status: previous.status === 'draft' ? 'draft' : (report.added.length || report.changed.length || report.removed.length ? 'changed' : previous.status),
    createdAt: previous.createdAt,
    updatedAt: nowIsoWithTimezone(),
  };
  return { spec, report };
}

// ── Hilfen für die Oberfläche ────────────────────────────────────────────────
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
