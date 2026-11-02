// The project of a service collection becomes the Scala package of its code:
// company and project joined by `-`, each part a valid package name.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PROJECT_NAME } from '../src/services/collection.ts';

test('project names with upper case, digits, «_» and «-» are valid', () => {
  for (const name of ['acme-crm', 'z9nai-crm', 'acme-crm2', 'acme-orch_spec', 'z9nai-orch-spec', '_acme-crm', 'z9nai-finnovaNeoIs', 'Acme-Crm'])
    assert.ok(PROJECT_NAME.test(name), name);
});

test('project names that give no Scala package are refused', () => {
  for (const name of ['z9nai', 'acme-', '-crm', 'acme--crm', '9acme-crm', 'acme-2crm', 'acme crm', 'acme.crm'])
    assert.ok(!PROJECT_NAME.test(name), name);
});

test('an API typed with upper case becomes its name in camelCase', async () => {
  const { API_NAME, apiName } = await import('../src/services/collection.ts');
  assert.equal(apiName('NaturalPerson'), 'naturalPerson');
  assert.equal(apiName(' client '), 'client');
  assert.ok(API_NAME.test(apiName('NaturalPerson')));
});

test('renameApi: the services of the API, the default and its serviceBasePath follow', async () => {
  const { newCollection, renameApi } = await import('../src/services/collection.ts');
  const c0 = newCollection({ title: 'T', project: 'acme-crm', api: 'client', apiVersion: 1 });
  const svc = (id: string, api: string, apiVersion: number) =>
    ({ id, name: id, api, apiVersion, status: 'draft', method: 'GET', path: '/', params: [] }) as unknown as typeof c0.services[number];
  const c = { ...c0, services: [svc('a', 'client', 1), svc('b', 'crm', 2)], serviceBasePaths: { 'client.v1': 's"$base/c"', 'crm.v2': 's"$base/crm"' } };
  const r = renameApi(c, { api: 'client', apiVersion: 1 }, { api: 'clientMaster', apiVersion: 1 });
  assert.deepEqual(r.services.map(s => `${s.id}:${s.api}v${s.apiVersion}`), ['a:clientMasterv1', 'b:crmv2']);
  assert.deepEqual([r.api, r.apiVersion], ['clientMaster', 1]);
  assert.deepEqual(r.serviceBasePaths, { 'clientMaster.v1': 's"$base/c"', 'crm.v2': 's"$base/crm"' });
  // another version of the second API: the default stays
  const v3 = renameApi(r, { api: 'crm', apiVersion: 2 }, { api: 'crm', apiVersion: 3 });
  assert.deepEqual(v3.services.map(s => s.apiVersion), [1, 3]);
  assert.equal(v3.api, 'clientMaster');
});
