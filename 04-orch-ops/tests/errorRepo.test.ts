// The error logic against a backend that produces conflicts on purpose:
// counting with retry, the per-error queue, create/save, merging a refresh.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryBackend } from '../src/backend';
import {
  DIR, countErrorIn, createErrorIn, mergeRefresh, normalizeError, readAll, readError, saveErrorIn, serialize,
  type ErrorItem,
} from '../src/errorRepo';
import type { ErrorEntry } from '../src/types';

const noPause = async () => {};
let tick = 0;
const now = () => `2026-10-24T10:00:${String(tick++ % 60).padStart(2, '0')}+02:00`;

function entry(id: string, extra: Partial<ErrorEntry> = {}): ErrorEntry {
  return {
    id, process: 'acme-p', title: id, details: '', activity: '', reporter: '', status: ['OFFEN'],
    ticket: '', workaround: '', count: 2, createdAt: 'x', updatedAt: 'x', ...extra,
  };
}

function backendWith(...entries: ErrorEntry[]) {
  const be = new MemoryBackend();
  for (const e of entries) be.seed(`${DIR}/${e.id}.json`, JSON.stringify(e));
  return be;
}

test('count: +1, the occurrence logged, lastAction counted', async () => {
  const be = backendWith(entry('a'));
  const r = await countErrorIn(be, 'a', 'Anna', now, { pause: noPause });
  assert.ok(r.ok);
  const saved = (await readError(be, 'a'))!.data;
  assert.equal(saved.count, 3);
  assert.equal(saved.lastAction, 'counted');
  assert.equal(saved.updatedBy, 'Anna');
  assert.equal(saved.occurrences!.length, 1);
  assert.equal(saved.occurrences![0].by, 'Anna');
});

test('count: someone else counts in between — re-read, both counts stay', async () => {
  const be = backendWith(entry('a'));
  let interfered = false;
  be.beforeWrite = async path => {
    if (interfered) return;
    interfered = true; // the other writer, exactly between our read and our write
    const cur = (await readError(be, 'a'))!;
    be.beforeWrite = undefined;
    await be.write(path, JSON.stringify({ ...cur.data, count: cur.data.count + 1 }), { ifMatch: cur.version });
  };
  const r = await countErrorIn(be, 'a', '', now, { pause: noPause });
  assert.ok(r.ok);
  assert.equal((await readError(be, 'a'))!.data.count, 4, '2 + theirs + ours');
});

test('count: gives up after the attempts when it always conflicts — nothing written', async () => {
  const be = backendWith(entry('a'));
  let writes = 0;
  be.beforeWrite = async () => {
    writes++;
    const cur = (await readError(be, 'a'))!;
    const hook = be.beforeWrite; be.beforeWrite = undefined;
    await be.write(`${DIR}/a.json`, JSON.stringify({ ...cur.data, title: `t${writes}` }), { ifMatch: cur.version });
    be.beforeWrite = hook;
  };
  const r = await countErrorIn(be, 'a', '', now, { attempts: 3, pause: noPause });
  assert.equal(r.ok, false);
  assert.match((r as { message: string }).message, /Zu viele/);
  be.beforeWrite = undefined;
  assert.equal((await readError(be, 'a'))!.data.count, 2);
});

test('count: a hand-edited file with broken occurrences still counts', async () => {
  const be = new MemoryBackend();
  be.seed(`${DIR}/a.json`, JSON.stringify({ ...entry('a'), occurrences: 'kaputt', count: '5' }));
  const r = await countErrorIn(be, 'a', '', now, { pause: noPause });
  assert.ok(r.ok);
  const saved = (await readError(be, 'a'))!.data;
  assert.equal(saved.count, 6);
  assert.equal(saved.occurrences!.length, 1);
});

test('count: a file that is not JSON gives a message, no exception', async () => {
  const be = new MemoryBackend();
  be.seed(`${DIR}/a.json`, '{ nope');
  const r = await countErrorIn(be, 'a', '', now, { pause: noPause });
  assert.equal(r.ok, false);
  assert.match((r as { message: string }).message, /unlesbar/);
});

test('serialize: two buttons counting the same error at once — both counts land', async () => {
  const be = backendWith(entry('a'));
  const chains = new Map<string, Promise<unknown>>();
  const run = () => serialize(chains, 'a', () => countErrorIn(be, 'a', '', now, { attempts: 1, pause: noPause }));
  // attempts: 1 — without the queue the second would conflict and give up
  const [x, y, z] = await Promise.all([run(), run(), run()]);
  assert.ok(x.ok && y.ok && z.ok);
  assert.equal((await readError(be, 'a'))!.data.count, 5);
  assert.equal(chains.size, 0, 'the queue cleans up');
});

test('serialize: a failing job does not block the next', async () => {
  const chains = new Map<string, Promise<unknown>>();
  const failed = serialize(chains, 'k', async () => { throw new Error('boom'); });
  const next = serialize(chains, 'k', async () => 42);
  await assert.rejects(failed, /boom/);
  assert.equal(await next, 42);
});

test('create: same process + title again gets -2; count 0 logs no occurrence', async () => {
  const be = new MemoryBackend();
  const draft = { process: 'acme-p', title: 'Timeout', details: '', activity: '', reporter: '', status: [], ticket: '', workaround: '' };
  const a = await createErrorIn(be, draft, 'Anna', now());
  const b = await createErrorIn(be, { ...draft, count: 0 }, 'Anna', now());
  assert.ok(a.ok && b.ok);
  assert.equal(a.item.data.id, 'acme-p--timeout');
  assert.equal(b.item.data.id, 'acme-p--timeout-2');
  assert.equal(a.item.data.occurrences!.length, 1);
  assert.equal(b.item.data.count, 0);
  assert.deepEqual(b.item.data.occurrences, []);
});

test('save: with the version read → saved; with an old version → conflict and the current state', async () => {
  const be = backendWith(entry('a'));
  const v0 = (await readError(be, 'a'))!;
  const s1 = await saveErrorIn(be, { ...v0.data, workaround: 'neu' }, v0.version, 'Anna', now());
  assert.equal(s1.status, 'saved');
  const s2 = await saveErrorIn(be, { ...v0.data, workaround: 'veraltet' }, v0.version, 'Leo', now());
  assert.equal(s2.status, 'conflict');
  assert.equal((s2 as { current: ErrorItem }).current.data.workaround, 'neu');
  assert.equal((await readError(be, 'a'))!.data.workaround, 'neu');
});

test('MemoryBackend: version must match exactly; createOnly refuses an existing file', async () => {
  const be = new MemoryBackend();
  const w1 = await be.write('x.json', '1');
  const w2 = await be.write('x.json', '2');
  assert.ok(w1.ok && w2.ok);
  assert.equal((await be.write('x.json', '3', { ifMatch: w1.version })).ok, false, 'an older version is a conflict');
  assert.equal((await be.write('x.json', '3', { ifMatch: w2.version })).ok, true);
  const c = await be.write('x.json', '4', { createOnly: true });
  assert.equal(c.ok, false);
  assert.equal((c as { reason: string }).reason, 'exists');
});

test('readAll: an unreadable file is reported, the others are read', async () => {
  const be = backendWith(entry('a'), entry('b'));
  be.seed(`${DIR}/broken.json`, '{ nope');
  be.seed(`${DIR}/notes.txt`, 'ignored');
  const r = await readAll(be);
  assert.deepEqual(r.items.map(i => i.data.id).sort(), ['a', 'b']);
  assert.deepEqual(r.failed, ['broken']);
});

test('mergeRefresh: keeps what this tab wrote after the refresh started, and what could not be read', () => {
  const item = (id: string, count: number, version = 'v'): ErrorItem => ({ data: entry(id, { count }), version });
  const prev = [item('a', 5, 'new'), item('b', 2), item('c', 7), item('gone', 1), item('fresh-local', 1)];
  const fresh = { items: [item('a', 4, 'old'), item('b', 3)], failed: ['c'] };
  const startedAt = 1000;
  const writtenAt = new Map([['a', 1500], ['b', 500], ['fresh-local', 1200]]);
  const merged = new Map(mergeRefresh(prev, fresh, startedAt, writtenAt).map(i => [i.data.id, i.data.count]));
  assert.equal(merged.get('a'), 5, 'counted here during the refresh — not overwritten by the older read');
  assert.equal(merged.get('b'), 3, 'written here long before — the folder is newer');
  assert.equal(merged.get('c'), 7, 'unreadable — last known state stays');
  assert.equal(merged.has('gone'), false, 'removed from the folder');
  assert.equal(merged.get('fresh-local'), 1, 'created here during the refresh');
});

test('normalizeError: missing or wrong fields become valid defaults', () => {
  const e = normalizeError({ title: 3, status: 'OFFEN', count: -2, occurrences: [{ at: 'x', by: 1 }, null, { by: 'y' }] }, 'id1');
  assert.equal(e.id, 'id1');
  assert.equal(e.title, '');
  assert.deepEqual(e.status, []);
  assert.equal(e.count, 1);
  assert.deepEqual(e.occurrences, [{ at: 'x' }]);
});
