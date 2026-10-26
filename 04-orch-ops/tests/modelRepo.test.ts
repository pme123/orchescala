// Opening a folder's model.json against a MemoryBackend: new or existing,
// connected by the user or restored, and what happens to the roles chosen
// at setup (pending roles) in each case.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryBackend, type WriteResult } from '../src/backend';
import { DEFAULT_ROLES, ORCH_SPEC_ROLES } from '../src/auth';
import { openModel } from '../src/modelRepo';

const IDS = { tenantId: '11111111-2222-3333-4444-555555555555', clientId: '66666666-7777-8888-9999-000000000000' };
const EXISTING = JSON.stringify({ version: 1, company: 'Bank', statuses: [], auth: { enabled: true, ...IDS, adminRole: 'Own.Admin' } });

class FailingBackend extends MemoryBackend {
  constructor(private reason: 'forbidden' | 'error') { super(); }
  async write(): Promise<WriteResult> { return { ok: false, reason: this.reason, message: 'nein' }; }
}

const stored = async (be: MemoryBackend) => JSON.parse((await be.read('model.json'))!.text);

test('connected new folder: gets the roles chosen at setup, they are used up', async () => {
  const be = new MemoryBackend();
  const res = await openModel(be, { origin: 'connected', ids: IDS, pendingRoles: ORCH_SPEC_ROLES });
  assert.equal(res.kind, 'ok');
  assert.equal(res.kind === 'ok' && res.created, true);
  assert.equal(res.pendingRoles, 'clear');
  assert.deepEqual((await stored(be)).auth, { enabled: false, ...IDS, ...ORCH_SPEC_ROLES });
});

test('connected new folder, roles deliberately all empty: no roles written, used up', async () => {
  const be = new MemoryBackend();
  const res = await openModel(be, { origin: 'connected', ids: IDS, pendingRoles: {} });
  assert.equal(res.pendingRoles, 'clear');
  assert.deepEqual((await stored(be)).auth, { enabled: false, ...IDS });
});

test('connected new folder without pending roles: the defaults', async () => {
  const be = new MemoryBackend();
  const res = await openModel(be, { origin: 'connected', ids: IDS, pendingRoles: null });
  assert.equal(res.kind, 'ok');
  assert.deepEqual((await stored(be)).auth, { enabled: false, ...IDS, ...DEFAULT_ROLES });
});

test('restored new folder: the defaults, pending roles untouched', async () => {
  const be = new MemoryBackend();
  const res = await openModel(be, { origin: 'restored', ids: IDS, pendingRoles: ORCH_SPEC_ROLES });
  assert.equal(res.pendingRoles, 'keep');
  assert.deepEqual((await stored(be)).auth, { enabled: false, ...IDS, ...DEFAULT_ROLES });
});

test('existing folder keeps its own roles; connected uses the pending ones up, restored does not', async () => {
  for (const [origin, expected] of [['connected', 'clear'], ['restored', 'keep']] as const) {
    const be = new MemoryBackend();
    be.seed('model.json', EXISTING);
    const res = await openModel(be, { origin, ids: IDS, pendingRoles: ORCH_SPEC_ROLES });
    assert.equal(res.kind, 'ok');
    assert.equal(res.kind === 'ok' && res.created, false);
    assert.equal(res.kind === 'ok' && res.model.auth?.adminRole, 'Own.Admin');
    assert.equal(res.pendingRoles, expected);
    assert.equal((await be.read('model.json'))!.text, EXISTING); // not rewritten
  }
});

test('without IDs: a model.json without sign-in settings, pending roles kept', async () => {
  const be = new MemoryBackend();
  const res = await openModel(be, { origin: 'connected', ids: null, pendingRoles: ORCH_SPEC_ROLES });
  assert.equal(res.kind, 'ok');
  assert.equal(res.pendingRoles, 'keep');
  assert.equal((await stored(be)).auth, undefined);
});

test('create fails: message, pending roles kept for another try', async () => {
  const forbidden = await openModel(new FailingBackend('forbidden'), { origin: 'connected', ids: IDS, pendingRoles: ORCH_SPEC_ROLES });
  assert.deepEqual(forbidden, { kind: 'error', pendingRoles: 'keep', message: 'model.json fehlt und kann nicht angelegt werden (keine Schreibberechtigung).' });
  const other = await openModel(new FailingBackend('error'), { origin: 'connected', ids: IDS, pendingRoles: ORCH_SPEC_ROLES });
  assert.deepEqual(other, { kind: 'error', pendingRoles: 'keep', message: 'model.json fehlt und konnte nicht angelegt werden.' });
});

test('someone else creates it at the same moment: theirs is read', async () => {
  const be = new MemoryBackend();
  be.beforeWrite = () => { be.seed('model.json', EXISTING); };
  const res = await openModel(be, { origin: 'connected', ids: IDS, pendingRoles: ORCH_SPEC_ROLES });
  assert.equal(res.kind === 'ok' && res.created, false);
  assert.equal(res.kind === 'ok' && res.model.auth?.adminRole, 'Own.Admin');
  assert.equal(res.pendingRoles, 'clear');
});

test('broken model.json: message, not overwritten, pending roles kept', async () => {
  const be = new MemoryBackend();
  be.seed('model.json', '{ kaputt');
  const res = await openModel(be, { origin: 'connected', ids: IDS, pendingRoles: ORCH_SPEC_ROLES });
  assert.deepEqual(res, { kind: 'error', message: 'model.json ist unlesbar (kein gültiges JSON).', pendingRoles: 'keep' });
  assert.equal((await be.read('model.json'))!.text, '{ kaputt');
});

test('read throws: message, pending roles kept', async () => {
  const be = new MemoryBackend();
  be.read = async () => { throw new Error('offline'); };
  const res = await openModel(be, { origin: 'connected', ids: IDS, pendingRoles: ORCH_SPEC_ROLES });
  assert.deepEqual(res, { kind: 'error', message: 'model.json konnte nicht gelesen werden: offline', pendingRoles: 'keep' });
});

test('another folder became active meanwhile: nothing written', async () => {
  const be = new MemoryBackend();
  const res = await openModel(be, { origin: 'connected', ids: IDS, pendingRoles: ORCH_SPEC_ROLES, active: () => false });
  assert.deepEqual(res, { kind: 'stale', pendingRoles: 'keep' });
  assert.equal(await be.read('model.json'), null);
});

// someone else created it, but reads find nothing for a while (SharePoint lag)
class LaggingBackend extends MemoryBackend {
  constructor(private emptyReads: number) { super(); this.seed('model.json', EXISTING); }
  async read(path: string) {
    if (this.emptyReads > 0) { this.emptyReads--; return null; }
    return super.read(path);
  }
}

test('created by someone else, readable only after a moment: read again after a pause', async () => {
  const res = await openModel(new LaggingBackend(3), { origin: 'connected', ids: IDS, pendingRoles: ORCH_SPEC_ROLES, retryDelayMs: 0 });
  assert.equal(res.kind === 'ok' && res.model.auth?.adminRole, 'Own.Admin');
  assert.equal(res.pendingRoles, 'clear');
});

test('created by someone else but never readable: message, nothing overwritten, pending roles kept', async () => {
  const be = new LaggingBackend(99);
  const res = await openModel(be, { origin: 'connected', ids: IDS, pendingRoles: ORCH_SPEC_ROLES, retryDelayMs: 0 });
  assert.deepEqual(res, { kind: 'error', pendingRoles: 'keep', message: 'model.json gibt es schon, sie lässt sich aber (noch) nicht lesen — bitte neu laden.' });
  assert.equal(await (await be.readBlob('model.json'))!.text(), EXISTING); // theirs stays as it is
});

test('after «exists» every further read waits first', async () => {
  const waits: number[] = [];
  const orig = globalThis.setTimeout;
  globalThis.setTimeout = ((fn: () => void, ms?: number) => { waits.push(ms ?? 0); return orig(fn, 0); }) as typeof setTimeout;
  try {
    await openModel(new LaggingBackend(99), { origin: 'connected', ids: IDS, pendingRoles: null, retryDelayMs: 500 });
  } finally {
    globalThis.setTimeout = orig;
  }
  assert.deepEqual(waits, [500, 500, 500]); // 4 reads: the first right away, then three after a pause
});
