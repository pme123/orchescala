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
  const svc = { id: 's', name: 'GetX', api: 'client', apiVersion: 1, status: 'draft' as const, method: 'GET' as const, path: '/x/{id}', params: [] };
  assert.deepEqual(serviceIssues({ ...c, services: [svc] }, svc), ['Pfad-Parameter «id» ist nicht beschrieben.']);
});

test('a project of the catalog becomes one collection with its APIs; an OpenAPI completes its services', async () => {
  const { catalogProjects, collectionFromCatalog } = await import('../src/services/catalogCollections');
  const model = {
    version: 1,
    services: [
      { id: 'acme-crm-clientV1.GetClientKey', name: 'GetClientKey', kind: 'service', group: 'Acme CRM', topic: 'acme-crm-clientV1.GetClientKey', description: 'Reads a client' },
      { id: 'acme-crm-clientV1.PutClientKey', name: 'PutClientKey', kind: 'service', topic: 'acme-crm-clientV1.PutClientKey', inputs: [{ name: 'clientKey', required: true }] },
      { id: 'acme-crm-crmV2.GetProductGroups', name: 'GetProductGroups', kind: 'service', topic: 'acme-crm-crmV2.GetProductGroups' },
      { id: 'acme-crm-clientV1', name: 'process', kind: 'call' },
    ],
    domainTypes: [
      { id: 'acme.crm.domain.client.v1.GetClientKey.In', name: 'GetClientKey.In', pkg: 'acme.crm.domain.client.v1', kind: 'case', owner: 'GetClientKey', importPath: 'x', fields: [{ name: 'clientKey', type: 'Long' }] },
      { id: 'acme.crm.domain.client.v1.GetClientKey.Out', name: 'GetClientKey.Out', pkg: 'acme.crm.domain.client.v1', kind: 'case', owner: 'GetClientKey', importPath: 'x', fields: [{ name: 'name', type: 'String' }, { name: 'etag', type: 'Option[String]' }] },
    ],
  } as never;
  const projects = catalogProjects(model);
  assert.deepEqual(projects.map(p => `${p.project} (${p.group}): ${p.apis.map(a => `${a.api}v${a.apiVersion}:${a.services.length}`).join(' ')}`),
    ['acme-crm (Acme CRM): clientv1:2 crmv2:1']);
  const c = collectionFromCatalog(projects[0], projects[0].apis, model);
  assert.equal(c.slug, 'acme-crm');
  assert.deepEqual(c.services.map(s => `${s.api}.v${s.apiVersion}.${s.name}`), ['client.v1.GetClientKey', 'client.v1.PutClientKey', 'crm.v2.GetProductGroups']);
  // only some APIs: a sub set of the project — named after them
  const crmOnly = collectionFromCatalog(projects[0], [projects[0].apis[1]], model);
  assert.deepEqual(crmOnly.services.map(s => s.name), ['GetProductGroups']);
  assert.equal(crmOnly.title, 'Acme CRM Crm');
  assert.equal(crmOnly.slug, 'acme-crm-crm');
  assert.equal(collectionFromCatalog(projects[0], projects[0].apis, model, 'Kunden').slug, 'acme-crm-kunden');
  const { catalogTitle } = await import('../src/services/catalogCollections');
  assert.equal(catalogTitle(projects[0], projects[0].apis), 'Acme CRM');
  assert.equal(catalogTitle({ ...projects[0], apis: [...projects[0].apis, { ...projects[0].apis[0], apiVersion: 2, prefix: 'acme-crm-clientV2' }] }, [projects[0].apis[0]]), 'Acme CRM Client V1');
  const get = c.services.find(s => s.name === 'GetClientKey')!;
  assert.equal(get.path, '');
  assert.deepEqual(c.types.find(t => t.id === get.outTypeId)!.fields!.map(f => `${f.name}:${f.type}${f.optional ? '?' : ''}`), ['name:String', 'etag:String?']);

  // the OpenAPI: GetClientKey completes the one of the catalog, keeps its In/Out and its API
  const api = readApi(doc);
  const getOp = api.operations.find(o => o.name === 'GetClientKey')!;
  assert.equal(serviceOf(c, getOp)?.id, get.id);
  const { spec, added } = addOperations(c, api, [getOp.key], () => ({ api: 'other', apiVersion: 9 }));
  assert.deepEqual(added, ['GetClientKey']);
  assert.equal(spec.services.length, 3);
  const done = spec.services.find(s => s.id === get.id)!;
  assert.equal(done.path, '/clients/{clientKey}');
  assert.equal(done.fromCatalog, undefined);
  assert.equal(`${done.api}.v${done.apiVersion}`, 'client.v1');
  assert.equal(done.outTypeId, get.outTypeId);
  assert.deepEqual([...done.outMappings!].sort((a, b) => a.name.localeCompare(b.name)),
    [{ name: 'etag', expression: '= headers.etag' }, { name: 'name', expression: '= body.name' }]);
});

test('the API of an operation from its sub path; a collection may cover a sub path only', async () => {
  const { suggestApis, inPathPrefix, apiName } = await import('../src/services/openApiRest');
  const ops = ['/banks/{bankNumber}/clients/{clientKey}', '/banks/{bankNumber}/clients', '/banks/{bankNumber}/crm/v2/productGroups', '/banks/{bankNumber}/payment-rules']
    .map(path => ({ key: `GET ${path}`, method: 'GET', path, name: 'X', tags: [], params: [] }) as never);
  const s = suggestApis(ops, { api: 'fallback', apiVersion: 1 });
  assert.deepEqual([...s.values()].map(x => `${x.subPath} → ${x.api} v${x.apiVersion}`), [
    '/banks/{bankNumber}/clients → client v1',
    '/banks/{bankNumber}/clients → client v1',
    '/banks/{bankNumber}/crm/v2 → crm v2',
    '/banks/{bankNumber}/payment-rules → paymentRule v1',
  ]);
  assert.equal(apiName('addresses'), 'address');
  assert.ok(inPathPrefix('/clients/{id}', '/clients/'));
  assert.ok(inPathPrefix('/clients', '/clients'));
  assert.ok(!inPathPrefix('/clientsX', '/clients'));
  assert.ok(inPathPrefix('/anything', ''));
});

test('the scanner reads `val path` of a ServiceTask; the catalog import takes method, path and bodies from it', async () => {
  const { scanScala } = await import('../src/domainScan');
  const { catalogProjects, collectionFromCatalog, parseServicePath } = await import('../src/services/catalogCollections');
  const { isIncomplete } = await import('../src/services/openApiRest');
  const source = `package acme.crm.domain
package rule.v1

import acme.crm.domain.rule.v1.schema.*

object GetRules extends RuleV1:

  final val topicName = "acme-crm-ruleV1.GetRules"
  val descr = "Reads the rules"
  val path  = "GET: /banks/{bankNumber}/clients/{clientKey}/rules"

  type ServiceIn  = NoInput
  type ServiceOut = Rules

  case class In(
      clientKey: Long
  )
  case class Out(
      rules: Seq[Rule]
  )
end GetRules
`;
  const rule = `package acme.crm.domain
package rule.v1.schema

case class Rule(
    name: String
)

type Rules = Seq[Rule]
`;
  // a CustomTask of the project (GET and PUT combined) — no REST call of its own
  const custom = `package acme.crm.domain
package rule.v1

object UpdateRules
    extends CompanyBpmnCustomTaskDsl:

  final val topicName = "acme-crm-ruleV1.UpdateRules"

  case class In(
      clientKey: Long
  )
end UpdateRules
`;
  const domainTypes = [...scanScala(source, 'GetRules.scala'), ...scanScala(rule, 'schema/Rule.scala'), ...scanScala(custom, 'UpdateRules.scala')];
  assert.equal(domainTypes.find(t => t.name === 'GetRules.In')?.ownerPath, 'GET: /banks/{bankNumber}/clients/{clientKey}/rules');
  const model = {
    version: 1, domainTypes,
    services: ['GetRules', 'UpdateRules'].map(n => ({ id: `acme-crm-ruleV1.${n}`, name: n, kind: 'service', topic: `acme-crm-ruleV1.${n}` })),
  } as never;
  const p = catalogProjects(model)[0];
  assert.deepEqual(p.apis[0].services.map(x => x.name), ['GetRules']);
  const c = collectionFromCatalog(p, p.apis, model);
  const svc = c.services[0];
  assert.equal(`${svc.method} ${svc.path}`, 'GET /banks/{bankNumber}/clients/{clientKey}/rules');
  // the bank is in no In: the company sets it in serviceBasePath — no parameter of the service
  assert.equal(c.pathBase, '/banks/{bankNumber}');
  assert.deepEqual(svc.params.map(x => `${x.name}:${x.type}=${x.expression}`), ['clientKey:Long== clientKey']);
  assert.deepEqual(serviceIssues(c, svc), []);
  assert.equal(svc.serviceIn, undefined);
  // the types of the API become types of the collection — the alias `Rules` is `Seq[Rule]`
  const ruleType = c.types.find(t => t.name === 'Rule');
  assert.ok(ruleType && !ruleType.interactionId);
  assert.equal(ruleType.domainId, 'acme.crm.domain.rule.v1.schema.Rule');
  assert.deepEqual(ruleType.fields?.map(f => `${f.name}:${f.type}`), ['name:String']);
  assert.deepEqual(svc.serviceOut, { type: ruleType.id, collection: true });
  const out = c.types.find(t => t.id === svc.outTypeId);
  assert.deepEqual(out?.fields?.map(f => `${f.name}:${f.type}:${!!f.collection}`), [`rules:${ruleType.id}:true`]);
  assert.equal(out?.domainId, undefined);
  // the obvious outputMapper comes pre-filled: the whole body where the field has its type
  assert.deepEqual(svc.outMappings, [{ name: 'rules', expression: '= body' }]);
  // the request is still not complete — an OpenAPI may complete it
  assert.equal(svc.fromCatalog, true);
  assert.ok(isIncomplete(svc));
  assert.deepEqual(parseServicePath('POST: clients/clientId'), { method: 'POST', path: '/clients/clientId' });
  assert.equal(parseServicePath('nonsense'), null);
});

test('the base of the company: suggested from the paths, its placeholders are no parameters', async () => {
  const { suggestPathBase, workerPath, inPathBase } = await import('../src/services/collection');
  const base = newCollection({ title: 'Acme', project: 'acme-crm', api: 'client', apiVersion: 1 });
  const api = readApi({
    openapi: '3.0.1', info: { title: 'x', version: '1' },
    paths: {
      '/banks/{bankNumber}/clients/{clientKey}': {
        get: {
          operationId: 'getClient',
          parameters: [
            { name: 'bankNumber', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'clientKey', in: 'path', required: true, schema: { type: 'integer', format: 'int64' } },
          ],
          responses: { 200: { description: 'ok' } },
        },
      },
    },
  });
  const keys = api.operations.map(o => o.key);
  // without a base both are parameters — and fields of the In, so nothing to suggest
  const plain = addOperations(base, api, keys).spec;
  assert.deepEqual(plain.services[0].params.map(p => p.name), ['bankNumber', 'clientKey']);
  assert.equal(suggestPathBase(plain), '');
  // with the base: the bank comes from serviceBasePath
  const withBase = addOperations({ ...base, pathBase: '/banks/{bankNumber}' }, api, keys).spec;
  const s = withBase.services[0];
  assert.deepEqual(s.params.map(p => p.name), ['clientKey']);
  assert.deepEqual(withBase.types.find(t => t.id === s.inTypeId)?.fields?.map(f => f.name), ['clientKey']);
  assert.deepEqual(serviceIssues(withBase, s), []);
  assert.ok(inPathBase(withBase, s.path));
  assert.equal(workerPath(withBase, s.path), '/clients/{clientKey}');
  assert.equal(workerPath(withBase, '/banksX/{bankNumber}/clients'), '/banksX/{bankNumber}/clients');
  // a leftover parameter of the base is no finding
  const leftover = { ...s, params: [{ name: 'bankNumber', in: 'path' as const, type: 'String', required: true, expression: '' }, ...s.params] };
  assert.deepEqual(serviceIssues(withBase, leftover), []);
});

test('Abgleich with the catalog: the domain wins where it knows, the collection keeps its own', async () => {
  const { scanScala } = await import('../src/domainScan');
  const { catalogProjects, collectionFromCatalog, syncWithCatalog } = await import('../src/services/catalogCollections');
  const task = (name: string, extra = '') => `package acme.crm.domain
package rule.v1

import acme.crm.domain.rule.v1.schema.*

object ${name} extends RuleV1:

  final val topicName = "acme-crm-ruleV1.${name}"
  val path  = "GET: /banks/{bankNumber}/clients/{clientKey}/${name.toLowerCase()}"

  type ServiceIn  = NoInput
  type ServiceOut = Seq[Rule]

  case class In(
      clientKey: Long${extra}
  )
  case class Out(
      rules: Seq[Rule]
  )
end ${name}
`;
  const rule = `package acme.crm.domain
package rule.v1.schema

case class Rule(
    name: String,
    active: Boolean
)
`;
  const custom = `package acme.crm.domain
package rule.v1

object UpdateRules
    extends CompanyBpmnCustomTaskDsl:

  final val topicName = "acme-crm-ruleV1.UpdateRules"

  case class In(
      clientKey: Long
  )
end UpdateRules
`;
  const modelOf = (sources: string[], names: string[]) => ({
    version: 1,
    domainTypes: sources.flatMap((src, i) => scanScala(src, `F${i}.scala`)),
    services: names.map(n => ({ id: `acme-crm-ruleV1.${n}`, name: n, kind: 'service', topic: `acme-crm-ruleV1.${n}` })),
  }) as never;
  const now = modelOf([task('GetRules', ',\n      limit: Option[Int]'), task('GetOldRules'), rule, custom], ['GetRules', 'GetOldRules', 'UpdateRules']);

  // an older import: no path, the body as a reference into the catalog, the custom worker taken over
  const p = catalogProjects(now)[0];
  const base = collectionFromCatalog(p, p.apis, now);
  const getRules = base.services.find(s => s.name === 'GetRules')!;
  const inType = base.types.find(t => t.id === getRules.inTypeId)!;
  const older = {
    ...base,
    pathBase: undefined,
    types: [
      ...base.types.filter(t => !t.domainId).map(t => t.id === inType.id
        ? { ...t, fields: [...t.fields!.filter(f => f.name !== 'limit'), { id: 'mine', name: 'reason', type: 'String', optional: true }] }
        : t),
      { id: 'u1', name: 'In', kind: 'case' as const, interactionId: 'custom', fields: [] },
    ],
    services: [
      ...base.services.filter(s => s.name === 'GetRules').map(s => ({
        ...s, path: '', params: [], fromCatalog: undefined,
        serviceOut: { type: 'dom:acme.crm.domain.rule.v1.schema.Rule', collection: true },
        outMappings: [{ name: 'rules', expression: '= body' }],
        status: 'draft' as const,
      })),
      { id: 'custom', name: 'UpdateRules', api: 'rule', apiVersion: 1, status: 'implemented' as const, method: 'GET' as const, path: '', params: [], inTypeId: 'u1' },
    ],
  };
  const r = syncWithCatalog(older, now)!;
  assert.deepEqual(r.added, ['GetOldRules']);
  assert.deepEqual(r.updated, ['GetRules']);
  assert.deepEqual(r.removed, ['UpdateRules']);
  assert.deepEqual(r.addedTypes, ['Rule']);
  const c = r.spec;
  assert.equal(c.pathBase, '/banks/{bankNumber}');
  const s = c.services.find(x => x.name === 'GetRules')!;
  assert.equal(s.id, getRules.id);
  assert.equal(`${s.method} ${s.path}`, 'GET /banks/{bankNumber}/clients/{clientKey}/getrules');
  assert.deepEqual(s.params.map(x => `${x.name}=${x.expression}`), ['clientKey== clientKey']);
  // the reference into the catalog is now the type of the collection
  const ruleType = c.types.find(t => t.name === 'Rule')!;
  assert.deepEqual(s.serviceOut, { type: ruleType.id, collection: true });
  assert.deepEqual(ruleType.fields?.map(f => f.name), ['name', 'active']);
  // In: the fields of the domain, then the own one; mappings and status stay
  assert.deepEqual(c.types.find(t => t.id === s.inTypeId)?.fields?.map(f => f.name), ['clientKey', 'limit', 'reason']);
  assert.deepEqual(s.outMappings, [{ name: 'rules', expression: '= body' }]);
  assert.equal(s.status, 'draft');
  assert.ok(!c.types.some(t => t.id === 'u1'));
  assert.deepEqual(serviceIssues(c, s), []);

  // a second Abgleich has nothing to do
  const again = syncWithCatalog(c, now)!;
  assert.deepEqual([again.added, again.updated, again.removed, again.addedTypes], [[], [], [], []]);
});

test('the obvious outputMapper: headers, the whole body, a body field, an In field', async () => {
  const { suggestOutMappings } = await import('../src/services/collection');
  const types = [
    { id: 'body', name: 'Client', kind: 'case' as const, fields: [{ id: 'b1', name: 'name', type: 'String' }] },
    { id: 'in', name: 'In', kind: 'case' as const, interactionId: 's', fields: [{ id: 'i1', name: 'clientKey', type: 'Long' }] },
    {
      id: 'out', name: 'Out', kind: 'case' as const, interactionId: 's', fields: [
        { id: 'o1', name: 'name', type: 'String' }, { id: 'o2', name: 'etag', type: 'String', optional: true },
        { id: 'o3', name: 'clientKey', type: 'Long' }, { id: 'o4', name: 'other', type: 'Int' }, { id: 'o5', name: 'done', type: 'String' },
      ],
    },
  ];
  const s = {
    id: 's', name: 'GetClient', api: 'client', apiVersion: 1, status: 'implemented' as const, method: 'GET' as const, path: '/clients/{clientKey}', params: [],
    serviceOut: { type: 'body' }, inTypeId: 'in', outTypeId: 'out', outMappings: [{ name: 'done', expression: '= "x"' }],
  };
  const r = suggestOutMappings({ types }, s);
  assert.deepEqual(r.mappings.map(m => `${m.name} ${m.expression}`), ['name = body.name', 'etag = headers.etag', 'clientKey = clientKey']);
  assert.deepEqual(r.headers, ['etag']);
  // a field of the body's own type takes it whole
  const whole = suggestOutMappings({ types: [...types.slice(0, 2), { ...types[2], fields: [{ id: 'w', name: 'client', type: 'body' }] }] }, s);
  assert.deepEqual(whole.mappings, [{ name: 'client', expression: '= body' }]);
  // an ADT as body: the fields all its cases share
  const adt = { id: 'body', name: 'Client', kind: 'enum' as const, fields: [{ id: 'b1', name: 'name', type: 'String' }], values: [{ name: 'a' }, { name: 'b' }] };
  assert.deepEqual(suggestOutMappings({ types: [adt, ...types.slice(1)] }, s).mappings[0], { name: 'name', expression: '= body.name' });
});

test('NoInput / NoOutput: from the domain, from an OpenAPI, kept by the Abgleich', async () => {
  const { scanScala } = await import('../src/domainScan');
  const { catalogProjects, collectionFromCatalog, syncWithCatalog } = await import('../src/services/catalogCollections');
  const { collectionFiles } = await import('../src/services/scalaCollection');
  const source = `package acme.crm.domain
package rule.v1

object PostCheck extends RuleV1:

  final val topicName = "acme-crm-ruleV1.PostCheck"
  val path  = "POST: /checks"

  type ServiceIn  = NoInput
  type ServiceOut = NoOutput

  type In = NoInput
  type Out = NoOutput
end PostCheck
`;
  const model = {
    version: 1, domainTypes: scanScala(source, 'PostCheck.scala'),
    services: [{ id: 'acme-crm-ruleV1.PostCheck', name: 'PostCheck', kind: 'service', topic: 'acme-crm-ruleV1.PostCheck' }],
  } as never;
  const p = catalogProjects(model)[0];
  const c = collectionFromCatalog(p, p.apis, model);
  const s = c.services[0];
  assert.equal(s.noIn, true);
  assert.equal(s.noOut, true);
  assert.deepEqual(s.outMappings, undefined);
  // the generator writes the aliases — also when the In still has a field
  const withField = { ...c, types: c.types.map(t => (t.id === s.inTypeId ? { ...t, fields: [{ id: 'x', name: 'old', type: 'String' }] } : t)) };
  const task = collectionFiles(withField).find(f => f.path.endsWith('/PostCheck.scala'))!.content;
  assert.match(task, /type In = NoInput/);
  assert.match(task, /type Out = NoOutput/);
  assert.match(task, /in = NoInput\(\),\n {6}out = NoOutput\(\),/);
  // the Abgleich keeps what the domain says, even when the collection said otherwise
  const changed = { ...c, services: [{ ...s, noIn: undefined, noOut: undefined }] };
  assert.equal(syncWithCatalog(changed, model)!.spec.services[0].noIn, true);

  // an OpenAPI operation without parameters, body or response: nothing to give, nothing to get back
  const api = readApi({ openapi: '3.0.1', info: { title: 'x', version: '1' }, paths: { '/ping': { post: { operationId: 'ping', responses: { 204: { description: 'ok' } } } } } });
  const fromApi = addOperations(newCollection({ title: 'A', project: 'acme-crm', api: 'rule', apiVersion: 1 }), api, api.operations.map(o => o.key)).spec.services[0];
  assert.equal(fromApi.noIn, true);
  assert.equal(fromApi.noOut, true);
});

test('the scanner reads enum cases behind an annotation — `) case A(` and `@description("…") case B(`', async () => {
  const { scanScala } = await import('../src/domainScan');
  const source = `package acme.crm.domain
package client.v1.schema

enum MasterCreateOrUpdate:

  def segment: Option[Int]

  @description(
    "Most fields of _MasterCreate_ - only _advisor_ as extra field. "
  ) case MasterCreate(
      @description("Only additional field")
      advisor: Option[String],
      segment: Option[Int]
  ) extends MasterCreateOrUpdate

  @description("No extra fields. ") case MasterUpdate(
      branch: Int,
      segment: Option[Int]
  ) extends MasterCreateOrUpdate
end MasterCreateOrUpdate
`;
  const t = scanScala(source, 'MasterCreateOrUpdate.scala').find(x => x.name === 'MasterCreateOrUpdate')!;
  assert.deepEqual(t.values, ['MasterCreate', 'MasterUpdate']);
  assert.deepEqual(t.cases?.map(c => `${c.name}: ${c.fields?.map(f => f.name).join(', ')}`), ['MasterCreate: advisor, segment', 'MasterUpdate: branch, segment']);
  assert.deepEqual(t.fields?.map(f => `${f.name}:${f.type}`), ['segment:Option[Int]']);

  // every import shares the same way: the `def` fields and those all cases have alike
  const shared = `${source.replace('end MasterCreateOrUpdate', '').replace(/branch: Int,/, 'branch: Int,\n      comment: Option[String],').replace(/advisor: Option\[String\],/, 'advisor: Option[String],\n      comment: Option[String],')}end MasterCreateOrUpdate
`;
  const domainTypes = scanScala(shared, 'MasterCreateOrUpdate.scala');
  const dom = domainTypes.find(x => x.name === 'MasterCreateOrUpdate')!;
  const model = { version: 1, services: [], domainTypes } as never;
  const expectShared = (ty: { fields?: { name: string }[]; values?: { name: string; fields?: { name: string }[] }[] }) => {
    assert.deepEqual(ty.fields?.map(f => f.name), ['segment', 'comment']);
    assert.deepEqual(ty.values?.map(v => `${v.name}: ${(v.fields ?? []).map(f => f.name).join(', ')}`), ['MasterCreate: advisor', 'MasterUpdate: branch']);
  };
  // the import of the types of an API (catalog import of a collection, BPMN import)
  const { Converter } = await import('../src/projectImport');
  const conv = new Converter(domainTypes, 'acme.crm.domain.client.v1', model);
  const convId = conv.convert(dom, {});
  expectShared(conv.types.find(x => x.id === convId)!);
  // an In or Out as a copy of a catalog type
  const { aliasMemberType } = await import('../src/interactions');
  expectShared(aliasMemberType({ id: 'ia', name: 'X' } as never, 'In', dom, model));
});

test('Abgleich from the project folder: its domain wins over the catalog, its ServiceTasks are the services', async () => {
  const { scanScala } = await import('../src/domainScan');
  const { catalogProjects, collectionFromCatalog, syncWithCatalog, withProjectDomain } = await import('../src/services/catalogCollections');
  const { serviceProjectTarget, processTarget } = await import('../src/projectImport');
  const task = (name: string, field: string) => `package acme.crm.domain
package rule.v1

object ${name} extends RuleV1:

  final val topicName = "acme-crm-ruleV1.${name}"
  val descr = "Reads the rules"
  val path  = "GET: /rules"

  type ServiceIn  = NoInput
  type ServiceOut = NoOutput

  case class In(
      ${field}
  )
  type Out = NoOutput
end ${name}
`;
  // the catalog: an older build — GetRules with one field, from the catalog its group
  const catalog = {
    version: 1, domainTypes: scanScala(task('GetRules', 'clientKey: Long'), 'GetRules.scala'),
    services: [{ id: 'acme-crm-ruleV1.GetRules', name: 'GetRules', kind: 'service', group: 'Acme CRM', topic: 'acme-crm-ruleV1.GetRules', description: 'old' }],
  } as never;
  const p = catalogProjects(catalog)[0];
  const c = collectionFromCatalog(p, p.apis, catalog);
  // the project: GetRules has a second field, GetOther is new — neither is in the catalog yet
  const project = [...scanScala(task('GetRules', 'clientKey: Long,\n      limit: Option[Int]'), 'GetRules.scala'), ...scanScala(task('GetOther', 'id: Long'), 'GetOther.scala')];
  const target = serviceProjectTarget('acme-crm');
  assert.equal(target.id, 'acme-crm');
  assert.ok(target.has(project));
  assert.ok(!serviceProjectTarget('acme-other').has(project));
  assert.ok(!processTarget('acme-crm').has(project));
  const m = withProjectDomain(catalog, project);
  assert.deepEqual(m.services.map(s => `${s.name}:${s.group}:${s.description}`), ['GetRules:Acme CRM:Reads the rules', 'GetOther:undefined:Reads the rules']);
  const r = syncWithCatalog(c, m)!;
  assert.deepEqual(r.added, ['GetOther']);
  assert.deepEqual(r.updated, ['GetRules']);
  const s = r.spec.services.find(x => x.name === 'GetRules')!;
  assert.deepEqual(r.spec.types.find(t => t.id === s.inTypeId)?.fields?.map(f => f.name), ['clientKey', 'limit']);
});

test('the OpenAPIs of the project folder: the wrapped ones first, the generated documentation last', async () => {
  const { isGeneratedOpenApi, sortOpenApis } = await import('../src/services/projectOpenApis');
  const paths = ['03-api/OpenApi.yml', '04-helper/src/main/resources/openApi-crm.v2.json', '03-worker/src/main/resources/OpenApi.yml', '04-helper/src/main/resources/openApi-client.v1.json'];
  const files = paths.map(path => ({ path, generated: isGeneratedOpenApi(path) }));
  assert.deepEqual(sortOpenApis(files).map(f => `${f.generated ? 'gen ' : ''}${f.path}`), [
    '04-helper/src/main/resources/openApi-client.v1.json',
    '04-helper/src/main/resources/openApi-crm.v2.json',
    'gen 03-api/OpenApi.yml',
    'gen 03-worker/src/main/resources/OpenApi.yml',
  ]);
  const { ownFolders } = await import('../src/projectImport');
  const model = { version: 1, services: [], projects: [{ name: 'acme' }, { name: 'acme-crm' }, { name: 'other' }] } as never;
  assert.deepEqual(ownFolders(model, 'acme-crm').map(p => p.name), ['acme-crm']);
  assert.deepEqual(ownFolders(model, 'acme-crm-onboarding').map(p => p.name), ['acme-crm']);
  assert.deepEqual(ownFolders(model, 'acme-x').map(p => p.name), ['acme']);
});
