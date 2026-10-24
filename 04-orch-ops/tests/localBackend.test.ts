// LocalBackend against an in-memory stand-in for the File System Access API:
// the version check is exact (an older version is a conflict, too) and
// createOnly never overwrites.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LocalBackend } from '../src/backend';

let clock = 1_000;
// a frozen clock: every write lands in the same millisecond
let frozen = false;
const nextTime = () => (frozen ? clock : clock++);

class FakeFile {
  constructor(public body: Blob, public lastModified: number) {}
}

class FakeFileHandle {
  kind = 'file' as const;
  file: FakeFile;
  constructor(public name: string) { this.file = new FakeFile(new Blob(['']), nextTime()); }
  async getFile() {
    const f = this.file;
    return Object.assign(f.body, { lastModified: f.lastModified, name: this.name }) as unknown as File;
  }
  async createWritable() {
    let next: Blob = new Blob(['']);
    return {
      write: async (b: string | Blob) => { next = typeof b === 'string' ? new Blob([b]) : b; },
      close: async () => { this.file = new FakeFile(next, nextTime()); },
    };
  }
}

class FakeDir {
  kind = 'directory' as const;
  dirs = new Map<string, FakeDir>();
  files = new Map<string, FakeFileHandle>();
  constructor(public name: string) {}
  async getDirectoryHandle(n: string, o: { create?: boolean } = {}) {
    if (!this.dirs.has(n)) { if (!o.create) throw new Error('NotFound'); this.dirs.set(n, new FakeDir(n)); }
    return this.dirs.get(n)!;
  }
  async getFileHandle(n: string, o: { create?: boolean } = {}) {
    if (!this.files.has(n)) { if (!o.create) throw new Error('NotFound'); this.files.set(n, new FakeFileHandle(n)); }
    return this.files.get(n)!;
  }
  async *entries() { for (const e of [...this.dirs, ...this.files]) yield e; }
}

const backend = () => new LocalBackend(new FakeDir('ops') as unknown as FileSystemDirectoryHandle);

test('write/read round trip, the version is lastModified', async () => {
  const be = backend();
  const w = await be.write('errors/a.json', '{"x":1}');
  assert.ok(w.ok);
  const r = await be.read('errors/a.json');
  assert.equal(r!.text, '{"x":1}');
  assert.equal(r!.version, (w as { version: string }).version);
  assert.deepEqual((await be.list('errors')).map(f => f.name), ['a.json']);
});

test('ifMatch: the current version passes, an older one is a conflict (not only a newer one)', async () => {
  const be = backend();
  const w1 = await be.write('m.json', '1') as { version: string };
  const w2 = await be.write('m.json', '2', { ifMatch: w1.version }) as { ok: boolean; version: string };
  assert.ok(w2.ok);
  const stale = await be.write('m.json', '3', { ifMatch: w1.version });
  assert.equal(stale.ok, false);
  assert.equal((stale as { reason: string }).reason, 'conflict');
  // a version that is not older but simply different
  const other = await be.write('m.json', '3', { ifMatch: String(Number(w2.version) + 99) });
  assert.equal(other.ok, false);
  assert.equal((await be.read('m.json'))!.text, '2');
});

test('createOnly: refuses an existing file and leaves it untouched', async () => {
  const be = backend();
  assert.ok((await be.write('errors/a.json', 'first', { createOnly: true })).ok);
  const again = await be.write('errors/a.json', 'second', { createOnly: true });
  assert.equal(again.ok, false);
  assert.equal((again as { reason: string }).reason, 'exists');
  assert.equal((await be.read('errors/a.json'))!.text, 'first');
});

test('missing files read as null, binary round trip', async () => {
  const be = backend();
  assert.equal(await be.read('nope.json'), null);
  assert.equal(await be.readBlob('attachments/2026-10/x.png'), null);
  await be.write('attachments/2026-10/x.png', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }));
  const b = await be.readBlob('attachments/2026-10/x.png');
  assert.deepEqual([...new Uint8Array(await b!.arrayBuffer())], [1, 2, 3]);
});

test('ifMatch on a file that is gone: a conflict — and no empty file is created', async () => {
  const be = backend();
  const w = await be.write('errors/gone.json', '{"count":2}', { ifMatch: '123-abc' });
  assert.equal(w.ok, false);
  assert.equal((w as { reason: string }).reason, 'conflict');
  assert.equal(await be.read('errors/gone.json'), null, 'nothing created');
  assert.deepEqual(await be.list('errors'), [], 'not even the folder has a file');
});

test('same millisecond, other content: still a new version — the old one is a conflict', async () => {
  const be = backend();
  frozen = true;
  try {
    const w1 = await be.write('m.json', '{"count":2}') as { version: string };
    const w2 = await be.write('m.json', '{"count":3}', { ifMatch: w1.version }) as { ok: boolean; version: string };
    assert.ok(w2.ok);
    assert.notEqual(w2.version, w1.version, 'checksum tells them apart although the time is the same');
    const stale = await be.write('m.json', '{"count":3}', { ifMatch: w1.version });
    assert.equal(stale.ok, false);
    assert.equal((await be.read('m.json'))!.version, w2.version);
  } finally {
    frozen = false;
  }
});
