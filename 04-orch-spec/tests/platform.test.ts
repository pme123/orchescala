// The runs of the studio in orch-spec (E25, step 6.3) - without a browser: the switch (`/platform/config`),
// the calls, the whole folder for a run, and the comparison of the spec on the branch with the folder.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FileInfo, StorageBackend } from '../src/backend';
import { collectSpec, memoryFolder } from '../src/platform/collect';
import {
  callPlatform, driftForCommit, driftNote, duration, loadPlatformConfig, parsePlatformConfig, PLATFORM_OFF, planLine, platformPath, projectOf, runLabel, runOpen, WORK_NAME,
  type RunStatus,
} from '../src/platform/config';
import { diffSpecFolders, formatSpecDiff, isEmptyDiff } from '../src/specDiff';

const fakeFetch = (status: number, body: unknown, seen: { url: string; init?: RequestInit }[] = []) =>
  (async (url: string, init?: RequestInit) => {
    seen.push({ url, init });
    if (status === 0) throw new TypeError('Failed to fetch');
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;

test('the switch - the projects of the studio, off for anything unexpected', async () => {
  const on = parsePlatformConfig({ enabled: true, projects: [{ name: ' democompany-customer ', testUrl: 'http://test/', handOver: true }, { name: 'cards' }, { nope: 1 }, null] });
  assert.deepEqual(on, { enabled: true, projects: [{ name: 'democompany-customer', testUrl: 'http://test/', handOver: true }, { name: 'cards', handOver: false }] });
  for (const off of [null, 'x', {}, { enabled: false, projects: [] }, { enabled: true }, { enabled: 'true', projects: [] }]) assert.deepEqual(parsePlatformConfig(off), PLATFORM_OFF);
  assert.deepEqual(await loadPlatformConfig(fakeFetch(200, { enabled: true, projects: [{ name: 'a' }] })), { enabled: true, projects: [{ name: 'a', handOver: false }] });
  assert.deepEqual(await loadPlatformConfig(fakeFetch(404, 'not found')), PLATFORM_OFF);
  assert.deepEqual(await loadPlatformConfig(fakeFetch(200, '<html>')), PLATFORM_OFF);
  assert.deepEqual(await loadPlatformConfig(fakeFetch(0, null)), PLATFORM_OFF);
  // the project of the folder: one the studio has, named by a process or a page
  assert.equal(projectOf(on, [undefined, 'cards', 'democompany-customer'])?.name, 'democompany-customer');
  assert.equal(projectOf(on, ['other', undefined]), undefined);
  assert.equal(projectOf(PLATFORM_OFF, ['cards']), undefined);
  assert.equal(platformPath('democompany-customer', 'hand-over'), '/platform/democompany-customer/hand-over');
});

test('a call of the studio - its answer, or the text it refuses with', async () => {
  const seen: { url: string; init?: RequestInit }[] = [];
  assert.deepEqual(await callPlatform('/platform/a/status', undefined, fakeFetch(200, { status: null, work: null }, seen)), { ok: { status: null, work: null } });
  assert.equal(seen[0].init?.method, 'GET');
  assert.deepEqual(await callPlatform('/platform/a/test', { previewId: 'p1' }, fakeFetch(409, { error: 'Der erste Lauf einer Arbeit braucht ihren Namen.' }, seen)), { error: 'Der erste Lauf einer Arbeit braucht ihren Namen.' });
  assert.deepEqual([seen[1].init?.method, seen[1].init?.body], ['POST', '{"previewId":"p1"}']);
  assert.deepEqual(await callPlatform('/platform/a/status', undefined, fakeFetch(502, '<html>')), { error: 'Das Studio antwortet mit 502.' });
  assert.deepEqual(await callPlatform('/platform/a/status', undefined, fakeFetch(0, null)), { error: 'Keine Verbindung zum Studio.' });
});

/** A backend over files in memory - with or without the list of folders. */
function backend(files: Record<string, string>, withDirs = true): StorageBackend {
  const inDir = (dir: string) => Object.keys(files).filter(p => (dir ? p.startsWith(`${dir}/`) : true)).map(p => (dir ? p.slice(dir.length + 1) : p));
  return {
    kind: 'local', name: 'test',
    read: async path => (path in files ? { text: files[path], version: '1' } : null),
    write: async () => ({ ok: true, version: '1' }),
    list: async dir => inDir(dir).filter(r => !r.includes('/')).map((name): FileInfo => ({ name, version: '1' })),
    ensureDir: async () => undefined,
    delete: async () => ({ ok: true }),
    ...(withDirs ? { dirs: async (dir: string) => [...new Set(inDir(dir).filter(r => r.includes('/')).map(r => r.split('/')[0]))].sort() } : {}),
  };
}

const FOLDER = {
  'config/model.json': '{"company":"democompany"}',
  'processes/order.json': '{"slug":"order"}',
  'processes/order.bpmn': '<bpmn/>',
  'processes/order.audit.jsonl': '{}\n',
  'processes/order/rules.dmn': '<dmn/>',
  'pages/book.json': '{}',
  'catalog/services-OpenApi.yml': 'openapi: 3.0.0',
  'themes/bank/theme.json': '{}',
  'users.json': '[{"email":"re@democompany.ch"}]',
  'users.broken-20261101.json': '[',
  '.DS_Store': 'x',
  '.git/config': 'x',
  'pages/logo.png': 'binary',
};

test('the whole folder for a run - every text file, also in folders orch-spec does not write; no people, nothing hidden', async () => {
  const { files, skipped } = await collectSpec(backend(FOLDER));
  assert.deepEqual(files.map(f => f.path), [
    'catalog/services-OpenApi.yml', 'config/model.json', 'pages/book.json', 'processes/order.audit.jsonl', 'processes/order.bpmn',
    'processes/order.json', 'processes/order/rules.dmn', 'themes/bank/theme.json',
  ]);
  assert.equal(files.find(f => f.path === 'processes/order.bpmn')?.text, '<bpmn/>');
  assert.deepEqual(skipped, ['pages/logo.png']);
  // a backend that cannot list folders: the ones orch-spec knows, and the DMNs of each process
  const known = await collectSpec(backend(FOLDER, false));
  assert.deepEqual(known.files.map(f => f.path), [
    'catalog/services-OpenApi.yml', 'config/model.json', 'pages/book.json', 'processes/order.audit.jsonl', 'processes/order.bpmn',
    'processes/order.json', 'processes/order/rules.dmn',
  ]);
});

test('the spec on the branch against the folder - what is new for the RE, as text for the commit', () => {
  const before = memoryFolder([{ path: 'config/model.json', text: '{}' }, { path: 'catalog/a.yml', text: 'a: 1' }, { path: 'themes/t.json', text: '{}' }, { path: 'logo.bin', base64: 'AA==' }]);
  assert.deepEqual([before.list(''), before.dirs!(''), before.list('catalog'), before.read('catalog/a.yml'), before.read('logo.bin')], [['logo.bin'].filter(() => false), ['catalog', 'config', 'themes'], ['a.yml'], 'a: 1', null]);
  const after = memoryFolder([{ path: 'config/model.json', text: '{}' }, { path: 'catalog/a.yml', text: 'a: 2' }, { path: 'catalog/b.yml', text: 'b: 1' }]);
  const diff = diffSpecFolders(before, after);
  assert.deepEqual(diff.files, [{ path: 'catalog/a.yml', op: 'change' }, { path: 'catalog/b.yml', op: 'add' }, { path: 'themes/t.json', op: 'remove' }]);
  assert.equal(isEmptyDiff(diff), false);
  assert.match(formatSpecDiff(diff), /catalog\/b\.yml/);
  assert.equal(isEmptyDiff(diffSpecFolders(after, after)), true);
});

test('what the header and the dialog say of a run', () => {
  const run = (over: Partial<RunStatus>): RunStatus => ({
    runId: '20261118-0900', kind: 'test', project: 'app', state: 'running', startedBy: 're@democompany.ch', step: null, steps: [], work: 'filiale',
    workBranch: 'orch-spec/app/filiale', version: null, testUrl: null, pullRequest: null, tests: null, simulations: null, merge: null, waitingFor: null, error: null, ...over,
  });
  assert.equal(runLabel(run({})), 'Lauf startet');
  assert.equal(runLabel(run({ step: { index: 5, of: 8, name: 'Kompilieren und testen', since: '' } })), '5/8 Kompilieren und testen');
  assert.equal(runLabel(run({ state: 'waiting', error: { step: 'Merge', message: 'x', log: '', conflicts: [] } })), 'Lauf wartet: Merge');
  assert.equal(runLabel(run({ state: 'ok', version: '0.1.0-20261118-0900' })), 'Auf Test: 0.1.0-20261118-0900');
  assert.equal(runLabel(run({ state: 'error' })), 'Lauf abgebrochen');
  assert.deepEqual([runOpen(run({})), runOpen(run({ state: 'waiting' })), runOpen(run({ state: 'ok' })), runOpen(run({ state: 'error' })), runOpen(null)], [true, true, false, false, false]);
  assert.equal(planLine({ create: 2, update: 0, merged: 12, delete: 1, unchanged: 50, conflict: 1 }), '2 neu · 12 gemergt · 1 gelöscht · 1 Konflikt');
  assert.equal(planLine({ unchanged: 50, conflict: 0 }), 'keine Änderung im Code');
  // what the merge changes although the RE did not: the code differed from the spec before
  const merged = [{ path: 'A.scala', action: 'merged', drift: 'only' as const }, { path: 'B.scala', action: 'merged', drift: 'only' as const }, { path: 'C.scala', action: 'merged', drift: 'also' as const }, { path: 'D.scala', action: 'merged' }];
  assert.equal(driftNote(merged), '2 Dateien ändern sich nicht wegen dieser Änderung: Der Code wich dort schon vorher von der Spez ab. Eine Datei wich schon vorher ab und ändert sich auch wegen dieser Änderung. Der Merge bringt dort den Stand der Spez in den Code – die Entwicklung sollte das prüfen.');
  assert.equal(driftNote(merged.slice(0, 1)), 'Eine Datei ändert sich nicht wegen dieser Änderung: Der Code wich dort schon vorher von der Spez ab. Der Merge bringt dort den Stand der Spez in den Code – die Entwicklung sollte das prüfen.');
  assert.equal(driftNote(merged.slice(3)), '');
  assert.equal(driftForCommit(merged), 'Nicht von dieser Änderung – der Code wich schon vorher von der Spez ab:\n- A.scala\n- B.scala\nAuch von dieser Änderung – der Code wich schon vorher von der Spez ab:\n- C.scala');
  assert.equal(driftForCommit(merged.slice(3)), '');
  assert.deepEqual([duration(400), duration(13_100), duration(59_999), duration(180_000)], ['1 s', '13 s', '60 s', '3 min']);
  assert.deepEqual(['termin-filiale', '2-runde', 'Termin', 'a b', '-x', ''].map(n => WORK_NAME.test(n)), [true, true, false, false, false, false]);
});
