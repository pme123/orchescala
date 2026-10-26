// The app's address (redirect URI, setup link) is resolved against the
// document URL — also with the relative base (`./`) of the docs site.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_ROLES, ORCH_SPEC_ROLES, PENDING_ROLES_TTL_MS, appUrl, cleanRoles, levelOf, newFolderRoles, parsePendingRoles,
  parseRoles, pendingRolesAfterLoad, sameRoles, setupLink, withRoles,
} from '../src/auth';
import { joinOr } from '../src/util';

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

test('newFolderRoles: setup roles only for a folder the user connected, otherwise the defaults', () => {
  assert.deepEqual(newFolderRoles(null, true), DEFAULT_ROLES);
  assert.deepEqual(newFolderRoles({ ...ORCH_SPEC_ROLES, viewerRole: ' ' }, true), { adminRole: 'OrchSpec.Admin', reviewerRole: 'OrchSpec.Editor' });
  // deliberately all empty stays empty (everyone signed in is admin), as in Admin → Anmeldung
  assert.deepEqual(newFolderRoles({}, true), {});
  assert.deepEqual(newFolderRoles({ adminRole: '', reviewerRole: '' }, true), {});
  // a folder restored on start never takes the roles chosen for another one
  assert.deepEqual(newFolderRoles(ORCH_SPEC_ROLES, false), DEFAULT_ROLES);
  assert.deepEqual(newFolderRoles({}, false), DEFAULT_ROLES);
});

test('pendingRolesAfterLoad: used up only by a connected folder whose roles are settled', () => {
  assert.equal(pendingRolesAfterLoad(true, 'created'), 'clear');
  assert.equal(pendingRolesAfterLoad(true, 'existing'), 'clear');
  assert.equal(pendingRolesAfterLoad(true, 'createdWithoutAuth'), 'keep'); // roles not written
  assert.equal(pendingRolesAfterLoad(false, 'created'), 'keep');
  assert.equal(pendingRolesAfterLoad(false, 'existing'), 'keep');
  assert.equal(pendingRolesAfterLoad(false, 'createdWithoutAuth'), 'keep');
});

test('parsePendingRoles: stored with a time, expired or unusable → null', () => {
  const now = 1_800_000_000_000;
  const raw = (roles: unknown, at: unknown = now - 1000) => JSON.stringify({ roles, at });
  assert.deepEqual(parsePendingRoles(raw(ORCH_SPEC_ROLES), now), ORCH_SPEC_ROLES);
  assert.deepEqual(parsePendingRoles(raw({}), now), {}); // none chosen ≠ nothing stored
  assert.deepEqual(parsePendingRoles(raw({ adminRole: ' A ', viewerRole: 3, other: 'x' }), now), { adminRole: 'A' });
  assert.equal(parsePendingRoles(raw(ORCH_SPEC_ROLES, now - PENDING_ROLES_TTL_MS - 1), now), null);
  assert.equal(parsePendingRoles(raw(ORCH_SPEC_ROLES, now + 60_000), now), null);
  assert.equal(parsePendingRoles(raw(ORCH_SPEC_ROLES, 'yesterday'), now), null);
  assert.equal(parsePendingRoles(raw([]), now), null);
  assert.equal(parsePendingRoles(JSON.stringify(ORCH_SPEC_ROLES), now), null); // old format without time
  assert.equal(parsePendingRoles(null, now), null);
  assert.equal(parsePendingRoles('not json', now), null);
  assert.equal(parsePendingRoles('null', now), null);
  assert.equal(parseRoles('x'), null);
});

test('sameRoles compares the cleaned values', () => {
  assert.equal(sameRoles({ adminRole: ' OrchSpec.Admin', reviewerRole: 'OrchSpec.Editor ', viewerRole: 'OrchSpec.Viewer' }, ORCH_SPEC_ROLES), true);
  assert.equal(sameRoles({ adminRole: '', viewerRole: ' ' }, {}), true);
  assert.equal(sameRoles(DEFAULT_ROLES, ORCH_SPEC_ROLES), false);
  assert.equal(sameRoles({ ...DEFAULT_ROLES, viewerRole: '' }, DEFAULT_ROLES), false);
});

test('withRoles replaces the roles: trimmed, empty ones dropped, rest kept', () => {
  const cfg = { enabled: true, tenantId: TENANT, clientId: CLIENT, ...DEFAULT_ROLES };
  assert.deepEqual(withRoles(cfg, { adminRole: ' X.Admin ', reviewerRole: '' }),
    { enabled: true, tenantId: TENANT, clientId: CLIENT, adminRole: 'X.Admin' });
  assert.deepEqual(withRoles(cfg, {}), { enabled: true, tenantId: TENANT, clientId: CLIENT });
});

test('joinOr lists the role names', () => {
  assert.equal(joinOr([]), '');
  assert.equal(joinOr(['A', undefined, '']), 'A');
  assert.equal(joinOr(['A', 'B']), 'A oder B');
  assert.equal(joinOr(['A', 'B', 'C']), 'A, B oder C');
  assert.equal(joinOr(['A', 'A', 'B']), 'A oder B');
});
