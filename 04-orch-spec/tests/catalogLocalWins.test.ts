// What is built locally wins over the delivered catalog - one develops locally and overrides the
// delivery on purpose. Legacy entries of the model.json (an old import) stay behind it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { localOverrides, mergeGeneratedCatalog, projectOfService, withoutLocalProject } from '../src/catalogMerge';
import type { CatalogFile } from '../src/catalogImport';
import type { DomainType, Model, ServiceDef } from '../src/types';

const svc = (id: string, extra: Partial<ServiceDef> = {}): ServiceDef => ({ id, name: id.split(/[-.]/).pop()!, topic: id, ...extra });
const type = (id: string, project: string): DomainType => ({ id, name: id.split('.').pop()!, pkg: id.split('.').slice(0, -1).join('.'), kind: 'case', source: `${project}/01-domain/X.scala` } as DomainType);
const user = (m: Partial<Model>): Model => ({ services: [], ...m } as Model);
const delivered: CatalogFile = {
  services: [svc('acme-services-clientsV1-GetClient', { description: 'delivered' }), svc('acme-cards-orderV1-Eval')],
  domainTypes: [type('acme.services.domain.clients.v1.Client', 'acme-services')],
  projects: [{ name: 'acme-services', scannedAt: '2026-10-30T10:00:00Z' }] as CatalogFile['projects'],
};
const byId = (m: Model, id: string) => m.services.filter(s => s.id === id);

test('a service read with «OpenAPI einlesen» overrides the delivered one of the same id', () => {
  const local = svc('acme-services-clientsV1-GetClient', { description: 'local', group: 'acme-services', builtAt: '2026-11-03T08:00:00Z' });
  const merged = mergeGeneratedCatalog(user({ services: [local] }), delivered);
  assert.deepEqual(byId(merged, local.id).map(s => [s.description, !!s.generated]), [['local', false]]);
  // the other delivered services stay
  assert.equal(byId(merged, 'acme-cards-orderV1-Eval').length, 1);
});

test('a service of a project in the local list overrides the delivered one - also by topic', () => {
  const local = svc('acme-services.worker.GetClient', { topic: 'acme-services-clientsV1-GetClient', description: 'local' });
  const merged = mergeGeneratedCatalog(user({ services: [local], projects: [{ id: 'p', name: 'acme-services' }] }), delivered);
  assert.deepEqual(merged.services.filter(s => s.topic === 'acme-services-clientsV1-GetClient').map(s => s.description), ['local']);
});

test('a legacy entry (an old import, no project in the list, not read locally) stays behind the delivery', () => {
  const legacy = svc('acme-services-clientsV1-GetClient', { description: 'old import' });
  const merged = mergeGeneratedCatalog(user({ services: [legacy] }), delivered);
  assert.deepEqual(byId(merged, legacy.id).map(s => [s.description, !!s.generated]), [['delivered', true]]);
  // where the delivery has nothing, it is still there
  const other = svc('acme-legacy-x');
  assert.equal(byId(mergeGeneratedCatalog(user({ services: [other] }), delivered), 'acme-legacy-x').length, 1);
});

test('localOverrides: per project what the local build overrides, with both times', () => {
  const local = svc('acme-services-clientsV1-GetClient', { group: 'acme-services', builtAt: '2026-11-03T08:00:00Z' });
  const m = user({
    services: [local],
    domainTypes: [type('acme.services.domain.clients.v1.Client', 'acme-services')],
    projects: [{ id: 'p', name: 'acme-services', scannedAt: '2026-11-02T08:00:00Z' }],
  });
  assert.deepEqual(localOverrides(m, delivered), [
    { project: 'acme-services', services: 1, types: 1, localAt: '2026-11-03T08:00:00Z', deliveredAt: '2026-10-30T10:00:00Z' },
  ]);
  // nothing overridden: no entry; without a delivery: none
  assert.deepEqual(localOverrides(user({ services: [svc('acme-new-x', { builtAt: 'x', group: 'acme-new' })] }), delivered), []);
  assert.deepEqual(localOverrides(m, null), []);
});

test('withoutLocalProject: back to the delivery - services, types and the list entry of the project go', () => {
  const m = user({
    services: [svc('acme-services-clientsV1-GetClient', { group: 'acme-services', builtAt: 'x' }), svc('acme-cards-x', { group: 'acme-cards', builtAt: 'x' })],
    domainTypes: [type('acme.services.domain.clients.v1.Client', 'acme-services'), type('acme.cards.domain.order.v1.Order', 'acme-cards')],
    projects: [{ id: 'p1', name: 'acme-services' }, { id: 'p2', name: 'acme-cards' }],
  });
  const back = withoutLocalProject(m, 'acme-services');
  assert.deepEqual(back.services.map(s => s.id), ['acme-cards-x']);
  assert.deepEqual(back.domainTypes?.map(t => t.id), ['acme.cards.domain.order.v1.Order']);
  assert.deepEqual(back.projects?.map(p => p.name), ['acme-cards']);
  // merged again: the delivered service is back
  assert.deepEqual(byId(mergeGeneratedCatalog(back, delivered), 'acme-services-clientsV1-GetClient').map(s => s.description), ['delivered']);
});

test('projectOfService: the longest project name the id, topic or called process starts with', () => {
  const names = ['acme', 'acme-services', 'acme-services-clients'];
  assert.equal(projectOfService(svc('acme-services-clients-GetClient'), names), 'acme-services-clients');
  assert.equal(projectOfService(svc('acme-services.worker.X', { topic: undefined }), names), 'acme-services');
  assert.equal(projectOfService(svc('other-x'), names), null);
  // a name is a whole segment: acme-ser is no prefix of acme-services
  assert.equal(projectOfService(svc('acme-services-x'), ['acme-ser']), null);
});
