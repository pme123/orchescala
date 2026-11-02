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
