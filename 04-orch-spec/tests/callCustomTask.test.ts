// A service orchestration calls a CustomTask of the catalog (another orchestration) like a service:
// the catalog lists it as no collection, but its worker is callable.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { catalogProjects } from '../src/services/catalogCollections';
import type { Model } from '../src/types';

const model: Model = {
  version: 1,
  services: [{ id: 'acme-crm-clientV1.GetClientKey', name: 'GetClientKey', topic: 'acme-crm-clientV1.GetClientKey', kind: 'service' } as Model['services'][number]],
  domainTypes: [
    { id: 'acme.crm.domain.client.v1.GetClientKey.In', name: 'GetClientKey.In', pkg: 'acme.crm.domain.client.v1', kind: 'case', owner: 'GetClientKey', importPath: 'acme.crm.domain.client.v1.GetClientKey', dsl: 'CustomTask', fields: [] },
    { id: 'acme.crm.domain.client.v1.GetClientKey.Out', name: 'GetClientKey.Out', pkg: 'acme.crm.domain.client.v1', kind: 'case', owner: 'GetClientKey', importPath: 'acme.crm.domain.client.v1.GetClientKey', dsl: 'CustomTask', fields: [] },
  ] as Model['domainTypes'],
};

test('a CustomTask of the catalog is no collection - but callable for an orchestration', () => {
  assert.deepEqual(catalogProjects(model).map(p => p.project), []);
  const withCustom = catalogProjects(model, { customWorkers: true });
  assert.deepEqual(withCustom.flatMap(p => p.apis.flatMap(a => a.services.map(s => s.id))), ['acme-crm-clientV1.GetClientKey']);
});
