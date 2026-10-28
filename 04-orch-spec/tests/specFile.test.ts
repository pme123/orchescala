// Reading a specification: a missing file is null (the view says «gibt es nicht»), a read
// error or a file that is not JSON rejects with path and cause (the view shows it) -
// before, all of it was null and a link stayed on «Lade Spezifikation …» forever.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readSpecFile } from '../src/specFile';
import type { ReadResult } from '../src/backend';

const backend = (read: (path: string) => Promise<ReadResult | null>) => ({ read });

test('a missing file is null', async () => {
  assert.equal(await readSpecFile(backend(async () => null), 'processes/x.json'), null);
});

test('a file is read with its version', async () => {
  const r = await readSpecFile(backend(async () => ({ text: '{"processId":"acme-demo-testV1"}', version: 'v7' })), 'processes/x.json');
  assert.deepEqual(r, { raw: { processId: 'acme-demo-testV1' }, version: 'v7' });
});

test('a read error rejects with its message', async () => {
  await assert.rejects(
    readSpecFile(backend(async () => { throw new Error('Lesen fehlgeschlagen (HTTP 403).'); }), 'processes/x.json'),
    /HTTP 403/);
});

test('a file that is not JSON rejects with the path and the cause', async () => {
  await assert.rejects(
    readSpecFile(backend(async () => ({ text: '<!doctype html>', version: '1' })), 'processes/x.json'),
    (e: Error) => e.message.startsWith('processes/x.json ist unlesbar (kein gültiges JSON: ') && e.message.length > 50);
});
