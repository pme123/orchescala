// Nested APIs (`clientMaster.multipleNaturalPersons`): only the package follows the
// hierarchy, the name is its last part; shared classes live in the `schema` of a level.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scanScala } from '../src/domainScan';
import { catalogProjects, collectionFromCatalog, nestedApi, syncWithCatalog } from '../src/services/catalogCollections';
import {
  API_NAME, apiName, collectionPackage, collectionTrait, domainDir, hierarchySchemaPackages, newCollection, serviceTopic, workerPackage,
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
