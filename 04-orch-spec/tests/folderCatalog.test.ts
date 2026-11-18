// The catalog of a folder (folderCatalog): the released catalog plus the folder's collections, service
// orchestrations and processes - usable everywhere, marked «noch nicht released» until a release brings
// them into the catalog.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import {
  allSteps, collectFindings, folderCatalog, installNodeDom, newCollection, newServiceProcess, targetsOf,
  type CollectionService, type Model, type ProcessSpec, type ServiceCollectionSpec, type Step, type TypeDef,
} from '../src/core';

installNodeDom(DOMParser);

const order = JSON.parse(readFileSync('tests/fixtures/spec-folder/processes/order.json', 'utf8')) as ProcessSpec;
const ORDER = order.processId!;

const t = (id: string, name: string, fields: Array<[string, string]>, interactionId?: string): TypeDef =>
  ({ id, name, kind: 'case', ...(interactionId ? { interactionId } : {}), fields: fields.map(([n, type]) => ({ id: `${id}-${n}`, name: n, type })) });
const svc = (id: string, name: string): CollectionService =>
  ({ id, name, api: 'client', apiVersion: 1, status: 'draft', method: 'GET', path: '/clients/{clientKey}', params: [], inTypeId: `${id}-in`, outTypeId: `${id}-out` });
const collection: ServiceCollectionSpec = {
  ...newCollection({ title: 'Client', project: 'acme-crm', api: 'client', apiVersion: 1 }),
  types: [t('get-in', 'In', [['clientKey', 'Long']], 'get'), t('get-out', 'Out', [['name', 'String']], 'get')],
  services: [svc('get', 'GetClient')],
};
const GET = 'acme-crm-clientV1.GetClient';

const orchestration = (() => {
  const { spec } = newServiceProcess({ title: 'Kunde ändern', project: 'acme-crm', api: 'client', apiVersion: 1, name: 'UpdateClient' });
  return { ...spec, types: spec.types!.map((x) => ({ ...x, fields: [{ id: `${x.id}-k`, name: 'clientKey', type: 'Long' }] })) };
})();
const UPDATE = 'acme-crm-clientV1.UpdateClient';

/** a released catalog: one worker of another project, delivered */
const catalog = { version: 1, services: [{ id: 'acme-crm-notifyPost', name: 'Post melden', topic: 'acme-crm-notifyPost', kind: 'service', generated: true }], domainTypes: [] } as unknown as Model;
const folder = { specs: [order, orchestration], collections: [collection] };

test('the folder in the catalog: a collection service, an orchestration and a process - each not released', () => {
  const m = folderCatalog(catalog, folder)!;
  const byId = new Map(m.services.map((s) => [s.topic ?? s.id, s]));
  assert.equal(byId.get('acme-crm-notifyPost')?.unreleased, undefined);
  assert.equal(byId.get(GET)?.unreleased, true);
  const update = byId.get(UPDATE)!;
  assert.deepEqual([update.kind, update.unreleased, update.inputs?.map((p) => p.name)], ['service', true, ['clientKey']]);
  const call = m.services.find((s) => s.kind === 'call' && s.calledProcess === ORDER)!;
  assert.equal(call.unreleased, true);
  assert.deepEqual(call.inputs?.map((p) => p.name), ['orderId', 'amount', 'customer']);
  // its In and Out as the catalog would have them from a build: the process object with its processName
  const processIn = m.domainTypes!.find((d) => d.processName === ORDER && d.name.endsWith('.In'));
  assert.equal(processIn?.dsl, 'Process');
  assert.equal(processIn?.unreleased, true);
  // the orchestration's In/Out as a CustomTask with its topic
  assert.ok(m.domainTypes!.some((d) => d.topicName === UPDATE && d.name.endsWith('.In')));
});

test('what the catalog has is released - the folder does not add it again, nothing is marked', () => {
  const released = { ...catalog, services: [...catalog.services,
    { id: ORDER, name: 'Bestellung', kind: 'call', calledProcess: ORDER, generated: true },
    { id: UPDATE, name: 'UpdateClient', kind: 'service', topic: UPDATE, generated: true },
    { id: GET, name: 'GetClient', kind: 'service', topic: GET, generated: true }] } as unknown as Model;
  const m = folderCatalog(released, folder)!;
  assert.equal(m.services.filter((s) => s.unreleased).length, 0);
  assert.equal(m.services.filter((s) => s.calledProcess === ORDER).length, 1);
  assert.equal(m.services.filter((s) => (s.topic ?? s.id) === UPDATE).length, 1);
});

test('the open spec is not in it (a process does not call itself); without a catalog nothing is marked', () => {
  const m = folderCatalog(catalog, folder, order.slug)!;
  assert.equal(m.services.some((s) => s.calledProcess === ORDER), false);
  const none = folderCatalog({ version: 1, services: [] } as Model, folder)!;
  assert.ok(none.services.some((s) => s.calledProcess === ORDER));
  assert.equal(none.services.some((s) => s.unreleased), false);
});

test('a step that calls something of the folder: a warning «noch nicht released» - unknown stays an error', () => {
  const host = { ...orchestration, slug: 'host', processId: 'acme-crm-hostV1' } as ProcessSpec;
  const m = folderCatalog(catalog, { specs: [order, host], collections: [collection] }, host.slug);
  const withStep = (step: Partial<Step>): ProcessSpec => {
    const first = allSteps(host.steps).find((s) => s.kind === 'service')!;
    const patch = (steps: Step[]): Step[] => steps.map((s) => (s.id === first.id ? { ...s, ...step } : s));
    return { ...host, service: undefined, steps: patch(host.steps) } as ProcessSpec;
  };
  const texts = (spec: ProcessSpec) => [...collectFindings(spec, m, allSteps(spec.steps)).values()].flatMap((f) => [...f.errors.map((e) => `E ${e}`), ...f.warnings.map((w) => `W ${w}`)]);
  assert.ok(texts(withStep({ serviceId: GET, topic: GET })).some((x) => x === 'W «GetClient» ist noch nicht released – aus dem Ordner, noch nicht im Katalog.'));
  assert.ok(texts(withStep({ serviceId: 'acme-crm-unknownV1.Nope', topic: 'acme-crm-unknownV1.Nope' })).some((x) => x.startsWith('E Service «acme-crm-unknownV1.Nope» steht nicht im Katalog')));
});

test('pages: the folder\'s services and processes, the catalog\'s processes - an orchestration is no process a page starts', () => {
  const released = { ...catalog, services: [...catalog.services, { id: 'acme-crm-onboardV1', name: 'Onboarding', kind: 'call', calledProcess: 'acme-crm-onboardV1', generated: true }] } as unknown as Model;
  const m = folderCatalog(released, folder)!;
  const targets = targetsOf(m, folder.specs);
  assert.deepEqual(targets.processes.map((p) => [p.key, p.unreleased ?? false]), [[ORDER, true], ['acme-crm-onboardV1', false]]);
  const update = targets.services.find((s) => s.topic === UPDATE);
  assert.deepEqual([update?.unreleased, update?.in.map((f) => f.name)], [true, ['clientKey']]);
  assert.equal(targets.services.find((s) => s.topic === GET)?.unreleased, true);
});
