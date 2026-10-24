// The address carries view, open error and filters — and survives a round trip.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readRoute, routeHash, type Route } from '../src/route';

const g = globalThis as unknown as { window?: unknown };
const at = (hash: string) => { g.window = { location: { hash } }; return readRoute(); };

const list = { q: '', status: [], process: '', sort: 'updated' as const, archived: false };
const route = (extra: Partial<Route> = {}): Route => ({ view: 'list', id: null, isNew: false, list, ...extra });

test('empty and root hash: the default list', () => {
  assert.deepEqual(at(''), route());
  assert.deepEqual(at('#/'), route());
  assert.equal(routeHash(route()), '#/');
});

test('an MSAL response (#code=…) gives the default route', () => {
  assert.deepEqual(at('#code=abc&state=xyz'), route());
});

test('round trip with error, filters, sort=count and archive', () => {
  const r = route({
    id: 'acme-onboarding--timeout/2',
    list: { q: 'zürich retry', status: ['OFFEN', 'GELÖST'], process: 'acme-onboarding', sort: 'count', archived: true },
  });
  const hash = routeHash(r);
  assert.ok(hash.startsWith('#/e/acme-onboarding--timeout%2F2?'));
  assert.ok(hash.includes('sort=count'));
  assert.ok(/[?&]archiv$/.test(hash), 'archive is a bare flag');
  assert.deepEqual(at(hash), r);
});

test('views: new, howto, admin', () => {
  for (const r of [route({ isNew: true }), route({ view: 'howto' }), route({ view: 'admin' })]) {
    assert.deepEqual(at(routeHash(r)), r);
  }
  assert.equal(routeHash(route({ isNew: true })), '#/neu');
  assert.deepEqual(at('#/?s=OFFEN&p=acme-a'), route({ list: { ...list, status: ['OFFEN'], process: 'acme-a' } }));
});
