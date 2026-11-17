// Copy and paste between two places of Orch Spec: the text carries the item and what of the model it
// uses; pasting plans new or overwrite, takes along what the model lacks and says what else is missing.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planPaste, readTransfer, transferOf, transferText, usedBy, withPasted, type Transfer } from '../src/transfer';
import { newCollection } from '../src/services/collection';
import type { Model, PatternDef, ProcessSpec, TypeMapper } from '../src/types';
import type { ServiceCollectionSpec } from '../src/services/types';

const mapper: TypeMapper = { id: 'tm-country', from: 'Int', to: 'String', kind: 'table', name: 'Country', cases: [{ from: '756', to: 'CH' }] };
const other: TypeMapper = { id: 'tm-other', from: 'Long', to: 'String', kind: 'scala', scala: 'x.toString' };
const pattern = { id: 'p-mail', name: 'Mail', targets: [] } as unknown as PatternDef;
const builtin = { id: 'p-once', name: 'Einmal', builtin: true } as unknown as PatternDef;
const model = { version: 1, services: [], typeMappers: [mapper, other], patterns: [pattern, builtin] } as unknown as Model;

const spec = (): ProcessSpec => ({
  slug: 'acme-crm-clientv1-mapclient', title: 'Kunde mappen', processId: 'acme-crm-clientV1-MapClient', status: 'draft',
  patterns: [{ id: 'p-once' }],
  steps: [
    { id: 'Get', kind: 'service', name: 'Kunde lesen', status: 'draft', topic: 'acme-crm-clientV1.GetClient' },
    { id: 'Map', kind: 'script', name: 'Map', status: 'draft', patterns: [{ id: 'p-mail' }],
      fieldMapping: { in: [], out: [], fields: [{ field: 'out.country', from: ['in.code'], mapper: 'tm-country' }] } },
  ],
} as unknown as ProcessSpec);
const collection = (): ServiceCollectionSpec => ({
  ...newCollection({ title: 'Client', project: 'acme-crm', api: 'client', apiVersion: 1 }),
  services: [{ id: 'get', name: 'GetClient', api: 'client', apiVersion: 1, status: 'implemented', method: 'GET', path: '/clients', params: [] } as never],
});

test('copied: the items and what of the model they use - the type mappers of their lines, the patterns but the built-in ones', () => {
  const s = spec();
  assert.deepEqual([...usedBy(s).mappers], ['tm-country']);
  assert.deepEqual([...usedBy(s).patterns].sort(), ['p-mail', 'p-once']);
  const t = transferOf([{ kind: 'process', slug: s.slug, spec: s, bpmn: '<bpmn/>', dmns: { decide: '<dmn/>' } }], model, '2026-11-17T08:00:00Z');
  assert.deepEqual(t.typeMappers, [mapper]);
  assert.deepEqual(t.patterns, [pattern]);
  // the text read back is the same
  assert.deepEqual(readTransfer(transferText(t)), t);
});

test('pasted text that is none: said, nothing planned', () => {
  assert.deepEqual(readTransfer('hello'), { error: 'Das ist kein kopierter Inhalt von Orch Spec (kein JSON).' });
  assert.deepEqual(readTransfer('{"a":1}'), { error: 'Das ist kein kopierter Inhalt von Orch Spec.' });
  assert.deepEqual(readTransfer(JSON.stringify({ kind: 'orch-spec-transfer', v: 2, items: [] })), { error: 'Version 2 kennt diese App nicht - zuerst die App aktualisieren.' });
  assert.deepEqual(readTransfer(JSON.stringify({ kind: 'orch-spec-transfer', v: 1, items: [{ kind: 'process', slug: 'x', spec: {} }] })), { error: '«x» ist unvollständig - nicht eingefügt.' });
});

test('pasting: new is created, one already there overwritten; what the model lacks comes along, what differs stays and is said', () => {
  const s = spec();
  const t = transferOf([{ kind: 'process', slug: s.slug, spec: s }, { kind: 'collection', slug: 'acme-crm-client', spec: collection() }], model) as Transfer;
  const target = { version: 1, services: [], typeMappers: [{ ...mapper, cases: [] }], patterns: [] } as unknown as Model;
  const plan = planPaste(t, { processes: new Map([[s.slug, { updatedAt: '2026-11-01', version: 'v1' }]]), collections: new Map() }, target, new Set());
  assert.deepEqual(plan.rows.map(r => [r.item.slug, r.action]), [[s.slug, 'overwrite'], ['acme-crm-client', 'create']]);
  assert.deepEqual(plan.typeMappers, []);
  assert.deepEqual(plan.differing, ['Typ-Mapper Country']);
  assert.deepEqual(plan.patterns, [pattern]);
  // the service its step calls comes with the pasted collection - nothing to say
  assert.deepEqual(plan.hints, []);
  const merged = withPasted(target, plan);
  assert.deepEqual(merged.patterns, [pattern]);
  assert.deepEqual(merged.typeMappers, target.typeMappers);
});

test('pasting a process that calls a service the target does not have: said', () => {
  const s = spec();
  const plan = planPaste(transferOf([{ kind: 'process', slug: s.slug, spec: s }], model), { processes: new Map(), collections: new Map() }, null, new Set());
  assert.deepEqual(plan.hints, ['«Kunde mappen» ruft auf, was es hier nicht gibt: acme-crm-clientV1.GetClient - die Collection auch kopieren oder den Katalog neu aufbauen.']);
  assert.deepEqual(plan.typeMappers, [mapper]);
});

test('pasted text from outside: a slug that is no file name, a DMN without a name, an incomplete mapper or pattern - refused', () => {
  const s = spec();
  const t = transferOf([{ kind: 'process', slug: s.slug, spec: s }], model);
  const text = (f: (x: Transfer) => unknown) => { const c = JSON.parse(transferText(t)); f(c); return JSON.stringify(c); };
  assert.deepEqual(readTransfer(text(x => { (x.items[0] as { slug: string }).slug = '../model'; })), { error: '«../model» ist kein Name, wie ihn Orch Spec schreibt - nicht eingefügt.' });
  // the slug of its spec - not another one
  assert.deepEqual(readTransfer(text(x => { (x.items[0] as { slug: string }).slug = 'other'; })), { error: '«other» ist kein Name, wie ihn Orch Spec schreibt - nicht eingefügt.' });
  assert.deepEqual(readTransfer(text(x => { (x.items[0] as { dmns: Record<string, string> }).dmns = { '../x': '<dmn/>' }; })), { error: `«${s.slug}»: eine DMN-Tabelle hat keinen gültigen Namen - nicht eingefügt.` });
  assert.deepEqual(readTransfer(text(x => { x.typeMappers = [{ id: 'x' } as TypeMapper]; })), { error: 'Ein mitkopierter Typ-Mapper ist unvollständig - nicht eingefügt.' });
  assert.deepEqual(readTransfer(text(x => { x.patterns = [{ id: 7 } as unknown as PatternDef]; })), { error: 'Ein mitkopiertes Pattern ist unvollständig - nicht eingefügt.' });
});

test('pasted text from outside: where a collection keeps its OpenAPI is never taken from it; an incomplete OpenAPI or flow is refused', () => {
  const c = { ...collection(), source: { file: 'api.yml', stored: '../config/model.json' } };
  const t = transferOf([{ kind: 'collection', slug: c.slug, spec: c, openApi: { doc: {}, file: 'api.yml', text: 'openapi: 3.0.0' } }], model);
  const read = readTransfer(transferText(t));
  assert.ok(!('error' in read));
  assert.equal((read as Transfer).items[0].kind === 'collection' && (read as Transfer).items[0].spec.source?.stored, undefined);
  const text = (f: (x: Transfer) => unknown) => { const x = JSON.parse(transferText(t)); f(x); return JSON.stringify(x); };
  assert.deepEqual(readTransfer(text(x => { (x.items[0] as { openApi: unknown }).openApi = { file: 7 }; })), { error: `«${c.slug}»: die OpenAPI ist unvollständig - nicht eingefügt.` });
  const s = spec();
  const p = JSON.parse(transferText(transferOf([{ kind: 'process', slug: s.slug, spec: s }], model)));
  p.items[0].spec.steps[0].branches = [{ steps: 'x' }];
  assert.deepEqual(readTransfer(JSON.stringify(p)), { error: `«${s.slug}»: der Ablauf ist unvollständig - nicht eingefügt.` });
});

test('pasted DMN tables that are no table list: null or an array - refused, no crash', () => {
  const s = spec();
  for (const dmns of [null, ['<dmn/>']]) {
    const p = JSON.parse(transferText(transferOf([{ kind: 'process', slug: s.slug, spec: s }], model)));
    p.items[0].dmns = dmns;
    assert.deepEqual(readTransfer(JSON.stringify(p)), { error: `«${s.slug}»: eine DMN-Tabelle hat keinen gültigen Namen - nicht eingefügt.` }, JSON.stringify(dmns));
  }
});

test('pasted twice the same: refused; a process and a collection of the same name are two; a mapper in another key order is the same', () => {
  const s = spec();
  const one = transferOf([{ kind: 'process', slug: s.slug, spec: s }], model);
  assert.deepEqual(readTransfer(transferText({ ...one, items: [...one.items, ...one.items] })), { error: `«${s.slug}» ist zweimal darin - nicht eingefügt.` });
  const c = { ...collection(), slug: s.slug };
  assert.ok(!('error' in readTransfer(transferText({ ...one, items: [...one.items, { kind: 'collection', slug: s.slug, spec: c }] }))));
  // the same mapper, its keys in another order: no difference
  const reordered = Object.fromEntries(Object.entries(mapper).reverse()) as TypeMapper;
  const plan = planPaste(transferOf([{ kind: 'process', slug: s.slug, spec: s }], model), { processes: new Map(), collections: new Map() }, { ...model, typeMappers: [reordered] } as Model);
  assert.deepEqual(plan.differing, []);
});
