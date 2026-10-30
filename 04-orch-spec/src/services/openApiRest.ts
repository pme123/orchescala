// OpenAPI of a REST API → services of a collection.
//
// Unlike `openApi.ts` (the OpenApi.yml Orchescala generates for its own
// processes and workers), this reads the API a service wraps — any OpenAPI 3:
// every operation is a candidate, the user ticks the ones the collection takes.
//
// What comes over per operation:
//   · path, query and header parameters with their types
//   · the body of the request → `ServiceIn`, the body of the 2xx response →
//     `ServiceOut`, both with the schema types they need (transitively)
//   · a first `In` (the parameters plus the fields of the body, flattened) and
//     `Out` (the body under its own name, the `etag` if the API sends one),
//     with mappings `= name` — the spec adds and changes from there.
//
// Type mapping as the in-house ServiceWorker generator does it:
// integer int32 → Int, integer → Long, number → Double (BigDecimal for
// `format: decimal`), string date → LocalDate, date-time → LocalDateTime,
// boolean → Boolean, array → `Seq`, not required → `Option`, enum → enum,
// `additionalProperties` → Map.
import type { Field, Mapping, TypeDef } from '../types';
import { uid } from '../util';
import { basePathParams } from './collection';
import type { BodyRef, CollectionService, HttpMethod, ParamIn, RequestParam, ServiceCollectionSpec } from './types';

interface Schema {
  $ref?: string;
  type?: string | string[];
  format?: string;
  title?: string;
  description?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  enum?: unknown[];
  oneOf?: Schema[];
  anyOf?: Schema[];
  allOf?: Schema[];
  additionalProperties?: boolean | Schema;
  nullable?: boolean;
  example?: unknown;
}

interface Parameter {
  $ref?: string;
  name: string;
  in: string;
  required?: boolean;
  description?: string;
  schema?: Schema;
}

interface Content { schema?: Schema }

interface Operation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  deprecated?: boolean;
  parameters?: Parameter[];
  requestBody?: { $ref?: string; required?: boolean; content?: Record<string, Content> };
  responses?: Record<string, { $ref?: string; description?: string; content?: Record<string, Content>; headers?: Record<string, unknown> }>;
}

interface Doc {
  openapi?: string;
  swagger?: string;
  info?: { title?: string; version?: string; description?: string };
  servers?: Array<{ url?: string }>;
  paths?: Record<string, Record<string, Operation | Parameter[]>>;
  components?: {
    schemas?: Record<string, Schema>;
    parameters?: Record<string, Parameter>;
    requestBodies?: Record<string, Operation['requestBody']>;
    responses?: Record<string, NonNullable<Operation['responses']>[string]>;
  };
}

/** An operation of the API — a candidate for the collection. */
export interface ApiOperation {
  /** `GET /clients/{clientKey}` — identifies it within the API */
  key: string;
  method: HttpMethod;
  path: string;
  operationId?: string;
  summary?: string;
  description?: string;
  tags: string[];
  deprecated?: boolean;
  /** suggested Scala object name, unique within the API */
  name: string;
  params: Parameter[];
  body?: Schema;
  bodyRequired?: boolean;
  response?: { status: number; schema?: Schema; headers: string[] };
}

export interface ApiImport {
  title: string;
  version?: string;
  description?: string;
  /** `servers[0].url` */
  basePath?: string;
  operations: ApiOperation[];
  doc: Doc;
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

/** Is this an OpenAPI 3 at all? Swagger 2 is named — it would need converting first. */
export function apiProblem(raw: unknown): string | null {
  const d = raw as Doc | null;
  if (!d || typeof d !== 'object') return 'keine OpenAPI (kein Objekt)';
  if (d.swagger) return `Swagger ${d.swagger} wird nicht unterstützt — bitte als OpenAPI 3 exportieren`;
  if (!d.openapi) return 'keine OpenAPI 3 (Feld «openapi» fehlt)';
  if (!d.paths || !Object.keys(d.paths).length) return 'die OpenAPI hat keine Pfade';
  return null;
}

const refName = (ref: string) => ref.split('/').pop() ?? '';

function deref<T extends { $ref?: string }>(x: T | undefined, doc: Doc, section: 'schemas' | 'parameters' | 'requestBodies' | 'responses', depth = 0): T | undefined {
  if (!x?.$ref || depth > 8) return x;
  const target = (doc.components?.[section] as Record<string, T> | undefined)?.[refName(x.$ref)];
  return deref(target, doc, section, depth + 1);
}

const derefSchema = (s: Schema | undefined, doc: Doc) => deref(s, doc, 'schemas');

const jsonOf = (content: Record<string, Content> | undefined): Schema | undefined => {
  if (!content) return undefined;
  const key = Object.keys(content).find(k => /json/i.test(k)) ?? Object.keys(content)[0];
  return key ? content[key]?.schema : undefined;
};

const capitalize = (s: string) => s.replace(/^(.)/, c => c.toUpperCase());
const lowerFirst = (s: string) => s.replace(/^(.)/, c => c.toLowerCase());

/** `request-id` → `requestId`, `X-Client_Key` → `xClientKey` */
export function camelName(raw: string): string {
  const parts = raw.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (!parts.length) return 'value';
  const s = parts.map((p, i) => (i ? capitalize(p) : p)).join('');
  // a name that starts with a digit is no Scala identifier
  return /^[0-9]/.test(s) ? `v${s}` : lowerFirst(s);
}

/** `client.AddressDto_v2` → `AddressDtoV2` */
export function typeName(raw: string): string {
  const parts = raw.split(/[^A-Za-z0-9]+/).filter(Boolean).map(capitalize);
  const last = raw.includes('.') ? raw.split('.').pop()!.split(/[^A-Za-z0-9]+/).filter(Boolean).map(capitalize) : parts;
  const s = (last.length ? last : parts).join('') || 'Type';
  return /^[0-9]/.test(s) ? `T${s}` : s;
}

/**
 * The name of a service: the `operationId` if there is one (`getClient` →
 * `GetClient`), otherwise method and the fixed segments of the path
 * (`GET /clients/{clientKey}/addresses` → `GetClientsAddresses`).
 */
function nameOf(method: string, path: string, op: Operation): string {
  if (op.operationId && /[A-Za-z]/.test(op.operationId)) {
    const n = typeName(op.operationId.replace(/^[^A-Za-z]+/, ''));
    return n;
  }
  const fixed = path.split('/').filter(s => s && !s.startsWith('{')).map(s => typeName(s));
  return capitalize(method) + fixed.join('');
}

export function readApi(raw: unknown): ApiImport {
  const doc = raw as Doc;
  const operations: ApiOperation[] = [];
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    // parameters on the path apply to all its operations
    const shared = (Array.isArray(item.parameters) ? item.parameters : []) as Parameter[];
    for (const m of METHODS) {
      const op = item[m] as Operation | undefined;
      if (!op || Array.isArray(op)) continue;
      const own = (op.parameters ?? []).map(p => deref(p, doc, 'parameters')!).filter(Boolean);
      const sharedHere = shared.map(p => deref(p, doc, 'parameters')!).filter(p => p && !own.some(o => o.name === p.name && o.in === p.in));
      const body = deref(op.requestBody, doc, 'requestBodies');
      const response = successResponse(op, doc);
      operations.push({
        key: `${m.toUpperCase()} ${path}`,
        method: m.toUpperCase() as HttpMethod,
        path,
        ...(op.operationId ? { operationId: op.operationId } : {}),
        ...(op.summary ? { summary: op.summary.trim() } : {}),
        ...(op.description ? { description: op.description.trim() } : {}),
        tags: op.tags ?? [],
        ...(op.deprecated ? { deprecated: true } : {}),
        name: nameOf(m, path, op),
        params: [...sharedHere, ...own].filter(p => ['path', 'query', 'header'].includes(p.in)),
        ...(jsonOf(body?.content) ? { body: jsonOf(body?.content) } : {}),
        ...(body?.required ? { bodyRequired: true } : {}),
        ...(response ? { response } : {}),
      });
    }
  }
  // a name twice (two operations without operationId on similar paths): number them
  const seen = new Map<string, number>();
  for (const o of operations) {
    const n = (seen.get(o.name) ?? 0) + 1;
    seen.set(o.name, n);
    if (n > 1) o.name = `${o.name}${n}`;
  }
  const basePath = doc.servers?.[0]?.url?.trim();
  return {
    title: String(doc.info?.title ?? '').trim(),
    ...(doc.info?.version ? { version: String(doc.info.version) } : {}),
    ...(doc.info?.description ? { description: String(doc.info.description).trim() } : {}),
    ...(basePath ? { basePath } : {}),
    operations,
    doc,
  };
}

function successResponse(op: Operation, doc: Doc): ApiOperation['response'] | undefined {
  const codes = Object.keys(op.responses ?? {}).filter(c => /^2\d\d$/.test(c)).sort();
  const code = codes[0] ?? (op.responses?.['2XX'] ? '200' : undefined);
  if (!code) return undefined;
  const res = deref(op.responses?.[code] ?? op.responses?.['2XX'], doc, 'responses');
  return {
    status: Number(code),
    ...(jsonOf(res?.content) ? { schema: jsonOf(res?.content) } : {}),
    headers: Object.keys(res?.headers ?? {}).map(h => h.toLowerCase()),
  };
}

// ── Schemas → types of the collection ──────────────────────────────────────

/** A field's type: a scalar, or the id of a type that is created on the way. */
interface Shape { type: string; collection?: boolean; map?: boolean }

class SchemaTypes {
  readonly created: TypeDef[] = [];
  /** schema name → type id (also the existing types of the collection, by name) */
  private byName = new Map<string, string>();
  private names: Set<string>;

  constructor(private doc: Doc, existing: TypeDef[]) {
    for (const t of existing) if (!t.interactionId) this.byName.set(t.name, t.id);
    this.names = new Set(existing.map(t => t.name));
  }

  private freeName(base: string): string {
    let n = base, i = 2;
    while (this.names.has(n)) n = `${base}${i++}`;
    this.names.add(n);
    return n;
  }

  /** The shape of a schema; `hint` names an inline object or enum (`Parent` + field). */
  shape(raw: Schema | undefined, hint: string, depth = 0): Shape {
    if (!raw || depth > 12) return { type: 'String' };
    if (raw.$ref) {
      const name = refName(raw.$ref);
      const target = derefSchema(raw, this.doc);
      if (target && isScalarSchema(target) && !target.enum) return { type: scalarOf(target) };
      if (target?.type === 'array') return { ...this.shape(target.items, typeName(name), depth + 1), collection: true };
      return { type: this.named(typeName(name), target, depth) };
    }
    const types = Array.isArray(raw.type) ? raw.type.filter(t => t !== 'null') : [raw.type];
    const t = types[0];
    if (t === 'array') return { ...this.shape(raw.items, singular(hint), depth + 1), collection: true };
    if (raw.enum?.length) return { type: this.inlineType(hint, raw, depth) };
    if (t === 'object' || raw.properties || raw.allOf || raw.oneOf || raw.anyOf) {
      if (!raw.properties && !raw.allOf && !raw.oneOf && !raw.anyOf && raw.additionalProperties) {
        const value = typeof raw.additionalProperties === 'object' ? this.shape(raw.additionalProperties, hint, depth + 1) : { type: 'String' };
        return { type: value.type, map: true };
      }
      return { type: this.inlineType(hint, raw, depth) };
    }
    return { type: scalarOf(raw) };
  }

  /** A named schema — once per name. */
  private named(name: string, schema: Schema | undefined, depth: number): string {
    const known = this.byName.get(name);
    if (known) return known;
    const id = uid(schema?.enum ? 'e' : 't');
    this.byName.set(name, id);
    this.names.add(name);
    this.created.push(this.typeOf(id, name, schema, depth));
    return id;
  }

  private inlineType(hint: string, schema: Schema, depth: number): string {
    const id = uid(schema.enum ? 'e' : 't');
    this.created.push(this.typeOf(id, this.freeName(typeName(hint)), schema, depth));
    return id;
  }

  private typeOf(id: string, name: string, raw: Schema | undefined, depth: number): TypeDef {
    const schema = derefSchema(raw, this.doc) ?? {};
    const description = schema.description?.trim() || schema.title?.trim();
    if (schema.enum?.length) {
      return {
        id, name, kind: 'enum', status: 'draft',
        ...(description ? { description } : {}),
        values: schema.enum.filter(v => v != null).map(v => ({ name: String(v) })),
      };
    }
    // the fields — `allOf` merged, a `oneOf`/`anyOf` as the union of its variants (all optional)
    const fields: Field[] = [];
    const add = (s: Schema | undefined, forceOptional: boolean, d: number) => {
      const x = derefSchema(s, this.doc);
      if (!x || d > 6) return;
      const required = new Set(x.required ?? []);
      for (const [prop, p] of Object.entries(x.properties ?? {})) {
        if (fields.some(f => f.name === prop)) continue;
        const shape = this.shape(p, `${name}${capitalize(camelName(prop))}`, depth + 1);
        const pd = derefSchema(p, this.doc);
        const descr = (p.description ?? pd?.description ?? '').trim();
        fields.push({
          id: uid('f'), name: prop, type: shape.type,
          ...(shape.collection ? { collection: true } : {}),
          ...(shape.map ? { map: true } : {}),
          ...(forceOptional || !required.has(prop) ? { optional: true } : {}),
          ...(descr ? { description: descr } : {}),
          ...(exampleOf(p.example ?? pd?.example)),
        });
      }
      for (const a of x.allOf ?? []) add(a, forceOptional, d + 1);
      for (const v of [...(x.oneOf ?? []), ...(x.anyOf ?? [])]) add(v, true, d + 1);
    };
    add(schema, false, 0);
    return { id, name, kind: 'case', status: 'draft', ...(description ? { description } : {}), fields };
  }
}

function exampleOf(v: unknown): { example?: string } {
  if (v == null || typeof v === 'object') return {};
  return { example: typeof v === 'string' ? `= "${v.replace(/"/g, '\\"')}"` : `= ${String(v)}` };
}

const singular = (s: string) => (s.endsWith('ies') ? `${s.slice(0, -3)}y` : s.endsWith('s') && !s.endsWith('ss') ? s.slice(0, -1) : s);

function isScalarSchema(s: Schema): boolean {
  const t = Array.isArray(s.type) ? s.type.find(x => x !== 'null') : s.type;
  return !!t && ['string', 'integer', 'number', 'boolean'].includes(t);
}

function scalarOf(s: Schema): string {
  const t = Array.isArray(s.type) ? s.type.find(x => x !== 'null') : s.type;
  switch (t) {
    case 'integer': return s.format === 'int32' ? 'Int' : 'Long';
    case 'number': return s.format === 'decimal' ? 'BigDecimal' : 'Double';
    case 'boolean': return 'Boolean';
    case 'string':
      if (s.format === 'date') return 'LocalDate';
      if (s.format === 'date-time') return 'LocalDateTime';
      return 'String';
    default: return 'String';
  }
}

// ── Sub paths and APIs ──────────────────────────────────────────────────────
//
// One OpenAPI can hold several APIs of a project — `/clients/…` and `/crm/v2/…`,
// each with its package and version. Which API an operation belongs to is a
// suggestion from its path: the first fixed segment after what all paths share
// (`/banks/{bankNumber}`), singular and camelCase (`clients` → `client`,
// `payment-rules` → `paymentRule`), a `v2` next to it is the version.

/** Is the path in the sub path? Empty: everything. */
export function inPathPrefix(path: string, prefix: string | undefined): boolean {
  const p = (prefix ?? '').trim().replace(/\/+$/, '');
  return !p || path === p || path.startsWith(`${p}/`);
}

const segments = (path: string) => path.split('/').filter(Boolean);

/** The segments all operations share — `['banks', '{bankNumber}']`. */
function commonSegments(ops: Pick<ApiOperation, 'path'>[]): number {
  const all = ops.map(o => segments(o.path));
  if (!all.length) return 0;
  let n = 0;
  // at least one segment stays for the API — one operation alone shares everything with itself
  while (all.every(s => s.length > n + 1 && s[n] === all[0][n])) n++;
  return n;
}

/** `clients` → `client`, `payment-rules` → `paymentRule` */
export function apiName(segment: string): string {
  const name = camelName(segment);
  return name.endsWith('ies') ? `${name.slice(0, -3)}y` : name.endsWith('ses') ? name.slice(0, -2) : name.endsWith('s') && !name.endsWith('ss') ? name.slice(0, -1) : name;
}

/** The suggested API of each operation (by key) — with the sub path it stands for (`/clients`). */
export function suggestApis(ops: ApiOperation[], fallback: { api: string; apiVersion: number }): Map<string, { api: string; apiVersion: number; subPath: string }> {
  const shared = commonSegments(ops);
  const out = new Map<string, { api: string; apiVersion: number; subPath: string }>();
  for (const o of ops) {
    const segs = segments(o.path);
    const at = segs.findIndex((s, i) => i >= shared && !s.startsWith('{') && !/^v\d+$/.test(s));
    if (at < 0) { out.set(o.key, { ...fallback, subPath: '/' }); continue; }
    const version = [segs[at + 1], segs[at - 1]].map(s => /^v(\d+)$/.exec(s ?? '')?.[1]).find(Boolean);
    const end = segs[at + 1] && /^v\d+$/.test(segs[at + 1]) ? at + 2 : at + 1;
    out.set(o.key, {
      api: apiName(segs[at]) || fallback.api,
      apiVersion: version ? Number(version) : fallback.apiVersion,
      subPath: `/${segs.slice(0, end).join('/')}`,
    });
  }
  return out;
}

// ── Operations → services ───────────────────────────────────────────────────

/** Is this operation already in the collection? Via the operationId, otherwise method and path. */
export function serviceOf(c: ServiceCollectionSpec, op: Pick<ApiOperation, 'method' | 'path' | 'operationId' | 'name'>): CollectionService | undefined {
  return c.services.find(s => (op.operationId && s.operationId === op.operationId) || (s.method === op.method && s.path === op.path))
    ?? c.services.find(s => !s.path && s.name === op.name);
}

/**
 * A service without request — taken over from the catalog (see catalogCollections.ts):
 * an operation of the same name completes it instead of adding a second one.
 */
export const isIncomplete = (s: CollectionService): boolean => !s.path || !!s.fromCatalog;

const PARAM_ORDER: Record<ParamIn, number> = { path: 0, query: 1, header: 2 };

/**
 * Add the chosen operations to the collection: the types they need, then per
 * operation the service with its `In`, `Out` and the first mappings.
 */
export function addOperations(
  c: ServiceCollectionSpec, api: ApiImport, keys: string[],
  /** the API of a new service — without: the default of the collection */
  apiFor: (op: ApiOperation) => { api: string; apiVersion: number } = () => ({ api: c.api, apiVersion: c.apiVersion }),
): { spec: ServiceCollectionSpec; added: string[] } {
  const builder = new SchemaTypes(api.doc, c.types);
  const services: CollectionService[] = [];
  const members: TypeDef[] = [];
  const names = new Set(c.services.map(s => s.name));
  const completed = new Map<string, CollectionService>();
  for (const op of api.operations.filter(o => keys.includes(o.key))) {
    const existing = serviceOf(c, op);
    if (existing && !isIncomplete(existing)) continue;
    let name = existing?.name ?? op.name, i = 2;
    if (!existing) {
      while (names.has(name)) name = `${op.name}${i++}`;
      names.add(name);
    }
    const id = existing?.id ?? uid('svc');

    // the placeholders of the company's base (`/banks/{bankNumber}`) come from serviceBasePath
    const fromBase = basePathParams(c, op);
    const params: RequestParam[] = op.params
      .filter(p => !(p.in === 'path' && fromBase.has(p.name)))
      .map(p => {
        const shape = builder.shape(p.schema, `${name}${capitalize(camelName(p.name))}`);
        const field = camelName(p.name);
        return {
          name: p.name,
          in: p.in as ParamIn,
          type: shape.type,
          ...(shape.collection ? { collection: true } : {}),
          ...(p.required || p.in === 'path' ? { required: true } : {}),
          ...(p.description?.trim() ? { description: p.description.trim() } : {}),
          expression: `= ${field}`,
        };
      })
      .sort((a, b) => PARAM_ORDER[a.in] - PARAM_ORDER[b.in]);

    const serviceIn: BodyRef | undefined = op.body ? bodyRef(builder.shape(op.body, `${name}Body`)) : undefined;
    const serviceOut: BodyRef | undefined = op.response?.schema
      ? { ...bodyRef(builder.shape(op.response.schema, `${name}Response`)), ...(op.method === 'POST' && op.response.status !== 200 ? { optional: true } : {}) }
      : undefined;

    // the In: the parameters, then the fields of the body (flattened) — or the body as a whole
    const inFields: Field[] = params.map(p => ({
      id: uid('f'), name: camelName(p.name), type: p.type,
      ...(p.collection ? { collection: true } : {}),
      ...(p.required ? {} : { optional: true }),
      ...(p.description ? { description: p.description } : {}),
    }));
    const bodyMappings: Mapping[] = [];
    const bodyType = serviceIn && !serviceIn.collection ? [...c.types, ...builder.created].find(t => t.id === serviceIn.type && t.kind === 'case') : undefined;
    if (bodyType) {
      for (const f of bodyType.fields ?? []) {
        if (inFields.some(x => x.name === f.name)) continue;
        inFields.push({ ...f, id: uid('f') });
        bodyMappings.push({ name: f.name, expression: `= ${f.name}` });
      }
    } else if (serviceIn) {
      inFields.push({ id: uid('f'), name: 'body', type: serviceIn.type, ...(serviceIn.collection ? { collection: true } : {}) });
    }

    // the Out: the body under its own name, the etag if the API sends one
    const outFields: Field[] = [];
    const outMappings: Mapping[] = [];
    if (serviceOut) {
      const t = [...c.types, ...builder.created].find(x => x.id === serviceOut.type);
      const base = t ? lowerFirst(t.name) : 'result';
      const fieldName = serviceOut.collection ? `${singular(base)}s` : base;
      outFields.push({
        id: uid('f'), name: fieldName, type: serviceOut.type,
        ...(serviceOut.collection ? { collection: true } : {}),
        ...(serviceOut.optional ? { optional: true } : {}),
      });
      outMappings.push({ name: fieldName, expression: '= body' });
    }
    if (op.response?.headers.includes('etag')) {
      outFields.push({ id: uid('f'), name: 'etag', type: 'String', optional: true, description: 'ETag der Antwort — für ein späteres Ändern (If-Match)' });
      outMappings.push({ name: 'etag', expression: '= headers.etag' });
    }

    const description = [op.summary, op.description && op.description !== op.summary ? op.description : ''].filter(Boolean).join('\n\n');
    if (existing) {
      // from the catalog: its In and Out stay (they are the implemented ones); the request comes
      // from the API, the Out fields are mapped where the body has a field of the same name
      const out = c.types.find(t => t.id === existing.outTypeId);
      const bodyCase = serviceOut && !serviceOut.collection ? [...c.types, ...builder.created].find(t => t.id === serviceOut.type && t.kind === 'case') : undefined;
      const mapped: Mapping[] = (out?.fields ?? []).flatMap(f =>
        f.name === 'etag' && op.response?.headers.includes('etag') ? [{ name: f.name, expression: '= headers.etag' }]
          : (bodyCase?.fields ?? []).some(b => b.name === f.name) ? [{ name: f.name, expression: `= body.${f.name}` }]
            : serviceOut && f.type === serviceOut.type ? [{ name: f.name, expression: '= body' }] : []);
      const { fromCatalog: _done, ...rest } = existing;
      completed.set(existing.id, {
        ...rest,
        ...(!existing.description && description ? { description } : {}),
        method: op.method, path: op.path,
        ...(op.operationId ? { operationId: op.operationId } : {}),
        params,
        ...(serviceIn ? { serviceIn } : {}),
        ...(serviceOut ? { serviceOut } : {}),
        ...(op.response ? { responseStatus: op.response.status } : {}),
        ...(op.response?.headers.length ? { responseHeaders: op.response.headers } : {}),
        // the Out fields without a mapping yet — those the collection has stay
        ...(mapped.some(m => !existing.outMappings?.some(x => x.name === m.name))
          ? { outMappings: [...(existing.outMappings ?? []), ...mapped.filter(m => !existing.outMappings?.some(x => x.name === m.name))] }
          : {}),
      });
      continue;
    }
    const inType: TypeDef = { id: uid('t'), name: 'In', kind: 'case', status: 'draft', interactionId: id, fields: inFields };
    const outType: TypeDef = { id: uid('t'), name: 'Out', kind: 'case', status: 'draft', interactionId: id, fields: outFields };
    members.push(inType, outType);
    const { api: apiOfOp, apiVersion } = apiFor(op);
    services.push({
      id, name, api: apiOfOp, apiVersion, status: 'draft',
      ...(description ? { description } : {}),
      method: op.method, path: op.path,
      ...(op.operationId ? { operationId: op.operationId } : {}),
      params,
      ...(serviceIn ? { serviceIn } : {}),
      ...(bodyMappings.length ? { bodyMappings } : {}),
      ...(serviceOut ? { serviceOut } : {}),
      ...(op.response ? { responseStatus: op.response.status } : {}),
      ...(op.response?.headers.length ? { responseHeaders: op.response.headers } : {}),
      inTypeId: inType.id, outTypeId: outType.id,
      // nothing to give or to get back: `type In = NoInput` / `type Out = NoOutput`
      ...(!inFields.length ? { noIn: true } : {}),
      ...(!outFields.length ? { noOut: true } : {}),
      ...(outMappings.length ? { outMappings } : {}),
    });
  }
  return {
    spec: {
      ...c,
      types: [...c.types, ...builder.created, ...members],
      services: [...c.services.map(s => completed.get(s.id) ?? s), ...services],
      source: {
        ...(c.source ?? {}),
        ...(api.title ? { title: api.title } : {}),
        ...(api.version ? { version: api.version } : {}),
        ...(api.basePath ? { basePath: api.basePath } : {}),
      },
    },
    added: [...completed.values(), ...services].map(s => s.name),
  };
}

const bodyRef = (s: Shape): BodyRef => ({ type: s.type, ...(s.collection ? { collection: true } : {}) });
