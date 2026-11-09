// Nested APIs (`clientMaster.multipleNaturalPersons`): only the package follows the
// hierarchy, the name is its last part; shared classes live in the `schema` of a level.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scanScala } from '../src/domainScan';
import { catalogProjects, collectionFromCatalog, nestedApi, syncWithCatalog } from '../src/services/catalogCollections';
import {
  API_NAME, apiName, collectionPackage, collectionTrait, domainDir, hierarchySchemaPackages, newCollection, serviceIssues, serviceTopic, workerPackage,
} from '../src/services/collection';
import { adoptHierarchyTypes, commonParents, schemaHomes } from '../src/services/hierarchy';
import { addOperations, readApi } from '../src/services/openApiRest';
import { collectionFiles } from '../src/services/scalaCollection';
import type { ServiceCollectionSpec } from '../src/services/types';

const nested = { project: 'acme-crm', api: 'clientMaster.multipleNaturalPersons', apiVersion: 1 };

test('a nested API: the package follows the hierarchy, trait and topic keep the last part', () => {
  assert.ok(API_NAME.test('clientMaster.multipleNaturalPersons'));
  assert.ok(!API_NAME.test('clientMaster.'));
  assert.ok(!API_NAME.test('ClientMaster.x'));
  assert.equal(apiName('ClientMaster.MultipleNaturalPersons'), 'clientMaster.multipleNaturalPersons');
  assert.equal(collectionPackage(nested), 'acme.crm.domain.clientMaster.multipleNaturalPersons.v1');
  assert.equal(workerPackage(nested), 'acme.crm.worker.clientMaster.multipleNaturalPersons.v1');
  assert.equal(domainDir(nested), '01-domain/src/main/scala/acme/crm/domain/clientMaster/multipleNaturalPersons/v1');
  assert.equal(collectionTrait(nested), 'MultipleNaturalPersonsV1');
  assert.equal(serviceTopic(nested, { name: 'GetX' }), 'acme-crm-multipleNaturalPersonsV1.GetX');
  assert.deepEqual(hierarchySchemaPackages({ project: 'acme-crm', api: 'a.b.c' }), ['acme.crm.domain.a.b.schema', 'acme.crm.domain.a.schema']);
  assert.deepEqual(hierarchySchemaPackages({ project: 'acme-crm', api: 'client' }), []);
  assert.deepEqual(commonParents([{ api: 'a.b.x' }, { api: 'a.b.y' }, { api: 'a.c' }]), ['a']);
});

const doc = {
  openapi: '3.0.1', info: { title: 'Client Master', version: '1' },
  paths: {
    '/naturalPersons': { get: { operationId: 'getNaturalPersons', responses: { 200: { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/NaturalPerson' } } } } } } },
    '/legalPersons': { get: { operationId: 'getLegalPersons', responses: { 200: { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/LegalPerson' } } } } } } },
  },
  components: {
    schemas: {
      NaturalPerson: { type: 'object', properties: { name: { type: 'string' }, gender: { $ref: '#/components/schemas/Gender' }, address: { $ref: '#/components/schemas/Address' } } },
      LegalPerson: { type: 'object', properties: { name: { type: 'string' }, address: { $ref: '#/components/schemas/Address' } } },
      Address: { type: 'object', properties: { city: { type: 'string' } } },
      Gender: { type: 'string', enum: ['male', 'female'] },
    },
  },
};

function twoApis(): ServiceCollectionSpec {
  const c0 = newCollection({ title: 'Client Master', project: 'acme-crm', api: 'clientMaster.naturalPersons', apiVersion: 1 });
  const api = readApi(doc);
  const apiFor = (op: { path: string }) => ({ api: op.path === '/naturalPersons' ? 'clientMaster.naturalPersons' : 'clientMaster.legalPersons', apiVersion: 1 });
  return addOperations(c0, api, api.operations.map(o => o.key), apiFor).spec;
}

test('the export: a type the APIs of a level share lives in the schema of that level', () => {
  const c = twoApis();
  const homes = schemaHomes(c);
  const homeOf = (name: string) => homes.get(c.types.find(t => t.name === name)!.id)?.pkg;
  assert.equal(homeOf('Address'), 'acme.crm.domain.clientMaster.schema');
  assert.equal(homeOf('Gender'), 'acme.crm.domain.clientMaster.naturalPersons.v1.schema');
  const files = collectionFiles(c);
  const address = files.find(f => f.path.endsWith('/Address.scala'))!;
  assert.equal(address.path, '01-domain/src/main/scala/acme/crm/domain/clientMaster/schema/Address.scala');
  assert.match(address.content, /^package acme\.crm\.domain\npackage clientMaster\.schema\n/);
  const trait = files.find(f => f.path.endsWith('/NaturalPersonsV1.scala'))!;
  assert.equal(trait.path, '01-domain/src/main/scala/acme/crm/domain/clientMaster/naturalPersons/v1/NaturalPersonsV1.scala');
  assert.match(trait.content, /package clientMaster\.naturalPersons\.v1\n/);
  const get = files.find(f => f.path.endsWith('/naturalPersons/v1/GetNaturalPersons.scala'))!;
  assert.match(get.content, /object GetNaturalPersons extends NaturalPersonsV1:/);
  assert.match(get.content, /"acme-crm-naturalPersonsV1\.GetNaturalPersons"/);
  // the type of its own schema reaches into the shared one: both imported
  const person = files.find(f => f.path.endsWith('/NaturalPerson.scala'))!;
  assert.match(person.content, /import acme\.crm\.domain\.clientMaster\.schema\.\*/);
  // each schema file once
  assert.equal(files.filter(f => f.path.endsWith('/Address.scala')).length, 1);
});

/** the project has `Address` in the root of the hierarchy — `clientMaster.schema` */
const sharedAddress = `package acme.crm.domain
package clientMaster.schema

case class Address(
    city: String
)
`;

test('an OpenAPI import takes a class of the same name higher up in the hierarchy', () => {
  const model = { version: 1, services: [], domainTypes: scanScala(sharedAddress, 'clientMaster/schema/Address.scala') } as never;
  const { spec, adopted } = adoptHierarchyTypes(twoApis(), model);
  assert.deepEqual(adopted.map(a => a.from), ['acme.crm.domain.clientMaster.schema.Address']);
  assert.ok(!spec.types.some(t => t.name === 'Address'));
  const person = spec.types.find(t => t.name === 'NaturalPerson')!;
  assert.equal(person.fields?.find(f => f.name === 'address')?.type, 'dom:acme.crm.domain.clientMaster.schema.Address');
  // the export imports it — and does not write it again
  const files = collectionFiles(spec, model);
  assert.ok(!files.some(f => f.path.endsWith('/Address.scala')));
  assert.match(files.find(f => f.path.endsWith('/NaturalPerson.scala'))!.content, /import acme\.crm\.domain\.clientMaster\.schema\.Address/);
  // the same name, but other fields: taken all the same, the difference shown
  const withZip = { ...twoApis(), types: twoApis().types.map(t => (t.name === 'Address' ? { ...t, fields: [...t.fields!, { id: 'z', name: 'zip', type: 'String' }] } : t)) };
  assert.deepEqual(adoptHierarchyTypes(withZip, model).adopted.map(a => a.differs), [['-zip']]);
  assert.equal(adopted[0].differs, undefined);
  // without a hierarchy nothing changes
  const flat = { ...twoApis(), services: twoApis().services.map(s => ({ ...s, api: 'client' })) };
  assert.deepEqual(adoptHierarchyTypes(flat, model).adopted, []);
});

const getPersons = `package acme.crm.domain
package clientMaster.multipleNaturalPersons.v1

import acme.crm.domain.clientMaster.schema.*

object GetPersons extends MultipleNaturalPersonsV1:

  final val topicName = "acme-crm-multipleNaturalPersonsV1.GetPersons"
  val path = "GET: /persons"

  type ServiceIn = NoInput
  type ServiceOut = Address

  case class In(
      key: Long
  )
  case class Out(
      address: Address
  )
end GetPersons
`;

function catalogModel() {
  const domainTypes = [...scanScala(getPersons, 'GetPersons.scala'), ...scanScala(sharedAddress, 'clientMaster/schema/Address.scala')];
  return {
    version: 1, domainTypes,
    services: [{ id: 'acme-crm-multipleNaturalPersonsV1.GetPersons', name: 'GetPersons', kind: 'service', topic: 'acme-crm-multipleNaturalPersonsV1.GetPersons' }],
  } as never;
}

test('from the catalog: the API gets its levels from the package, classes of the hierarchy stay in the catalog', () => {
  assert.equal(nestedApi('acme-crm', 'persons', 1, 'acme.crm.domain.clientMaster.persons.v1'), 'clientMaster.persons');
  assert.equal(nestedApi('acme-crm', 'persons', 1, 'acme.crm.domain.persons.v1'), 'persons');
  assert.equal(nestedApi('acme-crm', 'persons', 1, 'acme.crm.domain.other.v1'), 'persons');
  const model = catalogModel();
  const p = catalogProjects(model)[0];
  assert.equal(p.apis[0].api, 'clientMaster.multipleNaturalPersons');
  const c = collectionFromCatalog(p, p.apis, model);
  assert.equal(c.services[0].api, 'clientMaster.multipleNaturalPersons');
  assert.ok(!c.types.some(t => t.name === 'Address'));
  assert.equal(c.services[0].serviceOut?.type, 'dom:acme.crm.domain.clientMaster.schema.Address');
});

test('the Abgleich corrects the API to its levels and takes the class of the hierarchy', () => {
  // a collection that knew the API without its levels — and an own `Address`
  const c0 = newCollection({ title: 'Persons', project: 'acme-crm', api: 'multipleNaturalPersons', apiVersion: 1 });
  const address = { id: 't-addr', name: 'Address', kind: 'case' as const, fields: [{ id: 'f1', name: 'city', type: 'String' }] };
  const outType = { id: 't-out', name: 'Out', kind: 'case' as const, interactionId: 's1', fields: [{ id: 'f2', name: 'address', type: 't-addr' }] };
  const inType = { id: 't-in', name: 'In', kind: 'case' as const, interactionId: 's1', fields: [] };
  const c: ServiceCollectionSpec = {
    ...c0,
    types: [address, inType, outType],
    services: [{ id: 's1', name: 'GetPersons', api: 'multipleNaturalPersons', apiVersion: 1, status: 'draft', method: 'GET', path: '/persons', params: [], serviceOut: { type: 't-addr' }, inTypeId: 't-in', outTypeId: 't-out' }],
  };
  const r = syncWithCatalog(c, catalogModel())!;
  assert.ok(r);
  assert.deepEqual(r.renamedApis, ['multipleNaturalPersons v1 → clientMaster.multipleNaturalPersons']);
  assert.equal(r.spec.services[0].api, 'clientMaster.multipleNaturalPersons');
  assert.equal(r.spec.api, 'clientMaster.multipleNaturalPersons');
  assert.deepEqual(r.adopted.map(a => a.name), ['Address']);
  assert.ok(!r.spec.types.some(t => t.name === 'Address'));
  assert.equal(r.spec.services[0].serviceOut?.type, 'dom:acme.crm.domain.clientMaster.schema.Address');
});

const getOther = `package acme.crm.domain
package other.multipleNaturalPersons.v1

object GetOther extends MultipleNaturalPersonsV1:

  final val topicName = "acme-crm-multipleNaturalPersonsV1.GetOther"
  val path = "GET: /others"

  type ServiceIn = NoInput
  type ServiceOut = NoOutput

  case class In(
      key: Long
  )
end GetOther
`;

test('two APIs with the same last level: the catalog marks them, the Abgleich does not guess, the collection says it', () => {
  const base = catalogModel() as { domainTypes: unknown[]; services: unknown[] };
  const model = {
    ...base,
    domainTypes: [...base.domainTypes, ...scanScala(getOther, 'GetOther.scala')],
    services: [...base.services, { id: 'acme-crm-multipleNaturalPersonsV1.GetOther', name: 'GetOther', kind: 'service', topic: 'acme-crm-multipleNaturalPersonsV1.GetOther' }],
  } as never;
  const [a] = catalogProjects(model)[0].apis;
  assert.equal(a.api, 'clientMaster.multipleNaturalPersons');
  assert.deepEqual(a.sameTopics, ['other.multipleNaturalPersons']);
  const c0 = newCollection({ title: 'Persons', project: 'acme-crm', api: 'multipleNaturalPersons', apiVersion: 1 });
  const inType = { id: 't-in', name: 'In', kind: 'case' as const, interactionId: 's1', fields: [] };
  const c: ServiceCollectionSpec = {
    ...c0, types: [inType],
    services: [{ id: 's1', name: 'GetPersons', api: 'multipleNaturalPersons', apiVersion: 1, status: 'draft', method: 'GET', path: '/persons', params: [], inTypeId: 't-in' }],
  };
  const r = syncWithCatalog(c, model)!;
  // not renamed — which of the two is meant, the catalog does not know; the Abgleich says it
  assert.deepEqual(r.renamedApis, []);
  assert.deepEqual(r.ambiguousApis, ['multipleNaturalPersons v1: clientMaster.multipleNaturalPersons, other.multipleNaturalPersons']);
  assert.equal(r.spec, c);
  // in a collection: both APIs with the same topics
  const both: ServiceCollectionSpec = {
    ...c0,
    services: [
      { id: 's1', name: 'GetPersons', api: 'clientMaster.multipleNaturalPersons', apiVersion: 1, status: 'draft', method: 'GET', path: '/persons', params: [] },
      { id: 's2', name: 'GetOther', api: 'other.multipleNaturalPersons', apiVersion: 1, status: 'draft', method: 'GET', path: '/others', params: [] },
    ],
  };
  assert.ok(serviceIssues(both, both.services[0]).some(i => /Topic «acme-crm-multipleNaturalPersonsV1» hat auch die API «other\.multipleNaturalPersons»/.test(i)));
});

const getClients = `package acme.coreBanking.domain
package clientMaster.multipleNaturalPersons.v1

import acme.coreBanking.domain.clientMaster.schema.ClientKind

object GetClients extends MultipleNaturalPersonsV1:

  final val topicName = "acme-coreBanking-multipleNaturalPersonsV1.GetClients"
  val path = "GET: /clients"

  type ServiceIn = NoInput
  type ServiceOut = Out

  case class In(
      key: Long
  )
  case class Out(
      kind: ClientKind
  )
end GetClients
`;

const clientKind = `package acme.coreBanking.domain.clientMaster.schema

enum ClientKind:
  case Person, Company
`;

test('the Abgleich: a project in camelCase, a class moved up the hierarchy under another name', () => {
  const model = {
    version: 1,
    domainTypes: [...scanScala(getClients, 'GetClients.scala'), ...scanScala(clientKind, 'clientMaster/schema/ClientKind.scala')],
    services: [{ id: 'acme-coreBanking-multipleNaturalPersonsV1.GetClients', name: 'GetClients', kind: 'service', topic: 'acme-coreBanking-multipleNaturalPersonsV1.GetClients' }],
  } as never;
  assert.deepEqual(catalogProjects(model).map(p => p.project), ['acme-coreBanking']);
  // the collection from the OpenAPI: its own enum under the old name — and a type no service uses
  const c0 = newCollection({ title: 'Clients', project: 'acme-coreBanking', api: 'clientMaster.multipleNaturalPersons', apiVersion: 1 });
  const old = { id: 'e-old', name: 'MultipleNaturalPersonsClientKind', kind: 'enum' as const, values: [{ id: 'v1', name: 'Person' }, { id: 'v2', name: 'Company' }] };
  const spare = { id: 't-spare', name: 'Spare', kind: 'case' as const, fields: [{ id: 'f9', name: 'x', type: 'String' }] };
  const inType = { id: 't-in', name: 'In', kind: 'case' as const, interactionId: 's1', fields: [{ id: 'f1', name: 'key', type: 'Long' }] };
  const outType = { id: 't-out', name: 'Out', kind: 'case' as const, interactionId: 's1', fields: [{ id: 'f2', name: 'kind', type: 'e-old' }] };
  const c: ServiceCollectionSpec = {
    ...c0,
    types: [old, spare, inType, outType],
    services: [{ id: 's1', name: 'GetClients', api: 'clientMaster.multipleNaturalPersons', apiVersion: 1, status: 'draft', method: 'GET', path: '/clients', params: [], serviceOut: { type: 't-out' }, inTypeId: 't-in', outTypeId: 't-out' }],
  };
  const r = syncWithCatalog(c, model)!;
  assert.ok(r, 'the catalog knows the project');
  const out = r.spec.types.find(t => t.id === 't-out')!;
  assert.equal(out.fields!.find(f => f.name === 'kind')!.type, 'dom:acme.coreBanking.domain.clientMaster.schema.ClientKind');
  // the old enum no service needs any more goes; the type nobody used before stays
  assert.deepEqual(r.removedTypes, ['MultipleNaturalPersonsClientKind']);
  assert.ok(!r.spec.types.some(t => t.id === 'e-old'));
  assert.ok(r.spec.types.some(t => t.id === 't-spare'));
});
