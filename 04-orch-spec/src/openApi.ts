// OpenAPI of an Orchescala project → catalog.
//
// The `OpenApi.yml` of every project describes everything that is addressable from outside
// — and carries more than the element templates:
//
//   POST /process/globex-savings-openSavingsV1/async     «Process start»
//        → the process itself, inputs from the request schema
//   GET  /process/…/{id}/variables                «Process variables»
//        → its outputs
//   POST /worker/globex-savings-openSavingsV1-ExtractClientKey   «Worker: …»
//        → a service; the **topic is in the path**
//   GET  /process/{id}/userTask/X/variables       «UserTask variables: X»
//   POST /userTask/X/{id}/complete                «UserTask complete: X»
//
// The schemas bring field descriptions and `required` — both are missing in
// the element templates. What is **not** here: the concrete
// `_handledErrors`. They are in the BPMN, and the import reads them from there.
//
// Deliberately skipped: `Init Worker` and the fields `inConfig` — those are
// implementation details and do not belong in a specification.

import type { DomainType, ServiceDef, ServiceParam } from './types.ts';
import { deriveObject } from './serviceTypes.ts';


interface Schema {
  $ref?: string;
  type?: string;
  title?: string;
  description?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  /** ADT: `enum In: case Iban(…) case Generic(…)` becomes `oneOf` */
  oneOf?: Schema[];
  anyOf?: Schema[];
  allOf?: Schema[];
}

interface Operation {
  operationId?: string;
  summary?: string;
  description?: string;
  requestBody?: { content?: Record<string, { schema?: Schema }> };
  responses?: Record<string, { content?: Record<string, { schema?: Schema }> }>;
}

interface Doc {
  info?: { title?: string; version?: string };
  paths?: Record<string, Record<string, Operation>>;
  components?: { schemas?: Record<string, Schema> };
}

/**
 * Fields that belong to the wiring and not in the specification:
 * everything with `_`, the mock and identity parameters and `inConfig`.
 */
const TECHNICAL = new Set([
  '_outputServiceMock', '_manualOutMapping', '_outputMock', '_outputVariables',
  '_servicesMocked', '_mockedWorkers', '_identityCorrelation', 'impersonateUserId',
  'inConfig',
]);

const SKIP_FIELD = (name: string) => name.startsWith('_') || TECHNICAL.has(name);

/**
 * Fields of a schema — even if it is an ADT. An `In` that is written in Scala as
 * `enum In: case Iban(…) case Generic(…)` appears here as `oneOf`;
 * for the catalog the union of the variants counts (the
 * element templates do it this way too). `allOf` is merged.
 */
function collect(schema: Schema | undefined, doc: Doc, into = new Map<string, { raw: Schema; required: boolean }>(), depth = 0): Map<string, { raw: Schema; required: boolean }> {
  const s = deref(schema, doc);
  if (!s || depth > 4) return into;
  const required = new Set(s.required ?? []);
  for (const [name, raw] of Object.entries(s.properties ?? {})) {
    if (!into.has(name)) into.set(name, { raw, required: required.has(name) });
  }
  for (const variant of [...(s.allOf ?? []), ...(s.oneOf ?? []), ...(s.anyOf ?? [])]) {
    collect(variant, doc, into, depth + 1);
  }
  return into;
}

const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);

function deref(schema: Schema | undefined, doc: Doc, depth = 0): Schema | undefined {
  if (!schema || depth > 5) return schema;
  if (!schema.$ref) return schema;
  const name = schema.$ref.split('/').pop() ?? '';
  return deref(doc.components?.schemas?.[name], doc, depth + 1);
}

function bodySchema(op: Operation, doc: Doc): Schema | undefined {
  return deref(op.requestBody?.content?.['application/json']?.schema, doc);
}

function responseSchema(op: Operation, doc: Doc): Schema | undefined {
  for (const [code, res] of Object.entries(op.responses ?? {})) {
    if (!code.startsWith('2')) continue;
    const s = res.content?.['application/json']?.schema;
    if (s) return deref(s, doc);
  }
  return undefined;
}

/**
 * Schema fields as parameters. The default expression is `= name` — the
 * in-house convention: the process variable of the same name, in FEEL, the
 * language of the specification. (The element templates have JUEL for it,
 * sometimes `#{name}`, sometimes `#{execution.getVariable('name')}` — the same.)
 */
function params(schema: Schema | undefined, doc: Doc): ServiceParam[] {
  const out: ServiceParam[] = [];
  for (const [name, { raw, required, variants }] of fieldsWithVariants(schema, doc)) {
    if (SKIP_FIELD(name)) continue;
    const p = deref(raw, doc) ?? raw;
    const descr = (raw.description ?? p.description ?? '').trim();
    out.push({
      name,
      expression: `= ${name}`,
      ...(descr ? { description: descr } : {}),
      ...(required ? { required: true } : {}),
      ...(variants ? { variants } : {}),
    });
  }
  return out;
}

type VariantField = { raw: Schema; required: boolean; variants?: string[] };

/**
 * Like `collect`, but an ADT (`oneOf` / `anyOf` with several cases) stays
 * recognizable: fields that only some cases have carry their names
 * (`variants`) and are required only there. What all cases have is shared.
 */
function fieldsWithVariants(schema: Schema | undefined, doc: Doc): Map<string, VariantField> {
  const s = deref(schema, doc);
  const alts = [...(s?.oneOf ?? []), ...(s?.anyOf ?? [])];
  if (!s || alts.length < 2) return collect(schema, doc);
  const out: Map<string, VariantField> = collect({ ...s, oneOf: undefined, anyOf: undefined }, doc);
  const each = alts.map(v => ({ name: deref(v, doc)?.title || v.$ref?.split('/').pop() || '', fields: collect(v, doc) }));
  for (const name of new Set(each.flatMap(e => [...e.fields.keys()]))) {
    if (out.has(name)) continue;
    const having = each.filter(e => e.fields.has(name));
    const raw = having[0].fields.get(name)!.raw;
    const required = having.every(e => e.fields.get(name)!.required);
    out.set(name, having.length === each.length
      ? { raw, required }
      : { raw, required, variants: having.map(e => e.name).filter(Boolean) });
  }
  return out;
}

export interface OpenApiResult {
  /** Project according to `info.title`, e.g. `globex-savings` */
  project: string;
  services: ServiceDef[];
  /** `In`/`Out` of the processes — for the type picker */
  types: DomainType[];
  processes: string[];
  userTasks: string[];
}

/** Translate an already parsed OpenAPI into catalog entries. */
export function catalogFromOpenApi(raw: unknown, source = ''): OpenApiResult {
  const doc = (raw ?? {}) as Doc;
  // `info.title` is sometimes a display name («Globex Cards»); for
  // grouping, the project identifier from the process ID is the better choice.
  const title = String(doc.info?.title ?? '').trim();
  const services = new Map<string, ServiceDef>();
  const processes: string[] = [];
  const userTasks: string[] = [];

  // Process outputs come from an operation of their own — collect them first
  const processOut = new Map<string, ServiceParam[]>();

  const firstProcess = Object.keys(doc.paths ?? {})
    .map(p => /^\/process\/([^/]+)\//.exec(p)?.[1]).find(Boolean);
  const project = firstProcess?.replace(/-[A-Za-z][A-Za-z0-9]*V\d+$/, '') || title;

  const ops: Array<{ path: string; op: Operation }> = [];
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const [method, op] of Object.entries(item ?? {})) {
      if (!METHODS.has(method.toLowerCase())) continue;
      ops.push({ path, op });
    }
  }

  for (const { path, op } of ops) {
    if (op.operationId !== 'Process variables') continue;
    const id = /^\/process\/([^/]+)\//.exec(path)?.[1];
    if (id) processOut.set(id, params(responseSchema(op, doc), doc));
  }

  for (const { path, op } of ops) {
    const id = String(op.operationId ?? '').trim();
    if (!id || id === 'Process variables' || id === 'Init Worker') continue;

    if (id === 'Process start') {
      const processId = /^\/process\/([^/]+)\//.exec(path)?.[1];
      if (!processId) continue;
      processes.push(processId);
      services.set(processId, {
        id: processId,
        name: schemaTitleOr(op, processId),
        group: project,
        ...(op.description ? { description: firstLine(op.description) } : {}),
        kind: 'call',
        calledProcess: processId,
        inputs: params(bodySchema(op, doc), doc),
        outputs: processOut.get(processId) ?? [],
      });
      continue;
    }

    const worker = /^Worker:\s*(.+)$/.exec(id)?.[1];
    if (worker) {
      // The topic is the path — more reliable than any derivation
      const topic = /^\/worker\/(.+)$/.exec(path)?.[1] ?? '';
      if (!topic) continue;
      services.set(topic, {
        id: topic,
        name: worker.trim(),
        group: project,
        ...(op.description ? { description: firstLine(op.description) } : {}),
        topic,
        kind: 'service',
        inputs: params(bodySchema(op, doc), doc),
        outputs: params(responseSchema(op, doc), doc),
      });
      continue;
    }

    // Decisions (DMN): operationId `Dmn: <Name>`, the decision reference
    // is in the description (the path lowercases the name — don't use it
    // if the description has the original). A business rule task finds
    // the entry via its camunda:decisionRef.
    const dmn = /^Dmn:\s*(.+)$/.exec(id)?.[1]?.trim();
    if (dmn) {
      const ref = /Decision Reference[^`]*`([^`]+)`/.exec(op.description ?? '')?.[1]
        ?? /^\/dmn\/([^/]+)\//.exec(path)?.[1];
      if (!ref) continue;
      services.set(ref, {
        id: ref,
        name: dmn,
        group: project,
        ...(op.description ? { description: firstLine(op.description) } : {}),
        topic: ref,
        kind: 'rule',
        inputs: params(bodySchema(op, doc), doc),
        outputs: params(responseSchema(op, doc), doc),
      });
      continue;
    }

    // Signals are not called but sent — they belong in the
    // catalog like a service, so that they can be chosen on a step.
    const signal = /^(?:Signal|Message):\s*(.+)$/.exec(id)?.[1]?.trim();
    if (signal && !signal.startsWith('{')) {
      const key = `${project}.signal.${signal}`;
      services.set(key, {
        id: key,
        name: signal,
        group: project,
        kind: 'send',
        inputs: params(bodySchema(op, doc), doc),
      });
      continue;
    }

    const task = /^UserTask (?:variables|complete):\s*(.+)$/.exec(id)?.[1]?.trim();
    if (task) {
      if (!userTasks.includes(task)) userTasks.push(task);
      const key = `${project}.userTask.${task}`;
      const prev = services.get(key);
      // «variables» returns the inputs (response), «complete» the outputs (request)
      const isVariables = id.startsWith('UserTask variables');
      const fields = isVariables ? params(responseSchema(op, doc), doc) : params(bodySchema(op, doc), doc);
      services.set(key, {
        id: key,
        name: task,
        group: project,
        kind: 'user',
        inputs: isVariables ? fields : prev?.inputs ?? [],
        outputs: isVariables ? prev?.outputs ?? [] : fields,
      });
    }
  }

  // The In/Out of the processes as selectable types
  const types: DomainType[] = [];
  for (const processId of processes) {
    const { object, pkg, uncertain } = deriveObject(processId);
    for (const member of ['In', 'Out'] as const) {
      types.push({
        id: `${pkg}.${object}.${member}`,
        name: `${object}.${member}`,
        pkg,
        kind: 'member',
        owner: object,
        importPath: `${pkg}.${object}`,
        descr: `Prozess «${processId}»${uncertain ? ' — Import prüfen' : ''}`,
        ...(source ? { source } : {}),
      });
    }
  }

  return { project, services: [...services.values()], types, processes, userTasks };
}

function firstLine(text: string): string {
  const clean = text.split('\n').map(l => l.trim()).find(l => l && !l.startsWith('<') && !l.startsWith('*'));
  return (clean ?? '').slice(0, 200);
}

function schemaTitleOr(op: Operation, fallback: string): string {
  return (op.summary && op.summary !== 'Process start' ? op.summary : fallback).trim();
}

/** Merge several OpenAPI documents. Ones read later add to it. */
export function mergeServices(existing: ServiceDef[], incoming: ServiceDef[]): { services: ServiceDef[]; added: number; updated: number } {
  const byId = new Map(existing.map(s => [s.id, s]));
  let added = 0, updated = 0;
  for (const s of incoming) {
    if (byId.has(s.id)) updated++; else added++;
    byId.set(s.id, s);
  }
  return {
    services: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)),
    added, updated,
  };
}
