// A REST API (OpenAPI 3) becomes the services of a collection: the operations
// to tick, and for the ticked ones the types, In/Out and first mappings.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newCollection, serviceIssues } from '../src/services/collection';
import { addOperations, apiProblem, camelName, readApi, serviceOf } from '../src/services/openApiRest';

const doc = {
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

test('only OpenAPI 3 is read', () => {
  assert.equal(apiProblem(doc), null);
  assert.match(apiProblem({ swagger: '2.0', paths: {} }) ?? '', /Swagger/);
  assert.match(apiProblem({ openapi: '3.0.0' }) ?? '', /Pfade/);
});

test('every operation is a candidate, named after its operationId or method and path', () => {
  const api = readApi(doc);
  assert.equal(api.basePath, 'https://api.example.com/v1');
  assert.deepEqual(api.operations.map(o => `${o.key} → ${o.name}`), [
    'GET /clients/{clientKey} → GetClientKey',
    'PUT /clients/{clientKey} → PutClientKey',
    'GET /clients → GetClients',
  ]);
  // the parameter of the path applies to both operations
  assert.deepEqual(api.operations[1].params.map(p => p.name), ['clientKey']);
  assert.deepEqual(api.operations[0].response?.headers, ['etag']);
});

test('ticked operations become services with types, In, Out and mappings', () => {
  const api = readApi(doc);
  const c0 = newCollection({ title: 'Kunden', project: 'acme-crm', api: 'client', apiVersion: 1 });
  const { spec, added } = addOperations(c0, api, ['GET /clients/{clientKey}', 'PUT /clients/{clientKey}']);
  assert.deepEqual(added, ['GetClientKey', 'PutClientKey']);

  const byName = (n: string) => spec.types.find(t => t.name === n && !t.interactionId)!;
  const client = byName('Client');
  assert.deepEqual(client.fields!.map(f => `${f.name}:${f.type === byName('Status').id ? 'Status' : f.type === byName('ClientAddress').id ? 'ClientAddress' : f.type}${f.optional ? '?' : ''}${f.collection ? '*' : ''}`),
    ['name:String', 'birthDate:LocalDate?', 'status:Status?', 'address:ClientAddress?', 'tags:String?*']);
  assert.deepEqual(byName('Status').values!.map(v => v.name), ['active', 'closed']);
  // a schema used twice is one type
  assert.equal(spec.types.filter(t => t.name === 'Client').length, 1);

  const get = spec.services.find(s => s.name === 'GetClientKey')!;
  assert.deepEqual(get.params.map(p => `${p.in}:${p.name}=${p.expression}${p.required ? '!' : ''}`), ['path:clientKey== clientKey!', 'header:request-id== requestId']);
  const inGet = spec.types.find(t => t.id === get.inTypeId)!;
  assert.deepEqual(inGet.fields!.map(f => `${f.name}${f.optional ? '?' : ''}`), ['clientKey', 'requestId?']);
  const outGet = spec.types.find(t => t.id === get.outTypeId)!;
  assert.deepEqual(outGet.fields!.map(f => f.name), ['client', 'etag']);
  assert.deepEqual(get.outMappings, [{ name: 'client', expression: '= body' }, { name: 'etag', expression: '= headers.etag' }]);

  // PUT: the body flattened into the In, mapped field by field; no response body
  const put = spec.services.find(s => s.name === 'PutClientKey')!;
  assert.equal(put.serviceIn?.type, client.id);
  assert.equal(put.serviceOut, undefined);
  const inPut = spec.types.find(t => t.id === put.inTypeId)!;
  assert.deepEqual(inPut.fields!.map(f => f.name), ['clientKey', 'name', 'birthDate', 'status', 'address', 'tags']);
  assert.equal(put.bodyMappings?.length, 5);
  assert.deepEqual(serviceIssues(spec, put), []);

  // a second import keeps what is there and adds the rest
  assert.ok(serviceOf(spec, api.operations[0]));
  const again = addOperations(spec, api, api.operations.map(o => o.key));
  assert.deepEqual(again.added, ['GetClients']);
  const list = again.spec.services.find(s => s.name === 'GetClients')!;
  assert.equal(list.serviceOut?.collection, true);
  assert.deepEqual(again.spec.types.find(t => t.id === list.outTypeId)!.fields!.map(f => `${f.name}${f.collection ? '*' : ''}`), ['clients*']);
  assert.equal(again.spec.types.filter(t => t.name === 'Client').length, 1);
});

test('header names become Scala names', () => {
  assert.equal(camelName('request-id'), 'requestId');
  assert.equal(camelName('X-Client_Key'), 'xClientKey');
  assert.equal(camelName('1st'), 'v1st');
});

test('a placeholder in the path without parameter is a finding', () => {
  const c = newCollection({ title: 'x', project: 'acme-crm', api: 'client', apiVersion: 1 });
  const svc = { id: 's', name: 'GetX', status: 'draft' as const, method: 'GET' as const, path: '/x/{id}', params: [] };
  assert.deepEqual(serviceIssues({ ...c, services: [svc] }, svc), ['Pfad-Parameter «id» ist nicht beschrieben.']);
});
