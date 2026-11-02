// A Swagger 2.0 is converted to OpenAPI 3 before the import reads it: the same
// API as Swagger 2.0 gives the same operations, types, In and Out.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newCollection } from '../src/services/collection.ts';
import { addOperations, apiProblem, readApi } from '../src/services/openApiRest.ts';
import { fromSwagger2, isSwagger2 } from '../src/services/swagger2.ts';

// the API of serviceOpenApi.test.ts, as OpenAPI 3 …
const openApi3 = {
  openapi: '3.0.1',
  info: { title: 'Client API', version: '1.2' },
  servers: [{ url: 'https://api.example.com/v1' }],
  paths: {
    '/clients/{clientKey}': {
      parameters: [{ name: 'clientKey', in: 'path', required: true, schema: { type: 'integer', format: 'int64' } }],
      get: {
        operationId: 'getClientKey',
        summary: 'Read a client',
        parameters: [{ name: 'request-id', in: 'header', schema: { type: 'string' } }],
        responses: {
          200: { description: 'ok', headers: { ETag: { schema: { type: 'string' } } }, content: { 'application/json': { schema: { $ref: '#/components/schemas/Client' } } } },
          404: { description: 'not found' },
        },
      },
      put: {
        operationId: 'putClientKey',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Client' } } } },
        responses: { 204: { description: 'done' } },
      },
    },
    '/clients': {
      get: {
        parameters: [{ name: 'status', in: 'query', schema: { type: 'array', items: { $ref: '#/components/schemas/Status' } } }],
        responses: { 200: { description: 'ok', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Client' } } } } } },
      },
    },
  },
  components: {
    schemas: {
      Client: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', description: 'Full name' },
          birthDate: { type: 'string', format: 'date' },
          status: { $ref: '#/components/schemas/Status' },
          address: { type: 'object', properties: { city: { type: 'string' } } },
          tags: { type: 'array', items: { type: 'string' } },
        },
      },
      Status: { type: 'string', enum: ['active', 'closed'] },
    },
  },
};

// … and as Swagger 2.0
const swagger2 = {
  swagger: '2.0',
  info: { title: 'Client API', version: '1.2' },
  host: 'api.example.com',
  basePath: '/v1',
  schemes: ['https'],
  produces: ['application/json'],
  consumes: ['application/json'],
  paths: {
    '/clients/{clientKey}': {
      parameters: [{ name: 'clientKey', in: 'path', required: true, type: 'integer', format: 'int64' }],
      get: {
        operationId: 'getClientKey',
        summary: 'Read a client',
        parameters: [{ name: 'request-id', in: 'header', type: 'string' }],
        responses: {
          200: { description: 'ok', headers: { ETag: { type: 'string' } }, schema: { $ref: '#/definitions/Client' } },
          404: { description: 'not found' },
        },
      },
      put: {
        operationId: 'putClientKey',
        parameters: [{ name: 'body', in: 'body', required: true, schema: { $ref: '#/definitions/Client' } }],
        responses: { 204: { description: 'done' } },
      },
    },
    '/clients': {
      get: {
        parameters: [{ name: 'status', in: 'query', type: 'array', items: { $ref: '#/definitions/Status' }, collectionFormat: 'multi' }],
        responses: { 200: { description: 'ok', schema: { type: 'array', items: { $ref: '#/definitions/Client' } } } },
      },
    },
  },
  definitions: openApi3.components.schemas,
};

// what the import makes of an API — without the generated ids
function imported(raw: unknown) {
  const api = readApi(raw);
  const c0 = newCollection({ title: 'Kunden', project: 'acme-crm', api: 'client', apiVersion: 1 });
  const { spec, added } = addOperations(c0, api, api.operations.map(o => o.key));
  const ids = new Map<string, string>();
  const named = (id: string) => { if (!ids.has(id)) ids.set(id, `#${ids.size}`); return ids.get(id)!; };
  // generated ids (`t-5aa959fc0f`, `svc-447c1bd64c`) are numbered in order of appearance
  const stable = JSON.parse(JSON.stringify({ spec: { types: spec.types, services: spec.services }, added }), (_k, v) =>
    (typeof v === 'string' && /^[a-z]{1,4}-[0-9a-f]{6,}$/.test(v) ? named(v) : v));
  return {
    basePath: api.basePath,
    operations: api.operations.map(o => ({ key: o.key, name: o.name, params: o.params.map(p => `${p.in}:${p.name}`), body: !!o.body, response: o.response })),
    ...stable,
  };
}

test('a Swagger 2.0 is recognised, an OpenAPI 3 is left as it is', () => {
  assert.ok(isSwagger2(swagger2));
  assert.ok(!isSwagger2(openApi3));
  assert.equal(apiProblem(swagger2), null);
});

test('the same API as Swagger 2.0 imports like its OpenAPI 3', () => {
  assert.deepEqual(imported(swagger2), imported(openApi3));
});

test('definitions, body, response and server become their OpenAPI 3 form', () => {
  const d = fromSwagger2(swagger2) as any;
  assert.equal(d.openapi, '3.0.3');
  assert.deepEqual(d.servers, [{ url: 'https://api.example.com/v1' }]);
  assert.ok(d.components.schemas.Client);
  assert.deepEqual(d.paths['/clients/{clientKey}'].put.requestBody,
    { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Client' } } } });
  assert.deepEqual(d.paths['/clients/{clientKey}'].get.responses[200].content,
    { 'application/json': { schema: { $ref: '#/components/schemas/Client' } } });
  assert.deepEqual(d.paths['/clients'].get.parameters[0].schema,
    { type: 'array', items: { $ref: '#/components/schemas/Status' } });
});

test('a form, a body of the document, x-nullable and a server without host', () => {
  const d = fromSwagger2({
    swagger: '2.0', basePath: '/api',
    parameters: { Person: { name: 'person', in: 'body', required: true, schema: { $ref: '#/definitions/Person' } } },
    paths: {
      '/persons': { post: { parameters: [{ $ref: '#/parameters/Person' }], responses: { 201: { description: 'created' } } } },
      '/upload': {
        post: {
          consumes: ['multipart/form-data'],
          parameters: [{ name: 'file', in: 'formData', type: 'file', required: true }, { name: 'note', in: 'formData', type: 'string' }],
          responses: { 200: { description: 'ok' } },
        },
      },
    },
    definitions: { Person: { type: 'object', properties: { nickname: { type: 'string', 'x-nullable': true } } } },
  }) as any;
  assert.deepEqual(d.servers, [{ url: '/api' }]);
  assert.deepEqual(d.paths['/persons'].post.requestBody, { $ref: '#/components/requestBodies/Person' });
  assert.deepEqual(d.components.requestBodies.Person,
    { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Person' } } } });
  assert.deepEqual(d.paths['/upload'].post.requestBody, {
    required: true,
    content: { 'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' }, note: { type: 'string' } }, required: ['file'] } } },
  });
  assert.equal(d.components.schemas.Person.properties.nickname.nullable, true);
  // the import finds the body of the document through its requestBody
  assert.ok(readApi(d).operations.find(o => o.key === 'POST /persons')?.body);
});
