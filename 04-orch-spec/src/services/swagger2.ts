// Swagger 2.0 → OpenAPI 3, as far as the import of services reads it.
//
// Many APIs still come as Swagger 2.0 (`swagger.json`). The import reads
// OpenAPI 3 — so a Swagger 2.0 is converted first:
//   · `definitions` → `components.schemas` (and every `$ref` to them)
//   · `host`/`basePath`/`schemes` → `servers[0].url`
//   · a parameter `in: body` → `requestBody` (content per `consumes`),
//     `in: formData` → a `requestBody` with an object of its fields
//   · other parameters: their type moves into `schema`
//   · a response `schema` → `content` (per `produces`)
//   · `parameters`/`responses` of the document → `components`
//   · `x-nullable` → `nullable`, `type: file` → a binary string
// What the import does not read (security, examples per mime type) is left out.

type Json = Record<string, unknown>;

const isObj = (x: unknown): x is Json => !!x && typeof x === 'object' && !Array.isArray(x);

/** Is it a Swagger 2.0 — the one version that is converted? */
export const isSwagger2 = (raw: unknown): boolean => isObj(raw) && /^2(\.|$)/.test(String(raw.swagger ?? ''));

/** The document as OpenAPI 3: a Swagger 2.0 converted, anything else as it is. */
export function asOpenApi3(raw: unknown): unknown {
  return isSwagger2(raw) ? fromSwagger2(raw as Json) : raw;
}

const REFS: Array<[string, string]> = [
  ['#/definitions/', '#/components/schemas/'],
  ['#/parameters/', '#/components/parameters/'],
  ['#/responses/', '#/components/responses/'],
];

/** every `$ref` of Swagger 2.0 pointed to its place in OpenAPI 3 — schemas only, parameters and responses get their own care */
function schemaOf(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(schemaOf);
  if (!isObj(x)) return x;
  const out: Json = {};
  for (const [k, v] of Object.entries(x)) {
    if (k === '$ref' && typeof v === 'string') out.$ref = REFS.reduce((r, [from, to]) => (r.startsWith(from) ? to + r.slice(from.length) : r), v);
    else if (k === 'x-nullable') out.nullable = v;
    else if (k === 'type' && v === 'file') { out.type = 'string'; out.format = 'binary'; }
    else out[k] = schemaOf(v);
  }
  return out;
}

const content = (mimes: string[], schema: unknown): Json =>
  Object.fromEntries(mimes.map(m => [m, { schema: schemaOf(schema) }]));

/** a parameter that is not the body: its type goes into `schema` */
function parameterOf(p: Json): Json {
  if (typeof p.$ref === 'string') return schemaOf({ $ref: p.$ref }) as Json;
  const { name, in: where, required, description, deprecated, type, format, items, enum: values, default: dflt, minimum, maximum, pattern } = p;
  const schema: Json = {};
  if (type !== undefined) schema.type = type === 'file' ? 'string' : type;
  if (type === 'file') schema.format = 'binary';
  else if (format !== undefined) schema.format = format;
  if (items !== undefined) schema.items = schemaOf(items);
  if (values !== undefined) schema.enum = values;
  if (dflt !== undefined) schema.default = dflt;
  if (minimum !== undefined) schema.minimum = minimum;
  if (maximum !== undefined) schema.maximum = maximum;
  if (pattern !== undefined) schema.pattern = pattern;
  return {
    name, in: where,
    ...(required !== undefined ? { required } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(deprecated !== undefined ? { deprecated } : {}),
    schema,
  };
}

/** the fields of a form (`in: formData`) as one object */
function formBody(fields: Json[], consumes: string[]): Json {
  const properties: Json = {};
  const required: string[] = [];
  for (const f of fields) {
    const p = parameterOf(f);
    properties[String(f.name)] = { ...(p.schema as Json), ...(f.description ? { description: f.description } : {}) };
    if (f.required) required.push(String(f.name));
  }
  const mimes = consumes.filter(m => /form/i.test(m));
  const schema = { type: 'object', properties, ...(required.length ? { required } : {}) };
  return { ...(required.length ? { required: true } : {}), content: content(mimes.length ? mimes : ['application/x-www-form-urlencoded'], schema) };
}

function responseOf(r: unknown, produces: string[]): unknown {
  if (!isObj(r)) return r;
  if (typeof r.$ref === 'string') return schemaOf(r);
  const { schema, headers, examples: _examples, ...rest } = r;
  void _examples;
  return {
    ...rest,
    ...(schema !== undefined ? { content: content(produces, schema) } : {}),
    ...(isObj(headers) ? { headers: Object.fromEntries(Object.entries(headers).map(([h, v]) => [h, { schema: schemaOf(v) }])) } : {}),
  };
}

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch'];
const JSON_MIME = ['application/json'];

export function fromSwagger2(doc: Json): Json {
  const produces = Array.isArray(doc.produces) && doc.produces.length ? doc.produces as string[] : JSON_MIME;
  const consumes = Array.isArray(doc.consumes) && doc.consumes.length ? doc.consumes as string[] : JSON_MIME;
  const globalParams = isObj(doc.parameters) ? doc.parameters as Record<string, Json> : {};
  // a parameter of the document that is a body: in OpenAPI 3 a requestBody of its own
  const bodyParams = new Set(Object.entries(globalParams).filter(([, p]) => p.in === 'body').map(([n]) => n));
  const isBody = (p: Json) => p.in === 'body' || (typeof p.$ref === 'string' && bodyParams.has(p.$ref.split('/').pop() ?? ''));
  const isForm = (p: Json) => p.in === 'formData'
    || (typeof p.$ref === 'string' && globalParams[p.$ref.split('/').pop() ?? '']?.in === 'formData');
  const resolved = (p: Json): Json => (typeof p.$ref === 'string' ? globalParams[p.$ref.split('/').pop() ?? ''] ?? p : p);
  const bodyOf = (p: Json, mimes: string[]): Json => {
    if (typeof p.$ref === 'string') return { $ref: `#/components/requestBodies/${p.$ref.split('/').pop()}` };
    return {
      ...(p.description ? { description: p.description } : {}),
      ...(p.required ? { required: true } : {}),
      content: content(mimes, p.schema),
    };
  };

  const paths: Json = {};
  for (const [path, rawItem] of Object.entries(isObj(doc.paths) ? doc.paths : {})) {
    if (!isObj(rawItem)) continue;
    const shared = (Array.isArray(rawItem.parameters) ? rawItem.parameters : []).filter(isObj);
    const item: Json = {};
    const sharedPlain = shared.filter(p => !isBody(p) && !isForm(p));
    if (sharedPlain.length) item.parameters = sharedPlain.map(parameterOf);
    for (const m of METHODS) {
      const op = rawItem[m];
      if (!isObj(op)) continue;
      const opConsumes = Array.isArray(op.consumes) && op.consumes.length ? op.consumes as string[] : consumes;
      const opProduces = Array.isArray(op.produces) && op.produces.length ? op.produces as string[] : produces;
      const own = (Array.isArray(op.parameters) ? op.parameters : []).filter(isObj);
      // an own parameter replaces the shared one of the same name and place
      const all = [...shared.filter(s => !own.some(o => resolved(o).name === resolved(s).name && resolved(o).in === resolved(s).in)), ...own];
      const body = all.find(isBody);
      const form = all.filter(isForm).map(resolved);
      const plain = own.filter(p => !isBody(p) && !isForm(p));
      const { parameters: _p, consumes: _c, produces: _pr, responses, schemes: _s, security: _sec, ...rest } = op;
      void _p; void _c; void _pr; void _s; void _sec;
      item[m] = {
        ...schemaOf(rest) as Json,
        ...(plain.length ? { parameters: plain.map(parameterOf) } : {}),
        ...(body ? { requestBody: bodyOf(body, opConsumes) } : form.length ? { requestBody: formBody(form, opConsumes) } : {}),
        responses: Object.fromEntries(Object.entries(isObj(responses) ? responses : {}).map(([code, r]) => [code, responseOf(r, opProduces)])),
      };
    }
    paths[path] = item;
  }

  const scheme = Array.isArray(doc.schemes) && doc.schemes.length ? String(doc.schemes[0]) : 'https';
  const base = typeof doc.basePath === 'string' && doc.basePath !== '/' ? doc.basePath : '';
  const url = typeof doc.host === 'string' && doc.host ? `${scheme}://${doc.host}${base}` : base;

  const components: Json = {};
  if (isObj(doc.definitions)) components.schemas = schemaOf(doc.definitions);
  const plainParams = Object.entries(globalParams).filter(([n, p]) => !bodyParams.has(n) && p.in !== 'formData');
  if (plainParams.length) components.parameters = Object.fromEntries(plainParams.map(([n, p]) => [n, parameterOf(p)]));
  if (bodyParams.size) components.requestBodies = Object.fromEntries([...bodyParams].map(n => [n, bodyOf(globalParams[n], consumes)]));
  if (isObj(doc.responses)) components.responses = Object.fromEntries(Object.entries(doc.responses).map(([n, r]) => [n, responseOf(r, produces)]));

  return {
    openapi: '3.0.3',
    ...(isObj(doc.info) ? { info: doc.info } : {}),
    ...(url ? { servers: [{ url }] } : {}),
    ...(Array.isArray(doc.tags) ? { tags: doc.tags } : {}),
    paths,
    ...(Object.keys(components).length ? { components } : {}),
  };
}
