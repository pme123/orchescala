// A service collection becomes Orchescala code: the ServiceTask in the domain and
// the ServiceWorker with its mappings, translated from FEEL.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newCollection } from '../src/services/collection';
import { feelToScala, type ScalaVar } from '../src/services/feelScala';
import { collectionBundle, collectionFiles } from '../src/services/scalaCollection';
import type { ServiceCollectionSpec } from '../src/services/types';
import type { TypeDef } from '../src/types';

const address: TypeDef = { id: 't-addr', name: 'Address', kind: 'case', fields: [{ id: 'f1', name: 'city', type: 'String', optional: true }] };
const client: TypeDef = {
  id: 't-client', name: 'Client', kind: 'case',
  fields: [{ id: 'f2', name: 'name', type: 'String' }, { id: 'f3', name: 'address', type: 't-addr', optional: true }],
};

test('FEEL paths become Scala — with Option along the way', () => {
  const vars = new Map<string, ScalaVar>([
    ['clientKey', { scala: 'in.clientKey', type: 'Long' }],
    ['body', { scala: 'body', type: 't-client' }],
    ['headers', { scala: 'headers', headers: true }],
  ]);
  const types = [client, address];
  assert.deepEqual(feelToScala('= clientKey', vars, types), { scala: 'in.clientKey', optional: false });
  assert.deepEqual(feelToScala('= body.name', vars, types), { scala: 'body.name', optional: false });
  assert.deepEqual(feelToScala('= body.address', vars, types), { scala: 'body.address', optional: true });
  assert.deepEqual(feelToScala('= body.address.city', vars, types), { scala: 'body.address.flatMap(_.city)', optional: true });
  assert.deepEqual(feelToScala('= headers.ETag', vars, types), { scala: 'headers.get("etag")', optional: true });
  assert.deepEqual(feelToScala('= 3', vars, types, { type: 'Long' }), { scala: '3L', optional: false });
  assert.deepEqual(feelToScala('= "CH"', vars, types), { scala: '"CH"', optional: false });
  assert.deepEqual(feelToScala('fix', vars, types), { scala: '"fix"', optional: false });
  // what is not a path stays FEEL for a human
  assert.equal(feelToScala('= upper case(body.name)', vars, types).todo, true);
  assert.match(feelToScala('= body.nope', vars, types).scala, /TODO «nope» gibt es nicht/);
});

const collection = (): ServiceCollectionSpec => {
  const c = newCollection({ title: 'Kunden', project: 'acme-crm', api: 'client', apiVersion: 1 });
  const inT: TypeDef = {
    id: 't-in', name: 'In', kind: 'case', interactionId: 's1',
    fields: [{ id: 'a', name: 'clientKey', type: 'Long' }, { id: 'b', name: 'requestId', type: 'String', optional: true }],
  };
  const outT: TypeDef = {
    id: 't-out', name: 'Out', kind: 'case', interactionId: 's1',
    fields: [{ id: 'c', name: 'name', type: 'String' }, { id: 'd', name: 'city', type: 'String' }, { id: 'e', name: 'etag', type: 'String', optional: true }],
  };
  return {
    ...c,
    source: { basePath: 'https://api.example.com', version: '2.0' },
    types: [client, address, inT, outT],
    services: [{
      id: 's1', name: 'GetClient', api: 'client', apiVersion: 1, status: 'draft', method: 'GET', path: '/clients/{clientKey}',
      description: 'Read a client',
      params: [
        { name: 'clientKey', in: 'path', type: 'Long', required: true, expression: '= clientKey' },
        { name: 'request-id', in: 'header', type: 'String', expression: '= requestId' },
      ],
      serviceOut: { type: 't-client' }, responseStatus: 200, responseHeaders: ['etag'],
      inTypeId: 't-in', outTypeId: 't-out',
      outMappings: [
        { name: 'name', expression: '= body.name' },
        { name: 'city', expression: '= body.address.city' },
        { name: 'etag', expression: '= headers.etag' },
      ],
    }],
  };
};

test('the files of a collection: trait, ServiceTask, schema, exports, worker', () => {
  assert.deepEqual(collectionFiles(collection()).map(f => f.path), [
    '01-domain/src/main/scala/acme/crm/domain/client/v1/ClientV1.scala',
    '01-domain/src/main/scala/acme/crm/domain/client/v1/GetClient.scala',
    '01-domain/src/main/scala/acme/crm/domain/client/v1/schema/Client.scala',
    '01-domain/src/main/scala/acme/crm/domain/client/v1/schema/Address.scala',
    '03-worker/src/main/scala/acme/crm/worker/client/v1/exports.scala',
    '03-worker/src/main/scala/acme/crm/worker/client/v1/GetClientWorker.scala',
  ]);
});

test('the ServiceTask: topic, path, types and mock', () => {
  const task = collectionFiles(collection()).find(f => f.path.endsWith('/GetClient.scala'))!.content;
  assert.match(task, /^package acme\.crm\.domain\npackage client\.v1\n/);
  assert.match(task, /object GetClient extends ClientV1:/);
  assert.match(task, /final val topicName = "acme-crm-clientV1\.GetClient"/);
  assert.match(task, /val path = "GET: \/clients\/\{clientKey\}"/);
  assert.match(task, /type ServiceIn = NoInput\n {2}type ServiceOut = Client/);
  assert.match(task, /MockedServiceResponse\.success\(200, example, Map\("etag" -> "\\"etag-example\\""\)\)/);
  assert.match(task, /serviceTask\(\n {6}in = In\.example,\n {6}out = Out\.example,/);
  const trait = collectionFiles(collection())[0].content;
  assert.match(trait, /final val serviceVersion = "2\.0"/);
  assert.match(trait, /trait ClientV1\n {2}extends CompanyBpmnServiceTaskDsl:/);
});

test('the worker: uri, headers and an output mapper that fails on a missing required value', () => {
  const w = collectionFiles(collection()).find(f => f.path.endsWith('GetClientWorker.scala'))!.content;
  assert.match(w, /class GetClientWorker\n {2}extends CompanyServiceWorkerDsl\[In, Out, ServiceIn, ServiceOut\]:/);
  assert.match(w, /override lazy val method = Method\.GET/);
  assert.match(w, /uri"\$serviceBasePath\/clients\/\$\{in\.clientKey\}"/);
  assert.match(w, /in\.requestId\.map\(v => "request-id" -> v\)\.toMap/);
  // city is required in the Out, but optional on the way — a step that names what is missing
  assert.match(w, /city <- body\.address\.flatMap\(_\.city\)\.toRight\(ServiceMappingError\("GetClient: city fehlt in der Antwort"\)\)/);
  assert.match(w, /yield Out\(\n {6}name = body\.name,\n {6}city = city,\n {6}etag = headers\.get\("etag"\)\n {4}\)/);
  assert.doesNotMatch(w, /inputMapper/);
});

test('the bundle has the frame the helper splits', () => {
  const b = collectionBundle(collection());
  assert.match(b, /^\/\/ ─{72}\n\/\/ 01-domain\/src\/main\/scala\/acme\/crm\/domain\/client\/v1\/ClientV1\.scala\n\/\/ ─{72}\n/);
});

test('several APIs: one package each, a shared type lives with the first API that uses it', () => {
  const c = collection();
  const out2: TypeDef = { id: 't-out2', name: 'Out', kind: 'case', interactionId: 's2', fields: [{ id: 'g', name: 'client', type: 't-client' }] };
  const two: ServiceCollectionSpec = {
    ...c,
    types: [...c.types, out2],
    services: [...c.services, {
      id: 's2', name: 'GetProductGroups', api: 'crm', apiVersion: 2, status: 'draft', method: 'GET', path: '/crm/v2/productGroups',
      params: [], serviceOut: { type: 't-client' }, outTypeId: 't-out2', outMappings: [{ name: 'client', expression: '= body' }],
    }],
  };
  const files = collectionFiles(two);
  assert.deepEqual(files.map(f => f.path.replace(/^0\d-(domain|worker)\/src\/main\/scala\/acme\/crm\//, '')), [
    'domain/client/v1/ClientV1.scala',
    'domain/client/v1/GetClient.scala',
    'domain/client/v1/schema/Client.scala',
    'domain/client/v1/schema/Address.scala',
    'worker/client/v1/exports.scala',
    'worker/client/v1/GetClientWorker.scala',
    'domain/crm/v2/CrmV2.scala',
    'domain/crm/v2/GetProductGroups.scala',
    'worker/crm/v2/exports.scala',
    'worker/crm/v2/GetProductGroupsWorker.scala',
  ]);
  const crm = files.find(f => f.path.endsWith('/GetProductGroups.scala'))!.content;
  assert.match(crm, /^package acme\.crm\.domain\npackage crm\.v2\n/);
  assert.match(crm, /import acme\.crm\.domain\.client\.v1\.schema\.\*/);
  assert.match(crm, /object GetProductGroups extends CrmV2:/);
  assert.match(crm, /final val topicName = "acme-crm-crmV2\.GetProductGroups"/);
  assert.match(files.find(f => f.path.endsWith('/CrmV2.scala'))!.content, /final val serviceVersion = "2\.0"/);
  assert.match(files.find(f => f.path.endsWith('GetProductGroupsWorker.scala'))!.content, /^package acme\.crm\.worker\npackage crm\.v2\n/);
});

test('a base the company sets: serviceBasePath has it, the worker adds the rest', () => {
  const base = collection();
  const c: ServiceCollectionSpec = {
    ...base,
    pathBase: '/banks/{bankNumber}/',
    source: { ...base.source, basePath: 'https://api.example.com/v1' },
    services: base.services.map(s => ({
      ...s,
      path: `/banks/{bankNumber}${s.path}`,
      params: [{ name: 'bankNumber', in: 'path', type: 'String', required: true, expression: '' }, ...s.params],
    })),
  };
  const files = collectionFiles(c);
  const w = files.find(f => f.path.endsWith('GetClientWorker.scala'))!.content;
  assert.match(w, /uri"\$serviceBasePath\/clients\/\$\{in\.clientKey\}"/);
  assert.doesNotMatch(w, /bankNumber/);
  const exports = files.find(f => f.path.endsWith('/exports.scala'))!.content;
  assert.match(exports, /s"https:\/\/api\.example\.com\/v1\/banks\/\$\{\?\?\? \/\* TODO bankNumber — wie die Firma ihn setzt \*\/\}"/);
  // `val path` keeps the whole path — as the API names it
  const task = files.find(f => f.path.endsWith('/GetClient.scala'))!.content;
  assert.match(task, /val path = "GET: \/banks\/\{bankNumber\}\/clients\/\{clientKey\}"/);
});
