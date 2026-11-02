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
    ['headers', { scala: 'headers', headers: ['ETag', 'X-Finnova-Transaction-Id'] }],
  ]);
  const types = [client, address];
  assert.deepEqual(feelToScala('= clientKey', vars, types), { scala: 'in.clientKey', optional: false });
  assert.deepEqual(feelToScala('= body.name', vars, types), { scala: 'body.name', optional: false });
  assert.deepEqual(feelToScala('= body.address', vars, types), { scala: 'body.address', optional: true });
  assert.deepEqual(feelToScala('= body.address.city', vars, types), { scala: 'body.address.flatMap(_.city)', optional: true });
  // a header by its real name, whatever the case the server sends
  assert.deepEqual(feelToScala('= headers.etag', vars, types), { scala: 'headers.find(_._1.equalsIgnoreCase("ETag")).map(_._2)', optional: true });
  assert.equal(feelToScala('= headers.xFinnovaTransactionId', vars, types).scala, 'headers.find(_._1.equalsIgnoreCase("X-Finnova-Transaction-Id")).map(_._2)');
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
  assert.match(w, /yield Out\(\n {6}name = body\.name,\n {6}city = city,\n {6}etag = headers\.find\(_\._1\.equalsIgnoreCase\("etag"\)\)\.map\(_\._2\)\n {4}\)/);
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

test('enums as in the process: a case from a text, the shared fields of an ADT, the package of the API', async () => {
  const productType: TypeDef = { id: 't-pt', name: 'ProductType', kind: 'enum', values: [{ name: 'Account' }, { name: 'Power of attorney' }] };
  const clientRead: TypeDef = {
    id: 't-cr', name: 'ClientRead', kind: 'enum', fields: [{ id: 's1', name: 'master', type: 'String' }],
    values: [{ name: 'private', fields: [{ id: 'p1', name: 'person', type: 'String' }] }, { name: 'company' }],
  };
  const types = [productType, clientRead];
  const target = { type: 't-pt' };
  assert.deepEqual(feelToScala('= "Account"', new Map(), types, target), { scala: 'ProductType.Account', optional: false });
  assert.equal(feelToScala('= "Power of attorney"', new Map(), types, target).scala, 'ProductType.`Power of attorney`');
  assert.match(feelToScala('= "Nope"', new Map(), types, target).scala, /^\?\?\? \/\* TODO «Nope» ist kein Fall von ProductType/);
  assert.equal(feelToScala('= "x"', new Map(), types, { type: 't-cr' }).todo, true);
  // a text stays a text where the target is no enum
  assert.equal(feelToScala('= "Account"', new Map(), types, { type: 'String' }).scala, '"Account"');
  // the fields all cases of an ADT share
  const vars = new Map<string, ScalaVar>([['body', { scala: 'body', type: 't-cr' }]]);
  assert.deepEqual(feelToScala('= body.master', vars, types), { scala: 'body.master', optional: false });
  assert.equal(feelToScala('= body.person', vars, types).todo, true);

  // the type editor sees the types of the API as its own — not as referenced from elsewhere
  const { processFrame, typeHome } = await import('../src/services/collection');
  const { packageOf, referencedClass } = await import('../src/scala');
  const c = { ...collection(), types: [...collection().types, { ...productType, domainId: 'acme.crm.domain.client.v1.schema.ProductType' }] };
  assert.equal(typeHome(c, 't-pt'), 'acme.crm.domain.client.v1');
  assert.equal(packageOf(processFrame(c, typeHome(c, 't-pt'))), 'acme.crm.domain.client.v1');
  const model = { version: 1, services: [], domainTypes: [{ id: 'acme.crm.domain.client.v1.schema.ProductType', name: 'ProductType', pkg: 'acme.crm.domain.client.v1.schema', kind: 'enum', importPath: 'x', values: ['Account'] }] } as never;
  assert.deepEqual(referencedClass(c.types.find(t => t.id === 't-pt')!, model, typeHome(c, 't-pt')), {});
});

test('serviceBasePath as the project has it — read from the worker exports, written by the export', async () => {
  const { scanScala } = await import('../src/domainScan');
  const exportsSource = `package acme.crm.worker
package client.v1

import acme.crm.domain.client.v1.schema.Client

def serviceBasePath: String =
  s"$crmBasePath/clientadministration/api/v1/banks/$bankNumber"

private[v1] def helper(c: Client): Client = c
`;
  const def = scanScala(exportsSource, 'exports.scala').find(t => t.kind === 'def');
  assert.deepEqual([def?.id, def?.expression], ['acme.crm.worker.client.v1.serviceBasePath', 's"$crmBasePath/clientadministration/api/v1/banks/$bankNumber"']);
  const c = { ...collection(), serviceBasePaths: { 'client.v1': def!.expression! } };
  const exports = collectionFiles(c).find(f => f.path.endsWith('/exports.scala'))!.content;
  assert.match(exports, /def serviceBasePath: String =\n {2}s"\$crmBasePath\/clientadministration\/api\/v1\/banks\/\$bankNumber"\n/);
  assert.doesNotMatch(exports, /\?\?\?/);
});

test('a header of the response maps to the Out field it ends with', async () => {
  const { suggestOutMappings } = await import('../src/services/collection');
  const c = collection();
  const s = { ...c.services[0], outMappings: [], responseHeaders: ['X-Finnova-Transaction-Id'] };
  const out = c.types.find(t => t.id === s.outTypeId)!;
  const types = c.types.map(t => (t.id === out.id ? { ...t, fields: [{ id: 'x', name: 'transactionId', type: 'String' }] } : t));
  assert.deepEqual(suggestOutMappings({ types }, s), { mappings: [{ name: 'transactionId', expression: '= headers.xFinnovaTransactionId' }], headers: [] });
});

test('an In with cases (ADT): enum In with the shared fields as def, its examples typed with the enum', () => {
  const c = collection();
  // the In of GetClient: either one key or several — `requestId` in every case
  const adt: ServiceCollectionSpec = {
    ...c,
    types: c.types.map(t => (t.id !== 't-in' ? t : {
      ...t, kind: 'enum',
      fields: [{ id: 'b', name: 'requestId', type: 'String', optional: true }],
      values: [
        { name: 'ByKey', fields: [{ id: 'a', name: 'clientKey', type: 'Long' }] },
        { name: 'ByKeys', fields: [{ id: 'k', name: 'clientKeys', type: 'String', collection: true }] },
      ],
    })),
  };
  const files = collectionFiles(adt);
  const domain = files.find(f => f.path.endsWith('/GetClient.scala') && f.path.startsWith('01-domain'))!.content;
  assert.match(domain, /enum In:\n(.*\n)*?\s+def requestId: Option\[String\]/, domain);
  assert.match(domain, /case ByKey\(/, domain);
  assert.match(domain, /case ByKeys\(/, domain);
  assert.match(domain, /lazy val example: In = ByKey\.example/, domain);
  assert.match(domain, /lazy val exampleMinimal: In = ByKey\.exampleMinimal/, domain);
  // not NoInput: the content of an ADT is in its cases
  assert.doesNotMatch(domain, /type In = NoInput/, domain);
  assert.match(domain, /in = In\.example,/, domain);
  assert.match(domain, /in = In\.exampleMinimal,/, domain);

  const worker = files.find(f => f.path.endsWith('GetClientWorker.scala'))!.content;
  // a shared field is read as before; a field of one case through a match — optional,
  // so the required path parameter takes it with a TODO for the other case
  assert.match(worker, /in\.requestId/, worker);
  assert.match(worker, /\(in match \{ case v: In\.ByKey => Some\(v\.clientKey\); case _ => None \}\)/, worker);
});

test('fieldAccess: a field in every case is read without None, an optional one without Some', async () => {
  const { fieldAccess, fieldsOnce } = await import('../src/scala.ts');
  const t: TypeDef = {
    id: 't', name: 'In', kind: 'enum',
    fields: [{ id: 's', name: 'shared', type: 'String' }],
    values: [
      { name: 'A', fields: [{ id: 'a1', name: 'both', type: 'Long' }, { id: 'a2', name: 'onlyA', type: 'String', optional: true }] },
      { name: 'B', fields: [{ id: 'b1', name: 'both', type: 'Long' }] },
      { name: 'Empty' },
    ],
  };
  const access = Object.fromEntries(fieldAccess(t).map(a => [a.field.name, `${a.scala} ${a.optional ? '?' : '!'}`]));
  assert.deepEqual(access, {
    shared: 'in.shared !',
    // not in «Empty» — optional
    both: '(in match { case v: In.A => Some(v.both); case v: In.B => Some(v.both); case _ => None }) ?',
    onlyA: '(in match { case v: In.A => v.onlyA; case _ => None }) ?',
  });
  // the variables of the mappers: every name once, as for the In of a process
  assert.deepEqual(fieldsOnce(t).map(f => f.name), ['shared', 'both', 'onlyA']);
  const noEmpty: TypeDef = { ...t, values: t.values!.slice(0, 2) };
  assert.equal(fieldAccess(noEmpty).find(a => a.field.name === 'both')?.scala, '(in match { case v: In.A => v.both; case v: In.B => v.both })');
});

test('FEEL if/then/else and lists become Scala — a variable checked against null is there in its branch', () => {
  const vars = new Map<string, ScalaVar>([
    ['clientKey', { scala: '(in match { case v: In.ByKey => Some(v.clientKey); case _ => None })', type: 'String', optional: true }],
    ['clientKeys', { scala: '(in match { case v: In.ByKeys => Some(v.clientKeys); case _ => None })', type: 'String', optional: true, collection: true }],
    ['count', { scala: 'in.count', type: 'Int' }],
    ['name', { scala: 'in.name', type: 'String' }],
  ]);
  const seq = { type: 'String', collection: true };
  // the case of the user: one key or several
  assert.deepEqual(feelToScala('= if clientKey != null then [ clientKey ] else clientKeys', vars, [], seq), {
    scala: '((in match { case v: In.ByKey => Some(v.clientKey); case _ => None }) match { case Some(clientKey) => Some(Seq(clientKey)); case None => (in match { case v: In.ByKeys => Some(v.clientKeys); case _ => None }) })',
    optional: true,
  });
  // = null the other way round
  assert.equal(feelToScala('= if clientKey = null then "none" else clientKey', vars, []).scala,
    '((in match { case v: In.ByKey => Some(v.clientKey); case _ => None }) match { case Some(clientKey) => clientKey; case None => "none" })');
  // a condition of its own — both sure
  assert.deepEqual(feelToScala('= if count > 3 then "many" else name', vars, []), { scala: '(if in.count > 3 then "many" else in.name)', optional: false });
  // nested
  assert.equal(feelToScala('= if count > 3 then if count > 9 then "lots" else "many" else "few"', vars, []).scala,
    '(if in.count > 3 then (if in.count > 9 then "lots" else "many") else "few")');
  // lists: sure elements, a comma in a text, an optional element that falls away, empty
  assert.deepEqual(feelToScala('= [ name, "a, b" ]', vars, [], seq), { scala: 'Seq(in.name, "a, b")', optional: false });
  assert.equal(feelToScala('= [ name, clientKey ]', vars, [], seq).scala, 'Seq(Some(in.name), (in match { case v: In.ByKey => Some(v.clientKey); case _ => None })).flatten');
  assert.equal(feelToScala('= []', vars, [], seq).scala, 'Seq.empty');
  // what is not understood stays FEEL
  assert.equal(feelToScala('= if upper case(name) = "X" then 1 else 2', vars, []).todo, true);
});

test('FEEL if x != null with x of some cases of an ADT In: one match on the cases', async () => {
  const { fieldAccess } = await import('../src/scala.ts');
  const inType = (extra: TypeDef['values'] = []): TypeDef => ({
    id: 't', name: 'In', kind: 'enum',
    fields: [{ id: 's', name: 'readFromFcs', type: 'Boolean' }],
    values: [
      { name: 'ClientKey', fields: [{ id: 'a', name: 'clientKey', type: 'String' }] },
      { name: 'Standard', fields: [{ id: 'b', name: 'clientKeys', type: 'String', collection: true }] },
      ...extra,
    ],
  });
  const varsOf = (t: TypeDef) => new Map<string, ScalaVar>(fieldAccess(t).map(({ field: f, scala, optional, byCase }) =>
    [f.name, { scala, type: f.type, optional, collection: !!f.collection, ...(byCase ? { byCase } : {}) }]));
  const seq = { type: 'String', collection: true };
  // the case of the user: each case gives its keys
  assert.deepEqual(feelToScala('= if clientKey != null then [ clientKey ] else clientKeys', varsOf(inType()), [], seq), {
    scala: '(in match { case v: In.ClientKey => Seq(v.clientKey); case v: In.Standard => v.clientKeys })',
    optional: false,
  });
  // a case with neither: there the value is missing - the others become Some
  assert.deepEqual(feelToScala('= if clientKey != null then [ clientKey ] else clientKeys', varsOf(inType([{ name: 'Empty' }])), [], seq), {
    scala: '(in match { case v: In.ClientKey => Some(Seq(v.clientKey)); case v: In.Standard => Some(v.clientKeys); case v: In.Empty => None })',
    optional: true,
  });
  // a case where the field is optional decides by it
  const optional = inType();
  optional.values![0].fields![0].optional = true;
  assert.equal(feelToScala('= if clientKey != null then [ clientKey ] else clientKeys', varsOf(optional), [], seq).scala,
    '(in match { case v: In.ClientKey => (v.clientKey match { case Some(clientKey) => Some(Seq(clientKey)); case None => None }); case v: In.Standard => Some(v.clientKeys) })');
});
