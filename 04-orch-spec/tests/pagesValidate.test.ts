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

test('pageProblem - texts the renderer reads as text', () => {
  const has = (body: unknown[], text: string) => assert.match(pageProblem({ ...page, body }) ?? '', new RegExp(text));
  has([{ type: 'heading', text: 5 }], 'body\\[0\\]\\.text ist kein Text');
  has([{ type: 'text', text: 'a', visible: true }], 'visible ist kein Text');
  has([{ type: 'pick', bind: 'slot', items: ['a'], itemLabel: '{{a}}' }], 'items ist kein Text');
  has([{ type: 'choice', bind: 'topic', options: [{ value: 1, label: 2 }] }], 'options\\[0\\]\\.label ist kein Text');
  has([{ type: 'fields', fields: [{ label: 'E-Mail' }] }], 'fields\\[0\\]\\.bind ist kein Text');
  has([{ type: 'summary', items: [{ label: 'Termin', value: null }] }], 'items\\[0\\]\\.value ist kein Text');
  assert.equal(pageProblem({ ...page, body: [{ type: 'pick', bind: 'slot', items: 'slots', itemLabel: '{{start}}', groupBy: { path: 'start', format: 'day' } }] }), null);
});

test('appProblem', () => {
  assert.equal(appProblem({}), null);
  assert.equal(appProblem({ title: 'Kundentermine', home: 'appointments/book', labels: { topic: { advice: 'Beratung' } } }), null);
  assert.ok(appProblem([]));
  assert.ok(appProblem({ title: 1 }));
  assert.ok(appProblem({ labels: { topic: 'Beratung' } }));
});

test('appProblem - the theme of the app', () => {
  const ok = { title: 'X', theme: { primary: '#0b5cab', background: '#ffffff', text: 'rgb(20, 20, 20)', font: 'sans', radius: 'lg', mode: 'light',
    logo: 'data:image/svg+xml;base64,PHN2Zy8+' } };
  assert.equal(appProblem(ok), null);
  assert.match(appProblem({ theme: { primary: 'blue' } }) ?? '', /theme\.primary/);
  assert.match(appProblem({ theme: { radius: 'huge' } }) ?? '', /theme\.radius/);
  assert.match(appProblem({ theme: { logo: 'https://bank.example/logo.png' } }) ?? '', /data:-URI/);
  assert.match(appProblem({ theme: { font: 'x; } body { display:none' } }) ?? '', /theme\.font/);
});
