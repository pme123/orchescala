// Stage B of the AI mode: the structure of a process lives in the BPMN (the tree of the spec is derived
// from it, see BpmnEditor.tsx) - so Claude changes the diagram, with a few operations that keep it
// valid and readable: insert a step on a flow, a decision with branches, an error path on a step,
// remove, rename. The layout follows simply: what comes after the new element moves to the right.
// The details (description, assignment, mappings) stay in the spec - as by hand.
//
// String in, string out: the XML is parsed, changed and written again; an operation that does not fit
// answers with an error and changes nothing.
import type { EngineId, StepKind } from '../types';
import { engineExpression } from '../feelJuel';
import { conventionalId, idPascal } from '../stepIds';
import { appendEl, orderBpmn, removeEl } from '../xmlFormat';

const BPMN_NS = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
const BPMNDI_NS = 'http://www.omg.org/spec/BPMN/20100524/DI';
const DC_NS = 'http://www.omg.org/spec/DD/20100524/DC';
const DI_NS = 'http://www.omg.org/spec/DD/20100524/DI';
const CAMUNDA_NS = 'http://camunda.org/schema/1.0/bpmn';
const ZEEBE_NS = 'http://camunda.org/schema/zeebe/1.0';
const XSI_NS = 'http://www.w3.org/2001/XMLSchema-instance';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';

export type EditResult = { ok: true; xml: string; id: string } | { ok: false; error: string };

/** What Claude may insert as a step. */
export type NewStepKind = 'user' | 'service' | 'manual' | 'end' | 'timer';
export const NEW_STEP_KINDS: NewStepKind[] = ['user', 'service', 'manual', 'end', 'timer'];

const TAG: Record<NewStepKind, string> = {
  user: 'userTask', service: 'serviceTask', manual: 'manualTask', end: 'endEvent', timer: 'intermediateCatchEvent',
};
const SIZE: Record<'task' | 'event' | 'gateway', { w: number; h: number }> = {
  task: { w: 100, h: 80 }, event: { w: 36, h: 36 }, gateway: { w: 50, h: 50 },
};
/** room between two elements */
const GAP = 50;

const local = (el: Element) => (el.localName || el.tagName).split(':').pop() ?? '';
const kids = (el: Element) => Array.from(el.children);
const descendants = (el: Element): Element[] => kids(el).flatMap((c) => [c, ...descendants(c)]);
const num = (el: Element | null | undefined, a: string) => Number(el?.getAttribute(a) ?? 0) || 0;
const first = (el: Element, name: string) => kids(el).find((c) => local(c) === name) ?? null;

const FLOW_NODES = new Set([
  'startEvent', 'endEvent', 'intermediateCatchEvent', 'intermediateThrowEvent', 'boundaryEvent',
  'task', 'serviceTask', 'userTask', 'sendTask', 'receiveTask', 'businessRuleTask', 'scriptTask', 'manualTask',
  'callActivity', 'subProcess', 'exclusiveGateway', 'parallelGateway', 'inclusiveGateway', 'eventBasedGateway',
]);
const ACTIVITIES = new Set(['task', 'serviceTask', 'userTask', 'sendTask', 'receiveTask', 'businessRuleTask', 'scriptTask', 'manualTask', 'callActivity', 'subProcess']);

type Box = { x: number; y: number; w: number; h: number };

/** The parsed diagram with what the operations need. */
class Diagram {
  readonly doc: Document;
  readonly defs: Element;
  readonly byId: Map<string, Element>;
  /** the shape or edge per element */
  readonly di: Map<string, Element>;
  readonly plane: Element | null;
  constructor(readonly xml: string, readonly engine: EngineId) {
    this.doc = new DOMParser().parseFromString(xml, 'text/xml');
    this.defs = this.doc.documentElement;
    const all = descendants(this.defs);
    this.byId = new Map(all.flatMap((e) => (e.getAttribute('id') ? [[e.getAttribute('id')!, e] as const] : [])));
    this.di = new Map(all.filter((e) => ['BPMNShape', 'BPMNEdge'].includes(local(e)) && e.getAttribute('bpmnElement'))
      .map((e) => [e.getAttribute('bpmnElement')!, e] as const));
    this.plane = all.find((e) => local(e) === 'BPMNPlane') ?? null;
  }

  /** The prefix the diagram uses for a namespace - declared if missing. */
  prefix(ns: string, wanted: string): string {
    const attr = Array.from(this.defs.attributes).find((a) => a.name.startsWith('xmlns:') && a.value === ns);
    if (attr) return attr.name.slice(6);
    if (this.defs.getAttribute('xmlns') === ns) return '';
    this.defs.setAttributeNS(XMLNS_NS, `xmlns:${wanted}`, ns);
    return wanted;
  }
  el(ns: string, wanted: string, name: string): Element {
    const p = this.prefix(ns, wanted);
    return this.doc.createElementNS(ns, p ? `${p}:${name}` : name);
  }
  bpmn(name: string) { return this.el(BPMN_NS, 'bpmn', name); }
  /** A type name of the BPMN schema with the prefix of the diagram: `bpmn:tFormalExpression`. */
  qualified(name: string) { const p = this.prefix(BPMN_NS, 'bpmn'); return p ? `${p}:${name}` : name; }

  /** A new, free ID - by the convention of the app (name + suffix), otherwise from the base. */
  newId(base: string, kind?: StepKind, name?: string): string {
    const taken = (id: string) => this.byId.has(id);
    const conventional = kind && name ? conventionalId({ kind, name }, taken) : null;
    const clean = base.replace(/[^\w.-]/g, '_').replace(/^([^A-Za-z_])/, '_$1');
    const id = conventional ?? (taken(clean) ? [...Array(99).keys()].map((i) => `${clean}_${i + 2}`).find((c) => !taken(c))! : clean);
    return id;
  }
  register(el: Element) { this.byId.set(el.getAttribute('id')!, el); }

  flowsFrom(id: string): Element[] {
    return [...this.byId.values()].filter((e) => local(e) === 'sequenceFlow' && e.getAttribute('sourceRef') === id);
  }
  flowsTo(id: string): Element[] {
    return [...this.byId.values()].filter((e) => local(e) === 'sequenceFlow' && e.getAttribute('targetRef') === id);
  }
  boundsOf(id: string): Box | null {
    const b = this.di.get(id) ? first(this.di.get(id)!, 'Bounds') : null;
    return b ? { x: num(b, 'x'), y: num(b, 'y'), w: num(b, 'width'), h: num(b, 'height') } : null;
  }

  shape(id: string, box: Box) {
    if (!this.plane) return;
    const s = this.el(BPMNDI_NS, 'bpmndi', 'BPMNShape');
    s.setAttribute('id', `${id}_di`);
    s.setAttribute('bpmnElement', id);
    const b = this.el(DC_NS, 'dc', 'Bounds');
    (['x', 'y', 'w', 'h'] as const).forEach((k) => b.setAttribute(k === 'w' ? 'width' : k === 'h' ? 'height' : k, String(Math.round(box[k]))));
    s.appendChild(b);
    appendEl(this.plane, s);
    this.di.set(id, s);
  }
  edge(id: string, points: [number, number][]) {
    if (!this.plane) return;
    const e = this.el(BPMNDI_NS, 'bpmndi', 'BPMNEdge');
    e.setAttribute('id', `${id}_di`);
    e.setAttribute('bpmnElement', id);
    points.forEach(([x, y]) => {
      const p = this.el(DI_NS, 'di', 'waypoint');
      p.setAttribute('x', String(Math.round(x)));
      p.setAttribute('y', String(Math.round(y)));
      e.appendChild(p);
    });
    appendEl(this.plane, e);
    this.di.set(id, e);
  }
  waypoints(flowId: string): Element[] {
    const e = this.di.get(flowId);
    return e ? kids(e).filter((c) => local(c) === 'waypoint') : [];
  }

  /** Room for something new at x: everything from x on moves right by dx - containers that span x grow. */
  makeRoom(x: number, dx: number, except: Set<string> = new Set()) {
    if (!this.plane) return;
    for (const di of kids(this.plane)) {
      const id = di.getAttribute('bpmnElement') ?? '';
      if (except.has(id)) continue;
      if (local(di) === 'BPMNShape') {
        const b = first(di, 'Bounds');
        if (!b) continue;
        const bx = num(b, 'x');
        if (bx >= x) descendants(di).filter((c) => local(c) === 'Bounds').forEach((c) => c.setAttribute('x', String(num(c, 'x') + dx)));
        else if (bx + num(b, 'width') > x) b.setAttribute('width', String(num(b, 'width') + dx));
      } else if (local(di) === 'BPMNEdge') {
        descendants(di).filter((c) => (local(c) === 'waypoint' || local(c) === 'Bounds') && num(c, 'x') >= x)
          .forEach((c) => c.setAttribute('x', String(num(c, 'x') + dx)));
      }
    }
  }

  /** The pool or lane around an element grows downwards when something new is below its edge. */
  growDown(bottom: number) {
    if (!this.plane) return;
    for (const di of kids(this.plane)) {
      const el = this.byId.get(di.getAttribute('bpmnElement') ?? '');
      if (!el || !['participant', 'lane'].includes(local(el))) continue;
      const b = first(di, 'Bounds');
      if (b && num(b, 'y') + num(b, 'height') < bottom + 30) b.setAttribute('height', String(bottom + 30 - num(b, 'y')));
    }
  }

  /** A sequence flow from `from` to `to` (both in `container`), with its edge. */
  flow(container: Element, from: string, to: string, points: [number, number][], label?: string): Element {
    const f = this.bpmn('sequenceFlow');
    f.setAttribute('id', this.newId(`Flow_${from}_${to}`));
    f.setAttribute('sourceRef', from);
    f.setAttribute('targetRef', to);
    if (label) f.setAttribute('name', label);
    appendEl(container, f);
    this.register(f);
    this.link(from, 'outgoing', f.getAttribute('id')!);
    this.link(to, 'incoming', f.getAttribute('id')!);
    this.edge(f.getAttribute('id')!, points);
    return f;
  }
  link(nodeId: string, kind: 'incoming' | 'outgoing', flowId: string) {
    const node = this.byId.get(nodeId);
    if (!node) return;
    const ref = this.bpmn(kind);
    ref.textContent = flowId;
    const after = kids(node).filter((c) => ['documentation', 'extensionElements', 'incoming', ...(kind === 'outgoing' ? ['outgoing'] : [])].includes(local(c))).pop();
    if (after) node.insertBefore(ref, after.nextSibling);
    else node.insertBefore(ref, node.firstChild);
  }
  unlink(nodeId: string, flowId: string) {
    const node = this.byId.get(nodeId);
    node && kids(node).filter((c) => ['incoming', 'outgoing'].includes(local(c)) && (c.textContent ?? '').trim() === flowId).forEach((c) => removeEl(c));
  }
  /** A lane that holds `id` also holds the new element. */
  sameLane(id: string, newId: string) {
    const lane = [...this.byId.values()].find((e) => local(e) === 'lane' && kids(e).some((c) => local(c) === 'flowNodeRef' && (c.textContent ?? '').trim() === id));
    if (!lane) return;
    const ref = this.bpmn('flowNodeRef');
    ref.textContent = newId;
    appendEl(lane, ref);
  }
  /** A condition on a flow - FEEL, written in the form of the engine (as the export does). */
  condition(flow: Element, feel: string) {
    const body = feel.trim().replace(/^=\s*/, '');
    if (!body) return;
    const c = this.bpmn('conditionExpression');
    c.setAttributeNS(XSI_NS, `${this.prefix(XSI_NS, 'xsi')}:type`, this.qualified('tFormalExpression'));
    c.textContent = engineExpression(`=${body}`, this.engine).text;
    appendEl(flow, c);
  }
  remove(id: string) {
    const el = this.byId.get(id);
    if (el) removeEl(el);
    const di = this.di.get(id);
    if (di) removeEl(di);
    this.byId.delete(id);
    this.di.delete(id);
  }

  write(): string {
    orderBpmn(this.doc);
    const out = new XMLSerializer().serializeToString(this.doc);
    const decl = /^<\?xml[^>]*\?>/.exec(this.xml)?.[0];
    return decl && !out.startsWith('<?xml') ? `${decl}\n${out}` : out;
  }
}

const sizeOf = (tag: string) => (tag.endsWith('Gateway') ? SIZE.gateway : tag.endsWith('Event') ? SIZE.event : SIZE.task);

/** The flow out of `after` that the new element goes on: the only one, or the branch named. */
function pickFlow(d: Diagram, after: string, branch?: string): Element | string {
  const node = d.byId.get(after);
  if (!node || !FLOW_NODES.has(local(node))) return `Ein Element «${after}» gibt es im Diagramm nicht.`;
  const out = d.flowsFrom(after);
  if (!out.length) return `«${node.getAttribute('name') || after}» hat keinen Ausgang – füge den Schritt vor dem Ende ein.`;
  const label = (f: Element) => f.getAttribute('name') || `→ ${f.getAttribute('targetRef')}`;
  if (branch) {
    const f = out.find((x) => x.getAttribute('name') === branch || x.getAttribute('id') === branch || x.getAttribute('targetRef') === branch);
    return f ?? `«${after}» hat keinen Zweig «${branch}». Zweige: ${out.map(label).join(', ')}`;
  }
  return out.length === 1 ? out[0] : `«${after}» hat mehrere Ausgänge – gib den Zweig an: ${out.map(label).join(', ')}`;
}

/** Puts a new element on the flow `flow` (A → T): A → new → T. The new one takes the place of T, T and
  * everything after it moves right. Returns the new element and the flow new → T. */
function onFlow(d: Diagram, flow: Element, node: Element): { node: Element; out: Element } {
  const target = flow.getAttribute('targetRef')!;
  const id = node.getAttribute('id')!;
  const container = d.byId.get(target)!.parentElement!;
  appendEl(container, node);
  d.register(node);
  d.sameLane(target, id);
  // the flow A → T now ends at the new one
  flow.setAttribute('targetRef', id);
  d.unlink(target, flow.getAttribute('id')!);
  d.link(id, 'incoming', flow.getAttribute('id')!);
  const size = sizeOf(local(node));
  const t = d.boundsOf(target);
  if (!t) {
    return { node, out: d.flow(container, id, target, []) };
  }
  const cy = t.y + t.h / 2;
  const box = { x: t.x, y: cy - size.h / 2, w: size.w, h: size.h };
  d.makeRoom(t.x, size.w + GAP, new Set([flow.getAttribute('id')!]));
  d.shape(id, box);
  // the last point of A → T: onto the new one - from the side or from above/below like before
  const pts = d.waypoints(flow.getAttribute('id')!);
  const last = pts[pts.length - 1];
  const before = pts[pts.length - 2];
  if (last) {
    const vertical = before && num(before, 'x') === num(last, 'x');
    if (vertical) {
      const x = box.x + box.w / 2;
      before.setAttribute('x', String(Math.round(x)));
      last.setAttribute('x', String(Math.round(x)));
      last.setAttribute('y', String(Math.round(num(before, 'y') < cy ? box.y : box.y + box.h)));
    } else {
      last.setAttribute('x', String(Math.round(box.x)));
      last.setAttribute('y', String(Math.round(cy)));
    }
  }
  const out = d.flow(container, id, target, [[box.x + box.w, cy], [t.x + size.w + GAP, cy]]);
  return { node, out };
}

/** Inserts a step after `after` - on its only outgoing flow or on the branch named. */
export function insertStep(xml: string, engine: EngineId, after: string, step: { kind: NewStepKind; name: string; topic?: string; timer?: string }, branch?: string): EditResult {
  const d = new Diagram(xml, engine);
  const flow = pickFlow(d, after, branch);
  if (typeof flow === 'string') return { ok: false, error: flow };
  if (!step.name.trim()) return { ok: false, error: 'Der Schritt braucht einen Namen.' };
  // an end only where an end is: it gets the name - mid-flow it would cut off the rest
  const target = flow.getAttribute('targetRef')!;
  if (step.kind === 'end') {
    const old = d.byId.get(target)!;
    if (local(old) !== 'endEvent') return { ok: false, error: 'Ein Ende mitten im Ablauf schneidet den Rest ab – ein Ende kommt an den Schluss eines Zweigs oder Fehlerpfads.' };
    old.setAttribute('name', step.name.trim());
    return { ok: true, xml: d.write(), id: target };
  }
  if (step.kind === 'service' && !step.topic?.trim()) return { ok: false, error: 'Ein Service-Schritt braucht das Topic eines Workers aus dem Datenmodell.' };
  const tag = TAG[step.kind];
  const node = d.bpmn(tag);
  const kind: StepKind = step.kind === 'timer' ? 'event' : step.kind;
  node.setAttribute('id', d.newId(step.kind === 'timer' ? `${idPascal(step.name) || 'Wait'}TimerEvent` : `${tag}_${step.name}`, kind === 'event' ? undefined : kind, step.name));
  node.setAttribute('name', step.name.trim());
  if (step.kind === 'service') {
    if (engine === 'c8') {
      const ext = d.bpmn('extensionElements');
      const def = d.el(ZEEBE_NS, 'zeebe', 'taskDefinition');
      def.setAttribute('type', step.topic!.trim());
      ext.appendChild(def);
      node.appendChild(ext);
    } else {
      const p = d.prefix(CAMUNDA_NS, 'camunda');
      node.setAttributeNS(CAMUNDA_NS, `${p}:type`, 'external');
      node.setAttributeNS(CAMUNDA_NS, `${p}:topic`, step.topic!.trim());
    }
  }
  if (step.kind === 'timer') {
    const def = d.bpmn('timerEventDefinition');
    def.setAttribute('id', d.newId(`TimerEventDefinition_${node.getAttribute('id')}`));
    const dur = d.bpmn('timeDuration');
    dur.setAttributeNS(XSI_NS, `${d.prefix(XSI_NS, 'xsi')}:type`, d.qualified('tFormalExpression'));
    dur.textContent = step.timer?.trim() || 'PT1H';
    def.appendChild(dur);
    node.appendChild(def);
  }
  onFlow(d, flow, node);
  return { ok: true, xml: d.write(), id: node.getAttribute('id')! };
}

export type BranchSpec = { label: string; condition?: string; isDefault?: boolean };

/** Inserts a decision (exclusive gateway) after `after`. The first branch goes on to what came after
  * `after`; every further branch ends in an end event of its own - steps go in with insertStep(gateway, branch). */
export function insertDecision(xml: string, engine: EngineId, after: string, name: string, branches: BranchSpec[], branch?: string): EditResult {
  if (branches.length < 2) return { ok: false, error: 'Ein Entscheid braucht mindestens zwei Zweige.' };
  if (branches.filter((b) => b.isDefault).length > 1) return { ok: false, error: 'Nur ein Zweig kann der Standard sein.' };
  const missing = branches.find((b) => !b.isDefault && !b.condition?.trim());
  if (missing) return { ok: false, error: `Der Zweig «${missing.label}» braucht eine Bedingung (FEEL) – oder ist der Standard.` };
  if (new Set(branches.map((b) => b.label)).size !== branches.length) return { ok: false, error: 'Die Zweige brauchen verschiedene Namen.' };
  const d = new Diagram(xml, engine);
  const flow = pickFlow(d, after, branch);
  if (typeof flow === 'string') return { ok: false, error: flow };
  const gw = d.bpmn('exclusiveGateway');
  gw.setAttribute('id', d.newId(`Gateway_${name}`, 'gateway', name));
  gw.setAttribute('name', name.trim());
  const { out } = onFlow(d, flow, gw);
  const id = gw.getAttribute('id')!;
  const container = gw.parentElement!;
  const g = d.boundsOf(id);
  const mark = (f: Element, b: BranchSpec) => {
    f.setAttribute('name', b.label);
    if (b.isDefault) gw.setAttribute('default', f.getAttribute('id')!);
    else d.condition(f, b.condition!);
  };
  mark(out, branches[0]);
  branches.slice(1).forEach((b, i) => {
    const end = d.bpmn('endEvent');
    end.setAttribute('id', d.newId(`EndEvent_${b.label}`, 'end', `${b.label}`));
    end.setAttribute('name', b.label);
    appendEl(container, end);
    d.register(end);
    d.sameLane(id, end.getAttribute('id')!);
    const ex = g ? g.x + g.w + GAP + 80 : 0;
    const ey = g ? g.y + g.h / 2 + 110 * (i + 1) : 0;
    if (g) {
      d.shape(end.getAttribute('id')!, { x: ex, y: ey - 18, w: 36, h: 36 });
      d.growDown(ey + 18);
    }
    const f = d.flow(container, id, end.getAttribute('id')!, g ? [[g.x + g.w / 2, g.y + g.h], [g.x + g.w / 2, ey], [ex, ey]] : []);
    mark(f, b);
  });
  return { ok: true, xml: d.write(), id };
}

/** An error path on a step: a boundary error event with the error code, to an end of its own. Steps
  * go in with insertStep(boundary event). */
export function insertErrorPath(xml: string, engine: EngineId, stepId: string, code: string, name: string): EditResult {
  const d = new Diagram(xml, engine);
  const step = d.byId.get(stepId);
  if (!step || !ACTIVITIES.has(local(step))) return { ok: false, error: `Einen Schritt «${stepId}» (Task, Subprozess) gibt es im Diagramm nicht.` };
  const errCode = code.trim();
  if (!/^[\w.-]+$/.test(errCode)) return { ok: false, error: `«${code}» ist kein Fehler-Code (Buchstaben, Ziffern, - . _).` };
  const others = [...d.byId.values()].filter((e) => local(e) === 'boundaryEvent' && e.getAttribute('attachedToRef') === stepId);
  // the error once in the definitions - one with the same code is reused
  const existing = [...d.byId.values()].find((e) => local(e) === 'error' && e.getAttribute('errorCode') === errCode);
  const error = existing ?? (() => {
    const e = d.bpmn('error');
    e.setAttribute('id', d.newId(`Error_${errCode}`));
    e.setAttribute('name', errCode);
    e.setAttribute('errorCode', errCode);
    const proc = kids(d.defs).find((c) => ['process', 'collaboration'].includes(local(c)));
    d.defs.insertBefore(e, proc ?? null);
    d.defs.insertBefore(d.doc.createTextNode('\n  '), proc ?? null);
    d.register(e);
    return e;
  })();
  const container = step.parentElement!;
  const be = d.bpmn('boundaryEvent');
  be.setAttribute('id', d.newId(`${idPascal(name.trim() || errCode) || 'Error'}BoundaryEvent`));
  // the name of the boundary event is the error code (Orchescala, see importBpmn) - the readable name goes to the end
  be.setAttribute('name', errCode);
  be.setAttribute('attachedToRef', stepId);
  const def = d.bpmn('errorEventDefinition');
  def.setAttribute('id', d.newId(`ErrorEventDefinition_${be.getAttribute('id')}`));
  def.setAttribute('errorRef', error.getAttribute('id')!);
  be.appendChild(def);
  appendEl(container, be);
  d.register(be);
  const end = d.bpmn('endEvent');
  end.setAttribute('id', d.newId(`EndEvent_${name}`, 'end', name.trim() || errCode));
  end.setAttribute('name', name.trim() || errCode);
  appendEl(container, end);
  d.register(end);
  d.sameLane(stepId, end.getAttribute('id')!);
  const s = d.boundsOf(stepId);
  const bx = s ? s.x + s.w - 28 - 40 * others.length : 0;
  const by = s ? s.y + s.h - 18 : 0;
  const ey = by + 36 + 60 + 40 * others.length;
  const ex = s ? s.x + s.w + GAP : 0;
  if (s) {
    d.shape(be.getAttribute('id')!, { x: bx, y: by, w: 36, h: 36 });
    d.shape(end.getAttribute('id')!, { x: ex, y: ey - 18, w: 36, h: 36 });
    d.growDown(ey + 18);
  }
  d.flow(container, be.getAttribute('id')!, end.getAttribute('id')!, s ? [[bx + 18, by + 36], [bx + 18, ey], [ex, ey]] : []);
  return { ok: true, xml: d.write(), id: be.getAttribute('id')! };
}

/** Removes a step with one way in and one way out (the flow closes), or an error path (a boundary
  * event with what only it reaches). A decision is removed in the diagram. */
export function removeStep(xml: string, engine: EngineId, id: string): EditResult {
  const d = new Diagram(xml, engine);
  const node = d.byId.get(id);
  if (!node || !FLOW_NODES.has(local(node))) return { ok: false, error: `Ein Element «${id}» gibt es im Diagramm nicht.` };
  if (local(node) === 'boundaryEvent') {
    // the path of the boundary event - as long as nothing else leads into it
    const reach = (from: string, seen: Set<string>): Set<string> => d.flowsFrom(from).map((f) => f.getAttribute('targetRef')!)
      .filter((t) => !seen.has(t)).reduce((acc, t) => reach(t, new Set([...acc, t])), seen);
    const path = reach(id, new Set([id]));
    const foreign = [...path].filter((n) => n !== id).find((n) => d.flowsTo(n).some((f) => !path.has(f.getAttribute('sourceRef')!)));
    if (foreign) return { ok: false, error: `Der Pfad von «${id}» läuft in «${foreign}» weiter – im Diagramm entfernen.` };
    const flows = [...d.byId.values()].filter((e) => local(e) === 'sequenceFlow' && path.has(e.getAttribute('sourceRef')!));
    flows.forEach((f) => d.remove(f.getAttribute('id')!));
    path.forEach((n) => d.remove(n));
    return { ok: true, xml: d.write(), id };
  }
  if (local(node).endsWith('Gateway')) return { ok: false, error: 'Einen Entscheid mit seinen Zweigen entfernt man im Diagramm.' };
  if ([...d.byId.values()].some((e) => local(e) === 'boundaryEvent' && e.getAttribute('attachedToRef') === id))
    return { ok: false, error: `«${id}» hat Fehlerpfade – zuerst diese entfernen.` };
  const ins = d.flowsTo(id);
  const outs = d.flowsFrom(id);
  if (ins.length !== 1 || outs.length !== 1) return { ok: false, error: `«${id}» hat ${ins.length} Eingänge und ${outs.length} Ausgänge – so nur im Diagramm.` };
  const [inFlow] = ins;
  const [outFlow] = outs;
  const target = outFlow.getAttribute('targetRef')!;
  inFlow.setAttribute('targetRef', target);
  d.unlink(target, outFlow.getAttribute('id')!);
  d.link(target, 'incoming', inFlow.getAttribute('id')!);
  // the edge ends where the removed one ended
  const tail = d.waypoints(outFlow.getAttribute('id')!).pop();
  const last = d.waypoints(inFlow.getAttribute('id')!).pop();
  if (tail && last) { last.setAttribute('x', tail.getAttribute('x')!); last.setAttribute('y', tail.getAttribute('y')!); }
  d.remove(outFlow.getAttribute('id')!);
  [...d.byId.values()].filter((e) => local(e) === 'lane').forEach((lane) =>
    kids(lane).filter((c) => local(c) === 'flowNodeRef' && (c.textContent ?? '').trim() === id).forEach((c) => removeEl(c)));
  d.remove(id);
  return { ok: true, xml: d.write(), id };
}

/** Renames an element of the diagram (a step, an event, a branch). */
export function renameElement(xml: string, engine: EngineId, id: string, name: string): EditResult {
  const d = new Diagram(xml, engine);
  const el = d.byId.get(id);
  if (!el || !(FLOW_NODES.has(local(el)) || local(el) === 'sequenceFlow')) return { ok: false, error: `Ein Element «${id}» gibt es im Diagramm nicht.` };
  if (!name.trim()) return { ok: false, error: 'Der Name ist leer.' };
  el.setAttribute('name', name.trim());
  return { ok: true, xml: d.write(), id };
}
