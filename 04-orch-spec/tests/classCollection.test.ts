// A collection without services: a collection of classes - shared ones of a level, in the
// schema of its API and version (`clientMaster.v1.schema`), taken from the code by the Abgleich.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scanScala } from '../src/domainScan';
import { folderCatalog } from '../src/folderCatalog';
import { syncWithCatalog } from '../src/services/catalogCollections';
import { newCollection } from '../src/services/collection';
import { collectionFiles } from '../src/services/scalaCollection';
import type { ServiceCollectionSpec } from '../src/services/types';
import type { Model, TypeDef } from '../src/types';

const classes = (types: TypeDef[]): ServiceCollectionSpec =>
  ({ ...newCollection({ title: 'ClientMaster Klassen', project: 'acme-crm', api: 'clientMaster', apiVersion: 1 }), types });
const kind: TypeDef = { id: 'k', name: 'ClientKind', kind: 'enum', values: [{ name: 'Person' }, { name: 'Company' }] };
const address: TypeDef = { id: 'a', name: 'Address', kind: 'case', fields: [{ id: 'f', name: 'city', type: 'String' }] };

test('the export: the classes in the schema of its API and version - no trait, no worker', () => {
  const files = collectionFiles(classes([kind, address]));
  assert.deepEqual(files.map(f => f.path), [
    '01-domain/src/main/scala/acme/crm/domain/clientMaster/v1/schema/ClientKind.scala',
    '01-domain/src/main/scala/acme/crm/domain/clientMaster/v1/schema/Address.scala',
  ]);
  assert.match(files[0].content, /^package acme\.crm\.domain\npackage clientMaster\.v1\.schema\n/);
});

test('in the catalog of the folder: the classes for the other specifications', () => {
  const ids = (folderCatalog(null, { specs: [], collections: [classes([kind, address])] })?.domainTypes ?? []).map(d => d.id);
  assert.ok(ids.includes('acme.crm.domain.clientMaster.v1.schema.ClientKind'), ids.join(', '));
  assert.ok(ids.includes('acme.crm.domain.clientMaster.v1.schema.Address'));
});

const code = `package acme.crm.domain
package clientMaster.v1.schema

enum ClientKind:
  case Person, Company, Other

case class Address(
    city: String,
    zip: Option[String]
)
`;
const model = { version: 1, services: [], domainTypes: scanScala(code, 'clientMaster/v1/schema/Schema.scala') } as unknown as Model;

test('the Abgleich: the classes the code has in that schema - the domain wins, the id and a description stay, an own one stays', () => {
  const own: TypeDef = { ...kind, description: 'Die Art des Kunden' };
  const extra: TypeDef = { id: 'x', name: 'OnlyHere', kind: 'case', fields: [{ id: 'g', name: 'a', type: 'String' }] };
  const r = syncWithCatalog(classes([own, extra]), model)!;
  assert.deepEqual(r.addedTypes, ['Address']);
  assert.deepEqual(r.updated, ['ClientKind']);
  const k = r.spec.types.find(t => t.name === 'ClientKind')!;
  assert.equal(k.id, 'k');
  assert.equal(k.description, 'Die Art des Kunden');
  assert.deepEqual((k.values ?? []).map(v => v.name), ['Person', 'Company', 'Other']);
  assert.deepEqual((r.spec.types.find(t => t.name === 'Address')!.fields ?? []).map(f => `${f.name}${f.optional ? '?' : ''}`), ['city', 'zip?']);
  assert.ok(r.spec.types.some(t => t.id === 'x'));
  // nothing in that schema: nothing to compare with
  assert.equal(syncWithCatalog(classes([]), { version: 1, services: [], domainTypes: [] } as unknown as Model), null);
});
