// Nested APIs (`clientMaster.multipleNaturalPersons`): only the package follows the
// hierarchy, the name is its last part; shared classes live in the `schema` of a level.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scanScala } from '../src/domainScan';
import { catalogProjects, collectionFromCatalog, missingApis, nestedApi, syncWithCatalog } from '../src/services/catalogCollections';
import {
  API_NAME, apiName, apiOf, collectionPackage, collectionTrait, domainDir, hierarchySchemaPackages, newCollection, serviceTopic, workerPackage,
} from '../src/services/collection';
import { adoptHierarchyTypes, commonParents, searchGroups } from '../src/services/hierarchy';
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
  assert.deepEqual(hierarchySchemaPackages({ project: 'acme-crm', api: 'a.b.c' }), ['acme.crm.domain.a.b.schema', 'acme.crm.domain.a.schema', 'acme.crm.domain.schema']);
  assert.deepEqual(hierarchySchemaPackages({ project: 'acme-crm', api: 'client' }), ['acme.crm.domain.schema']);
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
  // an API without levels: every schema of the project is searched - also the one of clientMaster
  const flat = { ...twoApis(), services: twoApis().services.map(s => ({ ...s, api: 'client' })) };
  assert.deepEqual(adoptHierarchyTypes(flat, model).adopted.map(a => a.from), ['acme.crm.domain.clientMaster.schema.Address']);
});

test('the search for classes of the hierarchy: the schema of every level, the nearest first - never the package of an API', () => {
  const pkgs = [
    'acme.crm.domain.schema', 'acme.crm.domain.clientMaster.schema', 'acme.crm.domain.partner.schema',
    'acme.crm.domain.clientMaster.naturalPersons.v1.schema', 'acme.crm.domain.clientMaster.legal.schema',
    'acme.crm.domain.clientMaster.orgs.v1.schema', 'acme.crm.domain.clientMaster.orgs.v1', 'acme.other.domain.schema',
  ];
  const model = { version: 1, services: [], domainTypes: pkgs.map((pkg, i) => ({ id: `${pkg}.T${i}`, name: `T${i}`, pkg, kind: 'case', fields: [] })) } as never;
  const orgs = { project: 'acme-crm', api: 'clientMaster.orgs', apiVersion: 1 };
  assert.deepEqual(searchGroups([orgs], [orgs], model), [
    ['acme.crm.domain.clientMaster.schema'], ['acme.crm.domain.schema'],
    ['acme.crm.domain.partner.schema'], ['acme.crm.domain.clientMaster.legal.schema'],
  ]);
  // without levels: the domain's schema first, then the levels by their depth
  const flat = { project: 'acme-crm', api: 'readOrganisation2', apiVersion: 1 };
  assert.deepEqual(searchGroups([flat], [flat], model), [
    ['acme.crm.domain.schema'],
    ['acme.crm.domain.clientMaster.schema', 'acme.crm.domain.partner.schema'], ['acme.crm.domain.clientMaster.legal.schema'],
  ]);
});

test('an API without levels: the enums of a level of the project by their structure', () => {
  const doc = {
    openapi: '3.0.1', info: { title: 'Organisation', version: '1' },
    paths: { '/readOrganisation2': { post: { operationId: 'postReadOrganisation2', responses: { 200: { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/Organisation' } } } } } } } },
    components: { schemas: {
      Organisation: { type: 'object', properties: { gender: { $ref: '#/components/schemas/OrganisationGender1' } } },
      OrganisationGender1: { type: 'string', enum: ['female', 'male'] },
    } },
  };
  const c0 = newCollection({ title: 'Organisation', project: 'acme-crm', api: 'readOrganisation2', apiVersion: 1 });
  const api = readApi(doc);
  const c = addOperations(c0, api, api.operations.map(o => o.key), () => ({ api: 'readOrganisation2', apiVersion: 1 })).spec;
  const model = { version: 1, services: [], domainTypes: scanScala(sharedOther, 'clientMaster/schema/Shared.scala') } as never;
  assert.deepEqual(adoptHierarchyTypes(c, model).adopted.map(a => [a.name, a.from]), [['OrganisationGender1', 'acme.crm.domain.clientMaster.schema.Gender1']]);
});

/** the project's classes higher up: under other names than the OpenAPI gives them */
const sharedOther = `package acme.crm.domain
package clientMaster.schema

enum Gender1:
  case male, female

enum Sex:
  case female, male, other

case class PartnerOfPerson(
    gender: Option[Gender1],
    name: Option[String]
)
`;
const rootSchema = `package acme.crm.domain
package schema

case class TypeDateWrapper(
    @description("An ISO 8601 date")
    value: Option[String]
)

case class TypeBigDecimalWrapper(
    @description("A BigDecimal as text")
    value: Option[String]
)
`;
const twin = `package acme.crm.domain
package clientMaster.schema

enum Twin1:
  case a, b
enum Twin2:
  case b, a
`;

test('an OpenAPI import takes a class of another name with the same structure from the hierarchy — up to the schema of the domain', () => {
  const docOther = {
    openapi: '3.0.1', info: { title: 'Client Master', version: '1' },
    paths: {
      '/naturalPersons': { get: { operationId: 'getNaturalPersons', responses: { 200: { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/NaturalPerson' } } } } } } },
    },
    components: {
      schemas: {
        NaturalPerson: { type: 'object', properties: { partner: { $ref: '#/components/schemas/NaturalPersonPartner' }, born: { $ref: '#/components/schemas/TypeDateWrapper2' }, twin: { $ref: '#/components/schemas/PersonTwin' } } },
        NaturalPersonPartner: { type: 'object', properties: { name: { type: 'string' }, gender: { $ref: '#/components/schemas/NaturalPersonGender1' } } },
        NaturalPersonGender1: { type: 'string', enum: ['female', 'male'] },
        TypeDateWrapper2: { type: 'object', properties: { value: { type: 'string', description: 'An ISO 8601 date' } } },
        PersonTwin: { type: 'string', enum: ['a', 'b'] },
      },
    },
  };
  const c0 = newCollection({ title: 'Client Master', project: 'acme-crm', api: 'clientMaster.naturalPersons', apiVersion: 1 });
  const api = readApi(docOther);
  const c = addOperations(c0, api, api.operations.map(o => o.key), () => ({ api: 'clientMaster.naturalPersons', apiVersion: 1 })).spec;
  const domainTypes = [
    ...scanScala(sharedOther, 'clientMaster/schema/Shared.scala'),
    ...scanScala(rootSchema, 'schema/TypeDateWrapper.scala'),
    ...scanScala(twin, 'clientMaster/schema/Twin.scala'),
  ];
  const { spec, adopted } = adoptHierarchyTypes(c, { version: 1, services: [], domainTypes } as never);
  const renamed = Object.fromEntries(adopted.map(a => [a.name, a.renamed]));
  // the enum by its values (not `Sex`: another value), the class that uses it after it, the wrapper
  // from the top - of the two of its structure the one whose field says the same
  assert.deepEqual(renamed, { NaturalPersonGender1: 'Gender1', TypeDateWrapper2: 'TypeDateWrapper', NaturalPersonPartner: 'PartnerOfPerson' });
  assert.equal(adopted.find(a => a.name === 'TypeDateWrapper2')?.from, 'acme.crm.domain.schema.TypeDateWrapper');
  const person = spec.types.find(t => t.name === 'NaturalPerson')!;
  assert.equal(person.fields?.find(f => f.name === 'partner')?.type, 'dom:acme.crm.domain.clientMaster.schema.PartnerOfPerson');
  assert.equal(person.fields?.find(f => f.name === 'born')?.type, 'dom:acme.crm.domain.schema.TypeDateWrapper');
  // two of the same structure on one level: none of them - the own type stays
  assert.ok(spec.types.some(t => t.name === 'PersonTwin'));
  assert.ok(!spec.types.some(t => ['NaturalPersonGender1', 'TypeDateWrapper2', 'NaturalPersonPartner'].includes(t.name)));

  // unchecked in the choice: the enum stays the collection's own - and the class that matched only
  // through it too; the wrapper is taken all the same
  const gender = adopted.find(a => a.name === 'NaturalPersonGender1')!;
  const kept = adoptHierarchyTypes(c, { version: 1, services: [], domainTypes } as never, new Set([gender.id]));
  assert.deepEqual(kept.adopted.map(a => a.name), ['TypeDateWrapper2']);
  assert.ok(['NaturalPersonGender1', 'NaturalPersonPartner'].every(n => kept.spec.types.some(t => t.name === n)));
  const partner = kept.spec.types.find(t => t.name === 'NaturalPersonPartner')!;
  assert.equal(partner.fields?.find(f => f.name === 'gender')?.type, gender.id);
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
  // the old enum goes: it has the values of the class moved up - taken from there under its name;
  // the type nobody used before stays
  assert.deepEqual(r.adopted.map(a => [a.name, a.renamed]), [['MultipleNaturalPersonsClientKind', 'ClientKind']]);
  assert.deepEqual(r.removedTypes, []);
  assert.ok(!r.spec.types.some(t => t.id === 'e-old'));
  assert.ok(r.spec.types.some(t => t.id === 't-spare'));
});

const readPersons = `package acme.coreBanking.domain
package clientMaster.multipleNaturalPersons.v1

object ReadPersons extends MultipleNaturalPersonsV1:

  final val topicName = "acme-coreBanking-multipleNaturalPersonsV1.ReadPersons"
  val path = "POST: /persons"

  type ServiceIn = In
  type ServiceOut = Out

  enum In:
    @description("If set, read from the source.")
    def fromSource: Option[Boolean]

    case Standard(
        fromSource: Option[Boolean],
        keys: Option[Seq[String]]
    )
    case ClientKey(
        fromSource: Option[Boolean],
        key: String
    )
  end In

  enum Out:
    case Standard(
        persons: Seq[String]
    )
    case ClientKey(
        person: String
    )
  end Out
end ReadPersons
`;

test('the Abgleich: In and Out with cases — the description of a shared def, the cases of an Out without one', () => {
  const domainTypes = scanScala(readPersons, 'ReadPersons.scala');
  const inDom = domainTypes.find(t => t.name === 'ReadPersons.In')!;
  assert.equal(inDom.fields?.[0].description, 'If set, read from the source.');
  const model = {
    version: 1, domainTypes,
    services: [{ id: 'acme-coreBanking-multipleNaturalPersonsV1.ReadPersons', name: 'ReadPersons', kind: 'service', topic: 'acme-coreBanking-multipleNaturalPersonsV1.ReadPersons', outputs: [{ name: 'persons' }, { name: 'person' }] }],
  } as never;
  const fresh = collectionFromCatalog(catalogProjects(model)[0], catalogProjects(model)[0].apis, model);
  const out = fresh.types.find(t => t.id === fresh.services[0].outTypeId)!;
  assert.equal(out.kind, 'enum');
  assert.deepEqual(out.values?.map(v => [v.name, v.fields?.map(f => f.name)]), [['Standard', ['persons']], ['ClientKey', ['person']]]);
  assert.equal(out.fields?.length ?? 0, 0);
  // the Abgleich again: the cases stay, the shared field gets its description
  const withoutDescr = { ...fresh, types: fresh.types.map(t => (t.fields ? { ...t, fields: t.fields.map(f => ({ ...f, description: undefined })) } : t)) };
  const r = syncWithCatalog(withoutDescr, model)!;
  const out2 = r.spec.types.find(t => t.id === r.spec.services[0].outTypeId)!;
  assert.deepEqual(out2.values?.map(v => [v.name, v.fields?.map(f => f.name)]), [['Standard', ['persons']], ['ClientKey', ['person']]]);
  assert.equal(out2.fields?.length ?? 0, 0);
  const in2 = r.spec.types.find(t => t.id === r.spec.services[0].inTypeId)!;
  assert.equal(in2.fields?.find(f => f.name === 'fromSource')?.description, 'If set, read from the source.');
});

test('Abgleich without a match: the APIs the project lacks are named - with the ones it has', () => {
  // the project has `naturalPerson` (singular), the collection `clientMaster.naturalPersons`
  const model = { version: 1, services: [{ id: 'acme-crm-naturalPersonV1.GetX', name: 'GetX', kind: 'service', topic: 'acme-crm-naturalPersonV1.GetX' }] } as never;
  const c = twoApis();
  assert.equal(syncWithCatalog(c, model), null);
  assert.deepEqual(missingApis(c, model), {
    apis: ['clientMaster.naturalPersons v1'],
    missing: ['clientMaster.naturalPersons v1 (acme-crm-naturalPersonsV1)'],
    known: ['naturalPerson v1'],
  });
  // another project: not known at all
  assert.equal(missingApis({ ...c, project: 'acme-other' }, model), null);
});

test('Abgleich: what the project does not have (any more) is listed - and deleted only when chosen', () => {
  const c = twoApis();
  const [natural, legal] = c.services;
  // the project has only the first service — the second was deleted there
  const topic = serviceTopic(apiOf(c, natural), natural);
  const model = { version: 1, services: [{ id: topic, name: natural.name, kind: 'service', topic }] } as never;
  const r = syncWithCatalog(c, model)!;
  assert.deepEqual(r.stale, [{ id: legal.id, name: legal.name, kind: 'service' }]);
  // kept as long as nobody chooses it
  assert.ok(r.spec.services.some(s => s.id === legal.id));
  // deleted: the service goes, and with it the types only it used (under «Typen entfernt»)
  const d = syncWithCatalog(c, model, new Set(), new Set([legal.id]))!;
  assert.ok(!d.spec.services.some(s => s.id === legal.id));
  assert.ok(d.removedTypes.includes('LegalPerson'), JSON.stringify(d.removedTypes));
  assert.ok(!d.spec.types.some(t => t.name === 'LegalPerson'));
  // a type the first service still uses stays
  assert.ok(d.spec.types.some(t => t.name === 'NaturalPerson') && d.spec.types.some(t => t.name === 'Address'));
});

test('Abgleich: own types no service uses and the domain does not know are listed - deleted when chosen', () => {
  const c0 = twoApis();
  const [natural] = c0.services;
  // the service was deleted in the collection before - its types stayed behind
  const c = { ...c0, services: [natural] };
  const topic = serviceTopic(apiOf(c, natural), natural);
  const model = { version: 1, services: [{ id: topic, name: natural.name, kind: 'service', topic }] } as never;
  const r = syncWithCatalog(c, model)!;
  const left = r.stale.filter(x => x.kind === 'type');
  assert.ok(left.some(x => x.name === 'LegalPerson'), JSON.stringify(r.stale));
  assert.ok(!left.some(x => x.name === 'NaturalPerson' || x.name === 'Address'), JSON.stringify(r.stale));
  assert.ok(r.spec.types.some(t => t.name === 'LegalPerson'));
  const d = syncWithCatalog(c, model, new Set(), new Set(left.map(x => x.id)))!;
  assert.ok(!d.spec.types.some(t => t.name === 'LegalPerson'));
  assert.ok(d.spec.types.some(t => t.name === 'NaturalPerson'));
});

test('Abgleich: deleting a service keeps an In or Out another service still uses', () => {
  const c0 = twoApis();
  const [natural, legal] = c0.services;
  assert.ok(natural.inTypeId);
  const c = { ...c0, services: [natural, { ...legal, inTypeId: natural.inTypeId }] };
  const topic = serviceTopic(apiOf(c, natural), natural);
  const model = { version: 1, services: [{ id: topic, name: natural.name, kind: 'service', topic }] } as never;
  const d = syncWithCatalog(c, model, new Set(), new Set([legal.id]))!;
  assert.ok(!d.spec.services.some(s => s.id === legal.id));
  assert.ok(d.spec.types.some(t => t.id === natural.inTypeId), 'the shared In stays');
  // its own Out goes
  if (legal.outTypeId) assert.ok(!d.spec.types.some(t => t.id === legal.outTypeId));
});

test('Abgleich: an id to delete that is not missing in the project changes nothing', () => {
  const c = twoApis();
  const [natural] = c.services;
  const topic = serviceTopic(apiOf(c, natural), natural);
  const model = { version: 1, services: [{ id: topic, name: natural.name, kind: 'service', topic }] } as never;
  const kept = syncWithCatalog(c, model)!;
  const odd = syncWithCatalog(c, model, new Set(), new Set([natural.id, natural.inTypeId ?? '', 'no-such-id']))!;
  assert.deepEqual(odd.spec, kept.spec);
});
