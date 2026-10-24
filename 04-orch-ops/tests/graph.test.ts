// GraphBackend under throttling: 429/503 are waited out (Retry-After) and tried
// again, other errors come back at once.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { GraphBackend, retryAfterMs } from '../src/graph';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const folder = { driveId: 'd', itemId: 'i', name: 'ops', webUrl: 'https://x.example/ops' };
const backend = () => new GraphBackend(folder, async () => 'token', 'https://graph.example');
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

test('429 with Retry-After is waited out, then the request goes through', async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return calls === 1 ? json({}, 429, { 'Retry-After': '0' }) : json({ value: [{ name: 'a.json', eTag: 'e1', file: {} }] });
  }) as typeof fetch;
  const files = await backend().list('errors');
  assert.equal(calls, 2);
  assert.deepEqual(files, [{ name: 'a.json', version: 'e1' }]);
});

test('gives up after a few tries and reports the status', async () => {
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return json({}, 503, { 'Retry-After': '0' }); }) as typeof fetch;
  await assert.rejects(backend().list('errors'), /503/);
  assert.equal(calls, 4);
});

test('other errors are not retried', async () => {
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return json({}, 403); }) as typeof fetch;
  const w = await backend().write('errors/a.json', '{}');
  assert.equal(calls, 1);
  assert.equal((w as { reason: string }).reason, 'forbidden');
});

test('retryAfterMs: seconds from the header, capped; without header a growing backoff', () => {
  const r = (h?: string) => new Response(null, { status: 429, headers: h ? { 'Retry-After': h } : {} });
  assert.equal(retryAfterMs(r('2'), 0), 2000);
  assert.equal(retryAfterMs(r('3600'), 0), 30_000);
  assert.equal(retryAfterMs(r(), 0), 1000);
  assert.equal(retryAfterMs(r(), 2), 4000);
});
