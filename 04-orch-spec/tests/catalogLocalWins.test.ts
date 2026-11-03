// What is built locally wins over the delivered catalog - one develops locally and overrides the
// delivery on purpose. Legacy entries of the model.json (an old import) stay behind it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isBefore, localOverrides, mergeGeneratedCatalog, NO_PROJECT, projectOfService, rebuiltServices, stampLabel, withoutLocalProject } from '../src/catalogMerge';
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
  const local = svc('acme-services.worker.GetClient', { topic: 'acme-services-clientsV1-GetClient', description: 'local', builtAt: '2026-11-03T08:00:00Z' });
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

test('rebuiltServices: the services of the OpenAPI get the folder as project - also when the id says otherwise', () => {
  // the process id does not start with the folder name: before, `group` came from the id
  const parse = () => ({ services: [svc('clients-GetClient', { group: 'clients' })], types: [] });
  const r = rebuiltServices([], [{ project: 'acme-services', name: 'OpenApi.yml', text: '' }], parse, '2026-11-03T08:00:00Z');
  assert.deepEqual(r.incoming.map(s => [s.id, s.group, s.builtAt]), [['clients-GetClient', 'acme-services', '2026-11-03T08:00:00Z']]);
  // the next build of the same project replaces it - a service removed from the OpenAPI goes
  const next = rebuiltServices(r.incoming, [{ project: 'acme-services', name: 'OpenApi.yml', text: '' }], () => ({ services: [], types: [] }), '2026-11-04T08:00:00Z');
  assert.deepEqual(next.kept, []);
});

test('rebuiltServices: other projects, own entries and the delivery - what stays', () => {
  const existing = [
    svc('acme-cards-x', { group: 'acme-cards', builtAt: 'x' }),   // built for another project: stays
    svc('acme-own-y'),                                             // own, not built: stays
    svc('acme-services-z', { generated: true }),                   // delivered: never in the model
  ];
  const r = rebuiltServices(existing, [{ project: 'acme-services', name: 'OpenApi.yml', text: '' }], () => ({ services: [], types: [] }), 't');
  assert.deepEqual(r.kept.map(s => s.id), ['acme-cards-x', 'acme-own-y']);
});

test('rebuiltServices: an OpenAPI that cannot be parsed - its project is reported, the others come in', () => {
  const apis = [{ project: 'acme-broken', name: 'OpenApi.yml', text: ':' }, { project: 'acme-services', name: 'OpenApi.yml', text: 'ok' }];
  const parse = (a: { text: string }) => {
    if (a.text !== 'ok') throw new Error('bad yaml');
    return { services: [svc('acme-services-a')], types: [type('acme.services.domain.A', 'acme-services')] };
  };
  const before = [svc('acme-broken-old', { group: 'acme-broken', builtAt: 'x' }), svc('acme-services-old', { group: 'acme-services', builtAt: 'x' })];
  const r = rebuiltServices(before, apis, parse, 't');
  assert.deepEqual(r.unreadable, [{ project: 'acme-broken', error: 'bad yaml' }]);
  assert.deepEqual(r.incoming.map(s => s.id), ['acme-services-a']);
  // the broken project keeps its services - the one that came in replaces its own
  assert.deepEqual(r.kept.map(s => s.id), ['acme-broken-old']);
  assert.equal(r.types.length, 1);
});

test('a service read without project (no group): one row in the overview - not one per service', () => {
  const m = user({ services: [svc('acme-services-clientsV1-GetClient', { builtAt: '2026-11-03T08:00:00Z' })] });
  assert.deepEqual(localOverrides(m, delivered).map(o => [o.project, o.services]), [[NO_PROJECT, 1]]);
  assert.deepEqual(withoutLocalProject(m, NO_PROJECT).services, []);
});

test('times are compared as times - not as text (other offsets, milliseconds)', () => {
  // 09:00+02:00 is 07:00Z - before the delivery at 08:00Z, though the text is "greater"
  assert.equal(isBefore('2026-11-03T09:00:00+02:00', '2026-11-03T08:00:00Z'), true);
  assert.equal(isBefore('2026-11-03T08:00:00.500Z', '2026-11-03T08:00:00Z'), false);
  // an invalid time is never before or after
  assert.equal(isBefore('x', '2026-11-03T08:00:00Z'), false);
  const local = svc('acme-services-clientsV1-GetClient', { group: 'acme-services', builtAt: '2026-11-03T09:00:00+02:00' });
  const m = user({ services: [local], projects: [{ id: 'p', name: 'acme-services', scannedAt: '2026-11-03T08:00:00Z' }] });
  // the later of the two is the scan - 08:00Z after 07:00Z
  assert.equal(localOverrides(m, delivered)[0].localAt, '2026-11-03T08:00:00Z');
});

test('withoutLocalProject: example values of a package root another project still uses stay', () => {
  const m = user({
    services: [],
    domainTypes: [type('acme.domain.clients.v1.Client', 'acme-services'), type('acme.domain.cards.v1.Card', 'acme-cards'), type('solo.domain.x.v1.X', 'acme-services')],
    domainDefaults: [{ pkg: 'acme', name: 'Shared' }, { pkg: 'solo', name: 'Solo' }] as Model['domainDefaults'],
    projects: [{ id: 'p1', name: 'acme-services' }, { id: 'p2', name: 'acme-cards' }],
  });
  const back = withoutLocalProject(m, 'acme-services');
  assert.deepEqual(back.domainDefaults?.map(d => d.name), ['Shared']);
});

test('rebuiltServices: a project without OpenAPI in this build (none, or 03-api not readable) keeps its services', () => {
  const before = [svc('acme-cards-x', { group: 'acme-cards', builtAt: 'x' })];
  assert.deepEqual(rebuiltServices(before, [], () => ({ services: [], types: [] }), 't').kept.map(s => s.id), ['acme-cards-x']);
});

test('rebuiltServices: the types of an OpenAPI get the project as source - «zurück zur Auslieferung» finds them', () => {
  const parse = () => ({ services: [], types: [{ ...type('acme.services.domain.Api', 'x'), source: undefined } as DomainType] });
  const r = rebuiltServices([], [{ project: 'acme-services', name: 'OpenApi.yml', text: '' }], parse, 't');
  assert.deepEqual(r.types.map(t => t.source), ['acme-services/03-api/OpenApi.yml']);
  const back = withoutLocalProject(user({ domainTypes: r.types, projects: [{ id: 'p', name: 'acme-services' }] }), 'acme-services');
  assert.deepEqual(back.domainTypes, []);
});

test('an entry without builtAt (by hand, an old import) is no local build - also when its project is in the list', () => {
  const byHand = svc('acme-services-clientsV1-GetClient', { description: 'by hand' });
  const m = user({ services: [byHand], projects: [{ id: 'p', name: 'acme-services' }] });
  // it stays behind the delivery …
  assert.deepEqual(byId(mergeGeneratedCatalog(m, delivered), byHand.id).map(s => s.description), ['delivered']);
  // … and «zurück zur Auslieferung» leaves it in the model.json
  assert.deepEqual(withoutLocalProject(m, 'acme-services').services.map(s => s.description), ['by hand']);
});

test('nested project names: the group the build set wins over the prefix', () => {
  const built = svc('acme-cards-x', { group: 'acme-cards', builtAt: 'x' });
  const m = user({ services: [built], projects: [{ id: 'p1', name: 'acme' }, { id: 'p2', name: 'acme-cards' }] });
  assert.deepEqual(withoutLocalProject(m, 'acme').services.map(s => s.id), ['acme-cards-x']);
  assert.deepEqual(withoutLocalProject(m, 'acme-cards').services, []);
});

test('rebuiltServices: one read before with «OpenAPI einlesen» (group from the process id) is replaced too', () => {
  const api = [{ project: 'acme-services', name: 'OpenApi.yml', text: '' }];
  const read = svc('acme-services-clientsV1-Old', { group: 'clientsV1', builtAt: 'x' });   // removed from the OpenAPI since
  const none = () => ({ services: [], types: [] });
  assert.deepEqual(rebuiltServices([read], api, none, 't', { listed: ['acme-services'] }).kept, []);
  // a project not in this build keeps it
  assert.deepEqual(rebuiltServices([read], [], none, 't', { listed: ['acme-services'] }).kept, [read]);
});

test('rebuiltServices: the types an OpenAPI gave a project stay unless its OpenAPI comes in again', () => {
  const fromApi = (id: string, project: string) => ({ ...type(id, project), source: `${project}/03-api/OpenApi.yml` } as DomainType);
  const types = [fromApi('acme.services.domain.A', 'acme-services'), fromApi('acme.cards.domain.B', 'acme-cards'), type('acme.cards.domain.C', 'acme-cards'), { ...fromApi('d.D', 'acme-x'), generated: true }];
  const r = rebuiltServices([], [{ project: 'acme-services', name: 'OpenApi.yml', text: '' }], () => ({ services: [], types: [] }), 't', { types });
  // the scanned type (01-domain) comes from the scan, the delivered one is not the model's
  assert.deepEqual(r.keptTypes.map(t => t.id), ['acme.cards.domain.B']);
});

test('a legacy entry with the topic of a local service (another id) steps back - no duplicate', () => {
  const local = svc('acme-new.worker.Get', { topic: 'acme-new-get', builtAt: 'x', group: 'acme-new' });
  const legacy = svc('acme-new-get-old', { topic: 'acme-new-get' });
  const merged = mergeGeneratedCatalog(user({ services: [local, legacy] }), delivered);
  assert.deepEqual(merged.services.filter(s => s.topic === 'acme-new-get').map(s => s.id), [local.id]);
});

test('the called process is no override key: several delivered services calling the same process all stay', () => {
  const gen: CatalogFile = { ...delivered, services: [svc('acme-cards-a', { calledProcess: 'acme-sub' }), svc('acme-cards-b', { calledProcess: 'acme-sub' })] };
  const local = svc('acme-new-c', { calledProcess: 'acme-sub', builtAt: 'x', group: 'acme-new' });
  const merged = mergeGeneratedCatalog(user({ services: [local] }), gen);
  assert.deepEqual(merged.services.map(s => s.id).sort(), ['acme-cards-a', 'acme-cards-b', 'acme-new-c']);
  assert.deepEqual(localOverrides(user({ services: [local] }), gen), []);
  // a legacy entry calling it steps back
  const legacy = svc('acme-old-d', { topic: undefined, calledProcess: 'acme-sub' });
  assert.equal(byId(mergeGeneratedCatalog(user({ services: [legacy] }), gen), 'acme-old-d').length, 0);
});

test('like with like: a local service calling a process does not hide the delivered service with that id', () => {
  const caller = svc('acme-new-Caller', { topic: undefined, calledProcess: 'acme-cards-orderV1-Eval', builtAt: 'x', group: 'acme-new' });
  const merged = mergeGeneratedCatalog(user({ services: [caller] }), delivered);
  assert.equal(byId(merged, 'acme-cards-orderV1-Eval').length, 1);
  assert.deepEqual(localOverrides(user({ services: [caller] }), delivered), []);
});

test('stampLabel: the date - with the time of day when the other stand is from the same day', () => {
  // around midday UTC: the same day in every usual time zone
  assert.match(stampLabel('2026-11-03T11:00:00Z', '2026-11-03T12:00:00Z'), /\d{1,2}:\d{2}/);
  assert.doesNotMatch(stampLabel('2026-11-03T11:00:00Z', '2026-10-30T12:00:00Z'), /:/);
  assert.equal(stampLabel(undefined, '2026-11-03T12:00:00Z'), '?');
});

test('local and legacy entry with the same id in the model.json: the local one shows, once', () => {
  const local = svc('acme-services-clientsV1-GetClient', { description: 'local', group: 'acme-services', builtAt: 'x' });
  const legacy = svc('acme-services-clientsV1-GetClient', { description: 'old import' });
  const merged = mergeGeneratedCatalog(user({ services: [legacy, local] }), delivered);
  assert.deepEqual(byId(merged, local.id).map(s => s.description), ['local']);
});

test('isBefore and stampLabel with equal and invalid times', () => {
  assert.equal(isBefore('2026-11-03T08:00:00Z', '2026-11-03T08:00:00Z'), false);
  assert.equal(isBefore('2026-11-03T08:00:00Z', undefined), false);
  assert.doesNotMatch(stampLabel('2026-11-03T11:00:00Z', 'x'), /:/);
  assert.match(stampLabel('2026-11-03T11:00:00Z', '2026-11-03T11:00:00Z'), /\d{1,2}:\d{2}/);
});
