// A service orchestration as a process: the process editor in «service mode».
//
// A process whose `service` is set is one CustomWorker that calls service workers — the same
// tree, diagram, data model, comments and patterns as any process, but only what a worker runs
// in one go: service and script tasks, parallel and exclusive gateways. Mappings are described
// as in a process (inputs per field of the service's `In`, outputs per variable afterwards);
// the export turns them into Scala (see scalaOrchestration.ts, fed by `asOrchestration`).
//
// The services it can call: those of the catalog and those of the collections in `services/`
// — the collections as the project would have them, read from their generated Scala, so the
// step shows their `In` and `Out` with the real types (local wins over the catalog).
import { scanScala } from '../domainScan';
import { importBpmn, withStatus } from '../bpmn';
import type { Branch, DomainType, Field, Mapping, Model, ProcessSpec, ServiceMode, ServiceParam, Step, TypeDef } from '../types';
import { nowIsoWithTimezone, slugify, uid } from '../util';
import { catalogProjects, collectionFromCatalog, withProjectDomain } from './catalogCollections';
import { ORCH_MEMBER, flatSteps, orchestrationBpmn, orchestrationTopic, serviceMembers, servicesByTopic, type ServiceRef } from './orchestration';
import { collectionFiles } from './scalaCollection';
import type { OrchTask, ServiceCollectionSpec, ServiceOrchestrationSpec } from './types';

/** A process in service mode — with its project. */
export type ServiceProcess = ProcessSpec & { service: ServiceMode; project: string };

export const isServiceProcess = (spec: ProcessSpec | null | undefined): spec is ServiceProcess =>
  !!spec?.service && !!spec.project;

/** Where the CustomTask lives — project, API, version and name. */
export const serviceProcessRef = (spec: ServiceProcess) =>
  ({ project: spec.project, api: spec.service.api, apiVersion: spec.service.apiVersion, name: spec.service.name });

/** `acme-crm-clientV1.UpdateClient` */
export const serviceProcessTopic = (spec: ServiceProcess): string => orchestrationTopic(serviceProcessRef(spec));

/** The id of its BPMN process — `acme-crm-clientV1-UpdateClient`. */
export const serviceProcessId = (r: { project: string; api: string; apiVersion: number; name: string }): string =>
  `${r.project}-${r.api}V${r.apiVersion}-${r.name}`;

/** A new orchestration: In and Out empty, a first flow start → one service task → end. */
export function newServiceProcess(input: { title: string; project: string; api: string; apiVersion: number; name: string }): { spec: ServiceProcess; xml: string } {
  const processId = serviceProcessId(input);
  const xml = orchestrationBpmn(processId, input.title);
  const slug = slugify(processId);
  // a new flow is not implemented yet — on all levels
  const spec = withStatus(importBpmn(xml, `${slug}.bpmn`).spec, 'draft');
  const now = nowIsoWithTimezone();
  const types: TypeDef[] = [
    { id: uid('t'), name: 'In', kind: 'case', status: 'draft', root: true, fields: [] },
    { id: uid('t'), name: 'Out', kind: 'case', status: 'draft', processOut: true, fields: [] },
  ];
  return {
    spec: {
      ...spec, slug, processId, title: input.title, name: input.name, project: input.project, engine: 'c8',
      status: 'draft', createdAt: now, updatedAt: now, types,
      service: { api: input.api, apiVersion: input.apiVersion, name: input.name },
    },
    xml,
  };
}

// ── the services it can call ────────────────────────────────────────────────

/** The domain of a collection — per collection (a new object with every change) and model. */
const domainCache = new WeakMap<ServiceCollectionSpec, { model: Model | null; types: DomainType[] }>();

/**
 * The domain a collection exports — read from its Scala. One that cannot be generated (yet)
 * has none: its classes are not there to refer to, the console says why.
 */
const domainOf = (c: ServiceCollectionSpec, model: Model | null): DomainType[] => {
  const hit = domainCache.get(c);
  if (hit && hit.model === model) return hit.types;
  let types: DomainType[] = [];
  try { types = collectionFiles(c, model).flatMap(f => scanScala(f.content, f.path)); }
  catch (e) { console.warn(`Collection «${c.title || c.slug}»: ihre Klassen sind nicht im Domain — der Scala-Code lässt sich nicht erzeugen.`, e); }
  domainCache.set(c, { model, types });
  return types;
};

/**
 * The catalog with the classes of the collections of this folder (but `except`) as domain —
 * what a process or another collection can refer to, e.g. a copied class to its original.
 * Only added, tagged with the collection (`DomainType.collection`): the catalog wins, the
 * services stay as they are, and a class of the same name is not taken for an import.
 */
export function withCollectionTypes(model: Model | null, collections: ServiceCollectionSpec[], except?: string): Model | null {
  const known = new Set((model?.domainTypes ?? []).map(d => d.id));
  const added: DomainType[] = [];
  for (const c of collections) {
    if (c.slug === except) continue;
    for (const d of domainOf(c, model)) {
      if (known.has(d.id)) continue;
      known.add(d.id);
      added.push({ ...d, collection: c.slug });
    }
  }
  return added.length ? { ...(model ?? { version: 1, services: [] }), domainTypes: [...(model?.domainTypes ?? []), ...added] } : model;
}

/**
 * The catalog with the collections in it — their ServiceTasks as services and their `In`,
 * `Out` and schema types as domain, read from the Scala the collection exports. A collection
 * wins over a catalog entry of the same topic: it is what is built here.
 */
export function withCollections(model: Model | null, collections: ServiceCollectionSpec[]): Model | null {
  if (!collections.length) return model;
  const domain = collections.flatMap(c => domainOf(c, model));
  if (!domain.length) return model;
  const merged = withProjectDomain(model, domain);
  // the fields of In and Out as the parameters of the entry — what a chosen service brings as rows
  const refs = servicesByTopic(collections);
  const params = (fields: Field[] | undefined, required: boolean): ServiceParam[] =>
    (fields ?? []).filter(f => f.name).map(f => ({ name: f.name, ...(f.description ? { description: f.description } : {}), ...(required && !f.optional ? { required: true } : {}) }));
  return {
    ...merged,
    services: merged.services.map(s => {
      const ref = refs.get(s.topic ?? s.id);
      if (!ref) return s;
      const { in: inType, out: outType } = serviceMembers(ref);
      return {
        ...s,
        inputs: ref.service.noIn ? [] : params(inType?.fields, true),
        outputs: ref.service.noOut ? [] : params(outType?.fields, false),
      };
    }),
  };
}

/** All services a step can call, by topic: the collections first, then those of the catalog. */
export function callableServices(collections: ServiceCollectionSpec[], model: Model | null): Map<string, ServiceRef> {
  const out = servicesByTopic(collections);
  for (const p of catalogProjects(model)) {
    const missing = p.apis.filter(a => a.services.some(s => !out.has(s.topic ?? s.id)));
    if (!missing.length) continue;
    try {
      for (const [topic, ref] of servicesByTopic([collectionFromCatalog(p, missing, model)])) if (!out.has(topic)) out.set(topic, ref);
    } catch { /* a catalog entry that does not make a collection: not callable */ }
  }
  return out;
}

/** The collections behind the services — what the export needs for packages and types. */
export const collectionsOf = (refs: Map<string, ServiceRef>): ServiceCollectionSpec[] =>
  [...new Set([...refs.values()].map(r => r.collection))];

// ── the process for the generator ───────────────────────────────────────────

/** The topic a step calls — from the catalog entry or the topic of the step. */
const topicOf = (s: Step): string | undefined => s.topic ?? s.serviceId;

/** The FEEL rows of a process step that count — a disabled row is not set. */
const enabled = (list: Mapping[] | undefined): Mapping[] =>
  (list ?? []).filter(m => !m.disabled && m.name.trim());

/**
 * The process as an orchestration — what the Scala export reads: per service task the topic,
 * its inputs and outputs, per script task its outputs as assignments, the conditions from the
 * branches, In and Out from the roles of the data model.
 */
export function asOrchestration(spec: ServiceProcess): ServiceOrchestrationSpec {
  const tasks: Record<string, OrchTask> = {};
  for (const s of flatSteps(spec.steps)) {
    if (s.kind === 'service') {
      const service = topicOf(s);
      tasks[s.id] = { ...(service ? { service } : {}), inputs: enabled(s.inputs), outputs: enabled(s.outputs) };
    } else if (s.kind === 'script') {
      tasks[s.id] = { assignments: enabled(s.outputs) };
    }
  }
  const all = spec.types ?? [];
  const inType = all.find(t => t.root);
  const outType = all.find(t => t.processOut);
  // In and Out belong to the CustomTask — not to its schema; process-only roles do not come along
  const types = all
    .filter(t => !t.initIn && !t.inConfig && !t.interactionId)
    .map(t => (t.root || t.processOut ? { ...t, interactionId: ORCH_MEMBER } : t));
  const { api, apiVersion, name, outMappings, outCases } = spec.service;
  return {
    kind: 'serviceOrchestration', version: spec.version, slug: spec.slug,
    title: spec.title, project: spec.project, api, apiVersion, name,
    status: spec.status, ...(spec.description ? { description: spec.description } : {}),
    createdAt: spec.createdAt, updatedAt: spec.updatedAt,
    bpmn: '', steps: spec.steps, tasks, types,
    ...(inType ? { inTypeId: inType.id } : { noIn: true }),
    ...(outType ? { outTypeId: outType.id } : { noOut: true }),
    ...(outMappings?.length ? { outMappings } : {}),
    ...(outCases?.length ? { outCases } : {}),
  };
}

/**
 * What is wrong with API, version and name of an orchestration — `null`: fine. `others`: the
 * process IDs of the other specifications; the new one must not be one of them.
 */
export function serviceRefProblem(ref: { project?: string; api: string; apiVersion: string; name: string }, others: Iterable<string>): string | null {
  if (!/^[a-z][A-Za-z0-9]*$/.test(ref.api)) return 'API: klein beginnen, Buchstaben und Ziffern (client, crm).';
  if (!/^[1-9]\d*$/.test(ref.apiVersion)) return 'Version: eine Zahl ab 1.';
  if (!/^[A-Z][A-Za-z0-9]*$/.test(ref.name)) return 'Name: ein Scala-Objekt, gross beginnend (UpdateClient).';
  const id = serviceProcessId({ project: ref.project ?? '', api: ref.api, apiVersion: Number(ref.apiVersion), name: ref.name });
  for (const o of others) if (o === id) return `${id} gibt es schon.`;
  return null;
}

// ── an orchestration of before ──────────────────────────────────────────────

/**
 * `getClient.etag` → `etag` — a result of before is now its fields as variables. Only a path
 * that starts with the result (not `a.getClient.etag`), and not inside a string literal.
 */
export function flatten(expression: string, results: Map<string, Set<string>>): string {
  const path = /(?<![\w.])([a-z][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)/g;
  const code = (part: string) => part.replace(path, (all, result: string, field: string) => {
    const used = results.get(result);
    if (!used) return all;
    used.add(field);
    return field;
  });
  // the string literals as they are — `"see getClient.etag"` stays
  return expression.split(/("(?:[^"\\]|\\.)*"?)/).map((part, i) => (i % 2 ? part : code(part))).join('');
}

/** What a take-over cannot carry over as it was — shown before it is done. */
export interface TakeOverIssue { level: 'error' | 'warning'; text: string }

/**
 * An orchestration from `services/` as a process in service mode — the same flow and diagram.
 * A service result was one variable (`getClient`), in a process its fields are: `getClient.etag`
 * becomes `etag`, and the step sets each field read that way (the others as disabled rows).
 */
export function fromOrchestration(o: ServiceOrchestrationSpec, refs: Map<string, ServiceRef>): { spec: ServiceProcess; xml: string; issues: TakeOverIssue[] } {
  const processId = serviceProcessId(o);
  const slug = slugify(processId);
  // the steps have the status the orchestration had
  const spec = withStatus(importBpmn(o.bpmn, `${slug}.bpmn`).spec, o.status);
  // the name of each result → the fields read from it
  const results = new Map<string, Set<string>>();
  // services without an Out: nothing of them can be read — what reads it stays and is said
  const empty = new Map<string, Set<string>>();
  const issues: TakeOverIssue[] = [];
  for (const [id, t] of Object.entries(o.tasks)) {
    if (!t.service) continue;
    const ref = refs.get(t.service);
    // a service that is not found: its fields are not known — what reads its result stays as it is
    if (!ref) {
      issues.push({ level: 'error', text: `Schritt «${id}»: Service «${t.service}» nicht gefunden — Ausdrücke mit ${t.result?.trim() || '…'}.… bleiben, wie sie sind, und der Schritt setzt keine Variablen. Danach den Service wählen und die Ausdrücke anpassen.` });
      continue;
    }
    (ref.service.noOut ? empty : results).set(t.result?.trim() || ref.service.name.replace(/^./, c => c.toLowerCase()), new Set());
  }
  const flat = (list: Mapping[] | undefined) => list?.map(m => ({ ...m, expression: flatten(m.expression, results) }));
  // first every expression — so all fields read are known before the outputs are written
  const tasks = Object.fromEntries(Object.entries(o.tasks).map(([id, t]) => [id, { ...t, inputs: flat(t.inputs), assignments: flat(t.assignments) }]));
  const conditions = Object.fromEntries(Object.entries(o.conditions ?? {}).map(([id, c]) => [id, flatten(c, results)]));
  const outMappings = flat(o.outMappings);
  const outCases = o.outCases?.map(c => ({ ...c, ...(c.condition ? { condition: flatten(c.condition, results) } : {}), ...(c.mappings ? { mappings: flat(c.mappings) } : {}) }));
  // what reads the result of a service without an Out: left as it is, said
  const everything = [
    ...Object.values(o.tasks).flatMap(t => [...(t.inputs ?? []), ...(t.assignments ?? [])].map(m => m.expression)),
    ...Object.values(o.conditions ?? {}), ...(o.outMappings ?? []).map(m => m.expression),
    ...(o.outCases ?? []).flatMap(c => [c.condition ?? '', ...(c.mappings ?? []).map(m => m.expression)]),
  ];
  for (const x of everything) flatten(x, empty);
  for (const [result, fields] of empty) {
    if (fields.size) issues.push({ level: 'error', text: `${[...fields].map(f => `${result}.${f}`).join(', ')}: der Service gibt nichts zurück (NoOutput) — bleibt so stehen; danach den Ausdruck anpassen.` });
  }
  // a field read from two results is one variable now — the later step overwrites it
  const readFrom = new Map<string, string[]>();
  for (const [result, fields] of results) for (const f of fields) readFrom.set(f, [...(readFrom.get(f) ?? []), result]);
  for (const [field, from] of readFrom) {
    if (from.length > 1) issues.push({ level: 'warning', text: `«${field}» wird aus ${from.map(r => `${r}.${field}`).join(' und ')} gelesen — jetzt eine Variable, die der spätere Schritt überschreibt. Danach die Mappings prüfen (eine Ausgabe umbenennen).` });
  }

  const outputsOf = (t: OrchTask): Mapping[] | undefined => {
    const ref = t.service ? refs.get(t.service) : undefined;
    if (!ref || ref.service.noOut) return undefined;
    const name = t.result?.trim() || ref.service.name.replace(/^./, c => c.toLowerCase());
    const used = results.get(name) ?? new Set<string>();
    const fields = (ref.collection.types.find(x => x.id === ref.service.outTypeId)?.fields ?? []).filter(f => f.name);
    return fields.map(f => ({ name: f.name, expression: `= ${f.name}`, fromService: true, ...(used.has(f.name) ? {} : { disabled: true }) }));
  };
  const visit = (steps: Step[]): Step[] => steps.map(s => {
    const t = tasks[s.id];
    let next: Step = s;
    if (s.kind === 'service' && t) {
      const outputs = outputsOf(t);
      next = { ...s, ...(t.service ? { topic: t.service, serviceId: t.service } : {}), ...(t.inputs?.length ? { inputs: t.inputs } : {}), ...(outputs ? { outputs } : {}) };
    } else if (s.kind === 'script' && t?.assignments?.length) {
      next = { ...s, outputs: t.assignments };
    }
    if (next.branches) next = { ...next, branches: next.branches.map((b: Branch) => ({ ...b, ...(conditions[b.id] ? { condition: conditions[b.id] } : {}), steps: visit(b.steps) })) };
    if (next.children) next = { ...next, children: visit(next.children) };
    return next;
  });

  // In and Out become the roles of the process; the types of the orchestration stay its own
  const types: TypeDef[] = o.types.flatMap(t => {
    const { interactionId, ...own } = t;
    if (t.id === o.inTypeId) return o.noIn ? [] : [{ ...own, root: true }];
    if (t.id === o.outTypeId) return o.noOut ? [] : [{ ...own, processOut: true }];
    return [interactionId === ORCH_MEMBER ? own : t];
  });
  return {
    spec: {
      ...spec, slug, processId, title: o.title, name: o.name, project: o.project, engine: 'c8',
      status: o.status, createdAt: o.createdAt, updatedAt: nowIsoWithTimezone(),
      ...(o.description ? { description: o.description } : {}),
      ...(o.epics?.length ? { epics: o.epics } : {}),
      ...(o.comments?.length ? { comments: o.comments } : {}),
      types, steps: visit(spec.steps),
      service: {
        api: o.api, apiVersion: o.apiVersion, name: o.name,
        ...(outMappings?.length ? { outMappings } : {}),
        ...(outCases?.length ? { outCases } : {}),
      },
    },
    xml: o.bpmn,
    issues,
  };
}
