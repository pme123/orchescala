// The rules of the login without browser and IdP: one renewal for many callers, where to go back.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { safeReturnTo, singleFlight } from '../src/pages/runtime/authRules';

test('singleFlight - concurrent callers share one run, the next starts anew', async () => {
  let runs = 0;
  let release!: (v: string) => void;
  const renew = singleFlight(() => { runs++; return new Promise<string>((r) => { release = r; }); });
  const a = renew();
  const b = renew();
  assert.equal(a, b);
  release('token-1');
  assert.deepEqual(await Promise.all([a, b]), ['token-1', 'token-1']);
  assert.equal(runs, 1);
  const c = renew();
  release('token-2');
  assert.equal(await c, 'token-2');
  assert.equal(runs, 2);
});

test('singleFlight - a failure is shared too, and does not block the next run', async () => {
  let runs = 0;
  const login = singleFlight(async () => { runs++; throw new Error('kein IdP'); });
  const results = await Promise.allSettled([login(), login()]);
  assert.deepEqual(results.map((r) => r.status), ['rejected', 'rejected']);
  await assert.rejects(login(), /kein IdP/);
  assert.equal(runs, 2);
});

test('safeReturnTo - only a path of this page', () => {
  const base = '/app/democompany-customer/';
  assert.equal(safeReturnTo('/app/democompany-customer/appointments/confirm?token=abc', base), '/app/democompany-customer/appointments/confirm?token=abc');
  for (const bad of ['//evil.example/x', '/\\evil.example', 'https://evil.example/', 'javascript:alert(1)', '', undefined, 42, { path: '/' }])
    assert.equal(safeReturnTo(bad, base), base, String(bad));
});
