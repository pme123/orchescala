// The shape of a page file and the name of a page - checked when read (designer) and when built.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appProblem, pageProblem, pageSlugProblem } from '../src/pages/runtime/validate';

const page = {
  path: 'shop/book', title: 'Buchen', access: 'public', state: {},
  load: [{ do: 'call', service: 'acme-shop-freeSlots', onError: [{ do: 'set', path: 'step', value: 'error' }] }],
  body: [
    { type: 'heading', text: 'Termin' },
    { type: 'section', body: [{ type: 'fields', fields: [{ bind: 'email', label: 'E-Mail' }] }] },
    { type: 'button', label: 'OK', actions: [] },
  ],
};

test('pageSlugProblem - a file name, not a path, not the settings of the app', () => {
  assert.equal(pageSlugProblem('book'), null);
  assert.equal(pageSlugProblem('termin-buchen-2'), null);
  for (const bad of ['app', '../x', 'a/b', 'Book', '', '-x', 'x.json']) assert.ok(pageSlugProblem(bad), bad);
});

test('pageProblem - a page the renderer can show', () => {
  assert.equal(pageProblem(page), null);
  assert.equal(pageProblem({ ...page, access: { roles: ['kundenberater'] } }), null);
});

test('pageProblem - what the renderer would trip over', () => {
  const has = (raw: unknown, text: string) => assert.match(pageProblem(raw) ?? '', new RegExp(text), JSON.stringify(raw));
  has(null, 'kein Objekt');
  has([], 'kein Objekt');
  has({ ...page, body: undefined }, '«body» ist keine Liste');
  has({ ...page, title: 1 }, '«title» fehlt');
  has({ ...page, access: 'everyone' }, '«access»');
  has({ ...page, body: [{ type: 'video' }] }, 'body\\[0\\]: unbekannter Baustein «video»');
  has({ ...page, body: [{ type: 'section', body: [{ type: 'nope' }] }] }, 'body\\[0\\]\\.body\\[0\\]: unbekannter Baustein');
  has({ ...page, body: [{ type: 'button', label: 'OK' }] }, 'actions» ist keine Liste');
  has({ ...page, body: [{ type: 'fields', fields: 'email' }] }, 'fields» ist keine Liste');
  has({ ...page, load: [{ do: 'call', onError: [{ do: 'launch' }] }] }, 'load\\[0\\]\\.onError\\[0\\]: unbekannte Aktion «launch»');
});

test('appProblem', () => {
  assert.equal(appProblem({}), null);
  assert.equal(appProblem({ title: 'Kundentermine', home: 'appointments/book', labels: { topic: { advice: 'Beratung' } } }), null);
  assert.ok(appProblem([]));
  assert.ok(appProblem({ title: 1 }));
  assert.ok(appProblem({ labels: { topic: 'Beratung' } }));
});
