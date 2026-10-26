// The app's address (redirect URI, setup link) is resolved against the
// document URL — also with the relative base (`./`) of the docs site.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_ROLES, ORCH_SPEC_ROLES, appUrl, cleanRoles, levelOf, setupLink, setupRoles } from '../src/auth';

// bundled into one module: the test's import.meta is the one src/auth.tsx reads
const meta = import.meta as unknown as { env?: { BASE_URL: string } };
const g = globalThis as unknown as { document?: unknown };
const at = (baseURI: string, BASE_URL: string) => { g.document = { baseURI }; meta.env = { BASE_URL }; };

const TENANT = '11111111-2222-3333-4444-555555555555';
const CLIENT = '66666666-7777-8888-9999-000000000000';

test('absolute base: origin + /orch-ops/, query and hash are dropped', () => {
  at('http://localhost:3005/orch-ops/?demo#/e/x', '/orch-ops/');
  assert.equal(appUrl().href, 'http://localhost:3005/orch-ops/');
});

test('relative base in the docs site: the folder of the page', () => {
  at('https://docs.example.com/orchescala/ops/index.html?x=1#/howto', './');
  assert.equal(appUrl().href, 'https://docs.example.com/orchescala/ops/');
});

test('setupLink: app address with tenant, client and folder', () => {
  at('https://docs.example.com/orchescala/ops/#/admin', './');
  const u = new URL(setupLink(TENANT, CLIENT, 'https://firma.sharepoint.com/sites/x'));
  assert.equal(`${u.origin}${u.pathname}`, 'https://docs.example.com/orchescala/ops/');
  assert.equal(u.searchParams.get('tenant'), TENANT);
  assert.equal(u.searchParams.get('client'), CLIENT);
  assert.equal(u.searchParams.get('folder'), 'https://firma.sharepoint.com/sites/x');
  assert.ok(!new URL(setupLink(TENANT, CLIENT)).searchParams.has('folder'));
});

test('levelOf: roles from the ID token', () => {
  assert.equal(levelOf([], null), 'admin', 'no roles configured → everyone is admin');
  const cfg = { enabled: true, tenantId: TENANT, clientId: CLIENT, adminRole: 'OrchOps.Admin', reviewerRole: 'OrchOps.Editor', viewerRole: 'OrchOps.Viewer' };
  assert.equal(levelOf(['OrchOps.Viewer', 'OrchOps.Admin'], cfg), 'admin');
  assert.equal(levelOf(['OrchOps.Editor'], cfg), 'reviewer');
  assert.equal(levelOf(['OrchOps.Viewer'], cfg), 'viewer');
  assert.equal(levelOf([], cfg), 'none');
  assert.equal(levelOf([], { ...cfg, reviewerRole: undefined }), 'reviewer', 'without reviewer role: signed in = reviewer');
});

test('roles: OrchOps by default, orch-spec roles as an alternative', () => {
  assert.deepEqual(DEFAULT_ROLES, { adminRole: 'OrchOps.Admin', reviewerRole: 'OrchOps.Editor', viewerRole: 'OrchOps.Viewer' });
  assert.equal(ORCH_SPEC_ROLES.adminRole, 'OrchSpec.Admin');
  const cfg = { enabled: true, tenantId: TENANT, clientId: CLIENT, ...ORCH_SPEC_ROLES };
  assert.equal(levelOf(['OrchSpec.Editor'], cfg), 'reviewer');
  assert.equal(levelOf(['OrchOps.Editor'], cfg), 'none');
});

test('cleanRoles trims and drops empty roles', () => {
  assert.deepEqual(cleanRoles({ adminRole: ' A ', reviewerRole: '', viewerRole: '  ' }), { adminRole: 'A' });
});

test('setupRoles: the roles chosen at setup, otherwise the defaults', () => {
  assert.deepEqual(setupRoles(null), DEFAULT_ROLES);
  assert.deepEqual(setupRoles({}), DEFAULT_ROLES);
  assert.deepEqual(setupRoles({ adminRole: '', reviewerRole: ' ' }), DEFAULT_ROLES);
  assert.deepEqual(setupRoles({ ...ORCH_SPEC_ROLES, viewerRole: '' }), { adminRole: 'OrchSpec.Admin', reviewerRole: 'OrchSpec.Editor' });
});
