// A service orchestration: one worker that calls service workers.
//
// The flow is a BPMN like the one of a process — edited with the same modeler and read
// with the same import (`importBpmn`). Allowed are what a worker can run in one go:
// service tasks (a service of a collection), script tasks (FEEL assignments), parallel
// and exclusive gateways. What a task does is in `tasks` (per BPMN element ID); the
// conditions of an exclusive gateway in `conditions` (per sequence flow).
//
// In Orchescala this is a CustomTask (`CompanyBpmnCustomTaskDsl`) and its CustomWorker —
// see scalaOrchestration.ts.
import { importBpmn, isEventBoundary } from '../bpmn.ts';
import type { Branch, Field, Mapping, Step, TypeDef } from '../types';
import { nowIsoWithTimezone, slugify, uid } from '../util.ts';
import { apiOf, collectionPackage, membersOf, serviceTopic, workerPackage, type ApiRef } from './collection.ts';
import { lowerFirst } from './names.ts';
import type { CollectionService, OrchTask, ServiceCollectionSpec, ServiceOrchestrationSpec } from './types';
import { fieldAccess, type CaseAccess } from '../scala.ts';

/** In and Out belong to the orchestration — not to the types of the API. */
export const ORCH_MEMBER = 'orchestration';

const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/** A first flow: start → one service task → end. */
export function orchestrationBpmn(processId: string, title: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_${processId}" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="${escapeXml(processId)}" name="${escapeXml(title)}" isExecutable="false">
    <bpmn:startEvent id="StartEvent" name="Start">
      <bpmn:outgoing>Flow_1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:serviceTask id="CallService" name="Service aufrufen">
      <bpmn:incoming>Flow_1</bpmn:incoming>
      <bpmn:outgoing>Flow_2</bpmn:outgoing>
    </bpmn:serviceTask>
    <bpmn:endEvent id="EndEvent" name="Ende">
      <bpmn:incoming>Flow_2</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="StartEvent" targetRef="CallService" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="CallService" targetRef="EndEvent" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_1">
    <bpmndi:BPMNPlane id="Plane_1" bpmnElement="${escapeXml(processId)}">
      <bpmndi:BPMNShape id="StartEvent_di" bpmnElement="StartEvent"><dc:Bounds x="152" y="102" width="36" height="36" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="CallService_di" bpmnElement="CallService"><dc:Bounds x="240" y="80" width="100" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="EndEvent_di" bpmnElement="EndEvent"><dc:Bounds x="392" y="102" width="36" height="36" /></bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1"><di:waypoint x="188" y="120" /><di:waypoint x="240" y="120" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_2_di" bpmnElement="Flow_2"><di:waypoint x="340" y="120" /><di:waypoint x="392" y="120" /></bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
`;
}

/** The API of the orchestration — where its CustomTask and worker live. */
export const orchestrationApi = (o: Pick<ServiceOrchestrationSpec, 'project' | 'api' | 'apiVersion'>): ApiRef =>
  ({ project: o.project, api: o.api, apiVersion: o.apiVersion });

/** `acme-crm-clientV1.UpdateClient` */
export const orchestrationTopic = (o: Pick<ServiceOrchestrationSpec, 'project' | 'api' | 'apiVersion' | 'name'>): string =>
  serviceTopic(orchestrationApi(o), { name: o.name });

/** A new orchestration: In and Out empty, a first flow with one service task. */
export function newOrchestration(input: { title: string; project: string; api: string; apiVersion: number; name: string }): ServiceOrchestrationSpec {
  const now = nowIsoWithTimezone();
  const inType: TypeDef = { id: uid('t'), name: 'In', kind: 'case', status: 'draft', interactionId: ORCH_MEMBER, fields: [] };
  const outType: TypeDef = { id: uid('t'), name: 'Out', kind: 'case', status: 'draft', interactionId: ORCH_MEMBER, fields: [] };
  return {
    kind: 'serviceOrchestration', version: 1,
    slug: slugify(`${input.project}-${input.name}`),
    title: input.title, project: input.project, api: input.api, apiVersion: input.apiVersion, name: input.name,
    status: 'draft', createdAt: now, updatedAt: now,
    bpmn: orchestrationBpmn(`${input.project}-${input.api}V${input.apiVersion}-${input.name}`, input.title),
    tasks: {}, types: [inType, outType], inTypeId: inType.id, outTypeId: outType.id,
  };
}

// ── the flow ────────────────────────────────────────────────────────────────

export interface Flow {
  steps: Step[];
  /** the BPMN is not readable */
  error?: string;
}

/** The flow from the BPMN — the same import as for a process. */
export function flowOf(o: Pick<ServiceOrchestrationSpec, 'bpmn' | 'steps'>): Flow {
  if (o.steps) return { steps: o.steps };
  try {
    return { steps: importBpmn(o.bpmn, 'orchestrierung.bpmn').spec.steps };
  } catch (e) {
    return { steps: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/** Every step of the flow, branches included, in order. */
export function flatSteps(steps: Step[], out: Step[] = []): Step[] {
  for (const s of steps) {
    out.push(s);
    for (const b of s.branches ?? []) flatSteps(b.steps, out);
    flatSteps(s.children ?? [], out);
  }
  return out;
}

/** What the flow may contain — what a worker runs in one go. */
export function flowIssues(steps: Step[]): Array<{ stepId: string; text: string }> {
  const out: Array<{ stepId: string; text: string }> = [];
  for (const s of flatSteps(steps)) {
    const name = s.name || s.id;
    if (s.kind === 'gateway') {
      if (s.gatewayType !== 'parallel' && s.gatewayType !== 'exclusive') out.push({ stepId: s.id, text: `«${name}»: nur parallele und exklusive Gateways.` });
    } else if (!['start', 'end', 'service', 'script'].includes(s.kind)) {
      out.push({ stepId: s.id, text: `«${name}» (${s.kind}): eine Orchestrierung kennt nur Service- und Script-Tasks.` });
    }
    if (s.loop || s.multiInstance) out.push({ stepId: s.id, text: `«${name}»: Schleifen gibt es in einer Orchestrierung nicht.` });
    // a boundary error is described as in a process — the worker handles it in code (a TODO in the export)
    if ((s.errors ?? []).some(e => !e.side && !e.timer && !isEventBoundary(e))) out.push({ stepId: s.id, text: `«${name}»: Fehlerpfad — im Export ein TODO, der Worker behandelt den Fehler im Code.` });
    if ((s.errors ?? []).some(e => e.side || e.timer || isEventBoundary(e))) out.push({ stepId: s.id, text: `«${name}»: Timer und Ereignisse am Rand gibt es in einem Worker nicht.` });
  }
  return out;
}

// ── the services it can call ────────────────────────────────────────────────

/** A service of a collection — with the collection for its package and types. */
export interface ServiceRef {
  topic: string;
  collection: ServiceCollectionSpec;
  service: CollectionService;
}

/** All services of the collections, by topic. */
export function servicesByTopic(collections: ServiceCollectionSpec[]): Map<string, ServiceRef> {
  const out = new Map<string, ServiceRef>();
  for (const collection of collections) {
    for (const service of collection.services) {
      if (!service.name.trim()) continue;
      const topic = serviceTopic(apiOf(collection, service), service);
      if (!out.has(topic)) out.set(topic, { topic, collection, service });
    }
  }
  return out;
}

/** Domain and worker package of a service — `acme.crm.domain.client.v1`, `acme.crm.worker.client.v1`. */
export const servicePackages = (ref: ServiceRef) => {
  const api = apiOf(ref.collection, ref.service);
  return { domain: collectionPackage(api), worker: workerPackage(api) };
};

/** In and Out of a called service. */
export const serviceMembers = (ref: ServiceRef) => membersOf(ref.collection, ref.service);

/** The name of a service task's result — its own or the service name (`getClient`). */
export const resultName = (task: OrchTask | undefined, ref: ServiceRef | undefined): string =>
  task?.result?.trim() || (ref ? lowerFirst(ref.service.name) : 'result');

/** All types the mappings may reach: the orchestration's and those of the collections it calls. */
export function allTypes(o: ServiceOrchestrationSpec, collections: ServiceCollectionSpec[]): TypeDef[] {
  const seen = new Set(o.types.map(t => t.id));
  return [...o.types, ...collections.flatMap(c => c.types).filter(t => !seen.has(t.id) && (seen.add(t.id), true))];
}

// ── what is known where ─────────────────────────────────────────────────────

/** A value a mapping can read: a field of the In, a result of a service, a script variable. */
export interface OrchVar {
  name: string;
  /** `in.clientKey`, `getClient` */
  scala: string;
  type: string;
  collection?: boolean;
  optional?: boolean;
  source: 'In' | 'Service' | 'Script';
  /** a field of some cases of an ADT In — case by case (see `CaseAccess`) */
  byCase?: CaseAccess;
}

/**
 * What the steps produce, in order: the result of each service task (if its service has an
 * Out) and each script assignment. Inside an exclusive branch it is known there; after the
 * gateway it is optional — the branch may not have run.
 */
export function producedBy(steps: Step[], o: ServiceOrchestrationSpec, services: Map<string, ServiceRef>): OrchVar[] {
  const out: OrchVar[] = [];
  for (const s of steps) {
    const task = o.tasks[s.id];
    if (s.kind === 'service' && task?.service) {
      const ref = services.get(task.service);
      const outType = ref ? serviceMembers(ref).out : undefined;
      if (task.outputs) out.push(...outputVars(task.outputs, ref && !ref.service.noOut ? outType : undefined));
      else if (ref && !ref.service.noOut && outType) out.push({ name: resultName(task, ref), scala: resultName(task, ref), type: outType.id, source: 'Service' });
    } else if (s.kind === 'script') {
      for (const a of task?.assignments ?? []) if (a.name.trim()) out.push({ name: a.name.trim(), scala: a.name.trim(), type: 'String', source: 'Script' });
    } else if (s.kind === 'gateway') {
      const inner = (s.branches ?? []).flatMap(b => producedBy(b.steps, o, services));
      const exclusive = s.gatewayType === 'exclusive';
      for (const v of inner) if (!out.some(x => x.name === v.name)) out.push(exclusive ? { ...v, optional: true } : v);
    }
  }
  return out;
}

/** The variables a service task sets as a process describes it: per enabled output, typed by the `Out` field it reads. */
export function outputVars(outputs: Mapping[], outType: TypeDef | undefined): OrchVar[] {
  return outputs.filter(m => !m.disabled && m.name.trim()).map(m => {
    const read = /^=\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(m.expression.trim())?.[1];
    const f = read ? (outType?.fields ?? []).find(x => x.name === read) : undefined;
    const name = m.name.trim();
    return {
      name, scala: name, type: f?.type ?? 'String', source: 'Service' as const,
      ...(f?.collection ? { collection: true } : {}), ...(f?.optional ? { optional: true } : {}),
    };
  });
}

/** The fields of the In — `in.clientKey`; of an ADT also those of its cases (through a match). */
export function inVars(o: ServiceOrchestrationSpec): OrchVar[] {
  if (o.noIn) return [];
  const inType = o.types.find(t => t.id === o.inTypeId);
  return fieldAccess(inType).map(({ field: f, scala, optional, byCase }) => ({
    name: f.name, scala, type: f.type, source: 'In' as const,
    ...(f.collection ? { collection: true } : {}), ...(optional ? { optional: true } : {}),
    ...(byCase ? { byCase } : {}),
  }));
}

/**
 * What is known before a step (or at the end, without `stepId`): the In, then what the steps
 * before it produced — on its level, and on the levels around it up to its branch.
 */
export function varsAt(o: ServiceOrchestrationSpec, steps: Step[], services: Map<string, ServiceRef>, stepId?: string): OrchVar[] {
  const found = (list: Step[], acc: OrchVar[]): OrchVar[] | null => {
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (s.id === stepId) return [...acc, ...producedBy(list.slice(0, i), o, services)];
      for (const b of s.branches ?? []) {
        const inner = found(b.steps, [...acc, ...producedBy(list.slice(0, i), o, services)]);
        if (inner) return inner;
      }
    }
    return null;
  };
  const before = stepId ? found(steps, []) : producedBy(steps, o, services);
  const vars = [...inVars(o), ...(before ?? [])];
  // a later one of the same name wins
  return vars.filter((v, i) => !vars.slice(i + 1).some(x => x.name === v.name));
}

/** The variables as fields — for the FEEL check of the app. */
export const varFields = (vars: OrchVar[]): Field[] =>
  vars.map(v => ({ id: `v-${v.name}`, name: v.name, type: v.type, ...(v.collection ? { collection: true } : {}), ...(v.optional ? { optional: true } : {}) }));

// ── exclusive gateways ──────────────────────────────────────────────────────

/** The condition of a branch: from the orchestration, otherwise from the BPMN. */
export const conditionOf = (o: Pick<ServiceOrchestrationSpec, 'conditions'>, b: Branch): string =>
  (o.conditions?.[b.id] ?? b.condition ?? '').trim();

/** The `else` of an exclusive gateway: the default flow — or the one branch without a condition. */
export function elseBranch(o: Pick<ServiceOrchestrationSpec, 'conditions'>, gateway: Step): Branch | undefined {
  const branches = gateway.branches ?? [];
  const open = branches.filter(b => !b.isDefault && !conditionOf(o, b));
  return branches.find(b => b.isDefault) ?? (open.length === 1 ? open[0] : undefined);
}

// ── findings ────────────────────────────────────────────────────────────────

/** What is missing in the orchestration — the export still works, with TODOs. */
export function orchestrationIssues(o: ServiceOrchestrationSpec, services: Map<string, ServiceRef>): string[] {
  const out: string[] = [];
  if (!/^[A-Z][A-Za-z0-9]*$/.test(o.name)) out.push(`«${o.name}» ist kein Scala-Objektname (gross, ohne Sonderzeichen).`);
  const flow = flowOf(o);
  if (flow.error) return [...out, `Das BPMN ist nicht lesbar: ${flow.error}`];
  out.push(...flowIssues(flow.steps).map(i => i.text));
  for (const s of flatSteps(flow.steps)) {
    const task = o.tasks[s.id];
    if (s.kind === 'service') {
      if (!task?.service) out.push(`«${s.name || s.id}»: kein Service gewählt.`);
      else if (!services.has(task.service)) out.push(`«${s.name || s.id}»: den Service ${task.service} gibt es in keiner Collection.`);
    }
    if (s.kind === 'script' && !(task?.assignments ?? []).some(a => a.name.trim())) out.push(`«${s.name || s.id}»: keine Zuweisung.`);
    if (s.kind === 'gateway' && s.gatewayType === 'exclusive') {
      const fallback = elseBranch(o, s);
      for (const b of s.branches ?? []) {
        if (b !== fallback && !conditionOf(o, b)) out.push(`«${s.name || s.id}» → «${b.label || b.id}»: keine Bedingung.`);
      }
    }
  }
  return out;
}
