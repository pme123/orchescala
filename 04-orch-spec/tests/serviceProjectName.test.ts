// The project of a service collection becomes the Scala package of its code:
// company and project joined by `-`, each part a valid package name.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PROJECT_NAME } from '../src/services/collection.ts';

test('project names with upper case, digits, «_» and «-» are valid', () => {
  for (const name of ['acme-crm', 'z9nai-crm', 'acme-crm2', 'acme-orch_spec', 'z9nai-orch-spec', '_acme-crm', 'acme-coreNeoIs', 'Acme-Crm'])
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

test('renameApi: a collection has one API - its services and its serviceBasePath follow', async () => {
  const { newCollection, renameApi } = await import('../src/services/collection.ts');
  const c0 = newCollection({ title: 'T', project: 'acme-crm', api: 'client', apiVersion: 1 });
  const svc = (id: string) =>
    ({ id, name: id, api: 'client', apiVersion: 1, status: 'draft', method: 'GET', path: '/', params: [] }) as unknown as typeof c0.services[number];
  const c = { ...c0, services: [svc('a'), svc('b')], serviceBasePaths: { 'client.v1': 's"$base/c"' } };
  const r = renameApi(c, c, { api: 'clientMaster', apiVersion: 2 });
  assert.deepEqual(r.services.map(s => `${s.id}:${s.api}v${s.apiVersion}`), ['a:clientMasterv2', 'b:clientMasterv2']);
  assert.deepEqual([r.api, r.apiVersion], ['clientMaster', 2]);
  assert.deepEqual(r.serviceBasePaths, { 'clientMaster.v2': 's"$base/c"' });
});

test('a service has the API of its collection - another one it carries is replaced on load', async () => {
  const { apiOf, newCollection, withServiceApis } = await import('../src/services/collection.ts');
  const c0 = newCollection({ title: 'T', project: 'acme-crm', api: 'clientMaster.multipleNatural', apiVersion: 1 });
  const s = { id: 's', name: 'UpdateX', api: 'updateMultipleNaturalPerson5', apiVersion: 1, status: 'draft', method: 'PUT', path: '/', params: [] } as unknown as typeof c0.services[number];
  const c = { ...c0, services: [s] };
  assert.deepEqual(apiOf(c, s), { project: 'acme-crm', api: 'clientMaster.multipleNatural', apiVersion: 1 });
  assert.equal(withServiceApis(c).services[0].api, 'clientMaster.multipleNatural');
});

test('renameProject: as for a process the old prefix goes everywhere - IDs and a title, the file name stays', async () => {
  const { newCollection, renameProject } = await import('../src/services/collection.ts');
  const c = { ...newCollection({ title: 'acme-crm ClientMaster', project: 'acme-crm', api: 'client', apiVersion: 1 }), description: 'Topics acme-crm-clientV1.GetClient; acme-crm2 bleibt' };
  const r = renameProject(c, 'acme-sales');
  assert.equal(r.project, 'acme-sales');
  assert.equal(r.title, 'acme-sales ClientMaster');
  assert.equal(r.description, 'Topics acme-sales-clientV1.GetClient; acme-crm2 bleibt');
  assert.equal(r.slug, c.slug);
  assert.equal(renameProject(c, 'acme-crm'), c);
});

test('replacePrefix: the prefix as a whole - before -, a blank, a dot or at the end', async () => {
  const { replacePrefix } = await import('../src/stepIds.ts');
  assert.equal(replacePrefix('acme-crm', 'acme-crm', 'acme-x'), 'acme-x');
  assert.equal(replacePrefix('acme-crm-clientV1', 'acme-crm', 'acme-x'), 'acme-x-clientV1');
  assert.equal(replacePrefix('«acme-crm Kunden»', 'acme-crm', 'acme-x'), '«acme-x Kunden»');
  assert.equal(replacePrefix('acme-crm2', 'acme-crm', 'acme-x'), 'acme-crm2');
});

test('projectSuggestions: URL and serviceBasePath of the other collections of the same project', async () => {
  const { newCollection, projectSuggestions } = await import('../src/services/collection.ts');
  const mk = (title: string, project: string, extra: object = {}) => ({ ...newCollection({ title, project, api: 'client', apiVersion: 1 }), ...extra });
  const me = mk('Organisation', 'acme-crm');
  const sibling = mk('Person', 'acme-crm', { source: { basePath: 'https://crm.acme.ch/api' }, serviceBasePaths: { 'client.v1': 's"$crmBasePath/api"' } });
  const other = mk('Fremd', 'acme-sales', { source: { basePath: 'https://sales.acme.ch' } });
  assert.deepEqual(projectSuggestions(me, [me, sibling, other]), { urls: ['https://crm.acme.ch/api'], serviceBasePaths: ['s"$crmBasePath/api"'] });
  assert.deepEqual(projectSuggestions(me, [me, other]), { urls: [], serviceBasePaths: [] });
});
