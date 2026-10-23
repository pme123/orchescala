// The app's address (redirect URI, setup link) is resolved against the
// document URL — also with the relative base (`./`) of the docs site.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appUrl, levelOf, setupLink } from '../src/auth';

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
