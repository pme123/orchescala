// OpenAPI eines Orchescala-Projekts → Katalog.
//
// Die `OpenApi.yml` jedes Projekts beschreibt alles, was von aussen ansprechbar
// ist — und trägt dabei mehr als die element-templates:
//
//   POST /process/valiant-mkk-openMkkV1/async     «Process start»
//        → der Prozess selbst, Eingaben aus dem Request-Schema
//   GET  /process/…/{id}/variables                «Process variables»
//        → seine Ausgaben
//   POST /worker/valiant-mkk-openMkkV1-ExtractClientKey   «Worker: …»
//        → ein Service; das **Topic steht im Pfad**
//   GET  /process/{id}/userTask/X/variables       «UserTask variables: X»
//   POST /userTask/X/{id}/complete                «UserTask complete: X»
//
// Die Schemas bringen Feldbeschreibungen und `required` mit — beides fehlt in
// den element-templates. Was hier **nicht** steht: die konkreten
// `_handledErrors`. Die stehen im BPMN, und von dort liest sie der Import.
//
// Bewusst übersprungen: `Init Worker` sowie die Felder `inConfig` — das sind
// Implementations-Details und gehören nicht in eine Spezifikation.

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
  /** ADT: `enum In: case Iban(…) case Generic(…)` wird zu `oneOf` */
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
 * Felder, die zur Verdrahtung gehören und nicht in die Spezifikation:
 * alles mit `_`, die Mock- und Identitäts-Parameter sowie `inConfig`.
 */
const TECHNICAL = new Set([
  '_outputServiceMock', '_manualOutMapping', '_outputMock', '_outputVariables',
  '_servicesMocked', '_mockedWorkers', '_identityCorrelation', 'impersonateUserId',
  'inConfig',
]);

const SKIP_FIELD = (name: string) => name.startsWith('_') || TECHNICAL.has(name);

/**
 * Felder eines Schemas — auch wenn es ein ADT ist. Ein `In`, das in Scala als
 * `enum In: case Iban(…) case Generic(…)` steht, erscheint hier als `oneOf`;
 * für den Katalog zählt die Vereinigung der Varianten (so machen es die
 * element-templates auch). `allOf` wird zusammengefügt.
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
 * Schema-Felder als Parameter. Der Vorgabe-Ausdruck ist `#{name}` — das ist
 * die Konvention im Haus: die Prozessvariable gleichen Namens. (In den
 * element-templates steht mal `#{name}`, mal
 * `#{execution.getVariable('name')}` — beides dasselbe.)
 */
function params(schema: Schema | undefined, doc: Doc): ServiceParam[] {
  const out: ServiceParam[] = [];
  for (const [name, { raw, required }] of collect(schema, doc)) {
    if (SKIP_FIELD(name)) continue;
    const p = deref(raw, doc) ?? raw;
    const descr = (raw.description ?? p.description ?? '').trim();
    out.push({
      name,
      expression: `#{${name}}`,
      ...(descr ? { description: descr } : {}),
      ...(required ? { required: true } : {}),
    });
  }
  return out;
}

export interface OpenApiResult {
  /** Projekt laut `info.title`, z. B. `valiant-mkk` */
  project: string;
  services: ServiceDef[];
  /** `In`/`Out` der Prozesse — für die Typ-Auswahl */
  types: DomainType[];
  processes: string[];
  userTasks: string[];
}

/** Eine bereits geparste OpenAPI in Katalog-Einträge übersetzen. */
export function catalogFromOpenApi(raw: unknown, source = ''): OpenApiResult {
  const doc = (raw ?? {}) as Doc;
  // `info.title` ist manchmal ein Anzeigename («Valiant Kube»); für die
  // Gruppierung ist die Projekt-Kennung aus der Prozess-ID die bessere Wahl.
  const title = String(doc.info?.title ?? '').trim();
  const services = new Map<string, ServiceDef>();
  const processes: string[] = [];
  const userTasks: string[] = [];

  // Prozess-Ausgaben kommen aus einer eigenen Operation — erst sammeln
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
      // Das Topic ist der Pfad — verlässlicher als jede Ableitung
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

    // Entscheidungen (DMN): operationId `Dmn: <Name>`, die Decision Reference
    // steht in der Description (der Pfad lowercased den Namen — nicht nehmen,
    // wenn die Description das Original hat). Ein Business-Rule-Task findet
    // den Eintrag über seine camunda:decisionRef.
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

    // Signale werden nicht gerufen, sondern gesendet — sie gehören in den
    // Katalog wie ein Service, damit man sie an einem Schritt wählen kann.
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
      // «variables» liefert die Eingaben (Antwort), «complete» die Ausgaben (Request)
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

  // Die In/Out der Prozesse als wählbare Typen
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

/** Mehrere OpenAPI-Dokumente zusammenführen. Später gelesene ergänzen. */
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
