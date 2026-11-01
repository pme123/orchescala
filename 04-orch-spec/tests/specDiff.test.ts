// The comparison of two spec folders in business terms (src/specDiff.ts) - the report the RE sees
// before the change goes into the code: processes, steps, the data model down to the fields, pages.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { join, resolve } from 'node:path';
import { diffSpecFolders, formatSpecDiff, isEmptyDiff } from '../src/specDiff';
import type { SpecFolder } from '../src/specExport';
import { fsFolder } from '../tools/lib/fsFolder';
import type { ProcessSpec, TypeDef } from '../src/types';

const root = resolve(import.meta.dirname, '..');
const fixture = join(root, 'tests/fixtures/spec-folder');
const base = fsFolder(fixture);
const order = JSON.parse(base.read('processes/order.json')!) as ProcessSpec;

/** The fixture with files replaced (`null` removes one, a new path adds one). */
function folder(files: Record<string, string | null>): SpecFolder {
  const has = (dir: string, name: string) => {
    const p = dir ? `${dir}/${name}` : name;
    return p in files ? files[p] != null : base.read(p) != null;
  };
  return {
    read: p => (p in files ? files[p] : base.read(p)),
    list: dir => [...new Set([...base.list(dir), ...Object.keys(files).filter(p => p.startsWith(dir ? `${dir}/` : '') && !p.slice(dir ? dir.length + 1 : 0).includes('/')).map(p => p.slice(dir ? dir.length + 1 : 0))])]
      .filter(n => has(dir, n)).sort(),
    dirs: dir => base.dirs!(dir),
  };
}

const withOrder = (change: (s: ProcessSpec) => ProcessSpec) => folder({ 'processes/order.json': JSON.stringify(change(structuredClone(order))) });
const typeOf = (s: ProcessSpec, name: string, interactionId?: string) => s.types!.find(t => t.name === name && t.interactionId === interactionId) as TypeDef;
const lines = (before: SpecFolder, after: SpecFolder) => formatSpecDiff(diffSpecFolders(before, after)).trim().split('\n').map(l => l.trim());

test('the same spec: nothing changed', () => {
  const d = diffSpecFolders(base, base);
  assert.ok(isEmptyDiff(d));
  assert.equal(formatSpecDiff(d), 'Keine Änderungen in der Spezifikation.\n');
});

test('the time stamps and comments of a process are no change', () => {
  assert.ok(isEmptyDiff(diffSpecFolders(base, withOrder(s => ({ ...s, updatedAt: '2030-01-01', comments: [] })))));
});

test('the data model down to the fields: type, optional, new, removed', () => {
  const after = withOrder(s => {
    const inT = typeOf(s, 'In');
    inT.fields = inT.fields!.map(f => (f.name === 'orderId' ? { ...f, type: 'String' } : f.name === 'amount' ? { ...f, optional: false } : f))
      .filter(f => f.name !== 'customer');
    inT.fields.push({ id: 'f-note', name: 'note', type: 'String', optional: true });
    return s;
  });
  const d = diffSpecFolders(base, after);
  assert.equal(d.processes.length, 1);
  assert.equal(d.processes[0].op, 'change');
  assert.deepEqual(d.processes[0].steps, []);
  assert.deepEqual(lines(base, after).slice(1), [
    'Datenmodell',
    '- In.customer (Customer)',
    '~ In.orderId · Typ: Long → String',
    '~ In.amount · optional: ja → nein',
    '+ In.note (String)',
  ]);
});

test('enum cases and the shared fields of an ADT', () => {
  const after = withOrder(s => {
    const seg = typeOf(s, 'Segment');
    seg.values = [{ name: 'Retail' }, { name: 'Private', fields: [{ id: 'f-advisor', name: 'advisor', type: 'String' }] }, { name: 'Corporate' }];
    seg.fields = [{ id: 'f-since', name: 'since', type: 'LocalDate' }];
    return s;
  });
  assert.deepEqual(lines(base, after).slice(1), [
    'Datenmodell',
    '+ Segment.since (LocalDate)',
    '+ Segment.Private.advisor (String)',
    '+ Segment.Corporate',
  ]);
});

test('steps: new, removed, changed - and an interaction type by its name', () => {
  const after = withOrder(s => {
    s.steps = s.steps.filter(x => x.id !== 'ApproveOrderUT').map(x => (x.id === 'CheckOrderTask' ? { ...x, name: 'check the order' } : x));
    s.steps.splice(2, 0, { id: 'NotifyTask', kind: 'service', name: 'notify', status: 'draft' });
    typeOf(s, 'Out', 'ia-check').fields!.push({ id: 'f-c-reason', name: 'reason', type: 'String', optional: true });
    return s;
  });
  assert.deepEqual(lines(base, after).slice(1), [
    'Schritte',
    '- Benutzeraufgabe approve order',
    '~ Service check the order · Name: check order → check the order',
    '+ Service notify',
    'Datenmodell',
    '+ CheckOrder.Out.reason (String)',
  ]);
});

test('a new and a removed process, the diagram, a DMN table and another file', () => {
  const copy = { ...order, slug: 'other', title: 'Other', processId: 'acme-demo-otherV1' };
  const after = folder({
    'processes/order.json': null,
    'processes/order.bpmn': null,
    'processes/other.json': JSON.stringify(copy),
    'config/model.json': '{"services":[{"id":"x"}]}',
  });
  const d = diffSpecFolders(base, after);
  assert.deepEqual(d.processes.map(p => `${p.slug} ${p.op} ${p.diagram ?? ''}`.trim()), ['order remove remove', 'other add']);
  assert.deepEqual(d.files, [{ path: 'config/model.json', op: 'change' }]);
  const layout = folder({ 'processes/order.bpmn': base.read('processes/order.bpmn')!.replace('x="100"', 'x="120"'), 'processes/order/acme-demo-rules.dmn': '<definitions/>' });
  const l = diffSpecFolders(base, layout).processes[0];
  assert.equal(l.diagram, 'change');
  assert.deepEqual(l.dmns, [{ key: 'acme-demo-rules', op: 'add' }]);
});

test('pages: new, changed block by block', () => {
  const page = { path: '/book', title: 'Termin buchen', access: 'public', body: [{ id: 'b1', type: 'text', text: 'Hallo' }] };
  const added = folder({ 'pages/book.json': JSON.stringify(page) });
  assert.deepEqual(diffSpecFolders(base, added).pages.map(p => `${p.file} ${p.op}`), ['pages/book.json add']);
  const changed = folder({ 'pages/book.json': JSON.stringify({ ...page, body: [{ id: 'b1', type: 'text', text: 'Grüezi' }] }) });
  const [p] = diffSpecFolders(added, changed).pages;
  assert.equal(p.op, 'change');
  assert.deepEqual(p.changes.map(c => `${c.field}: ${c.before} → ${c.after}`), ['Text: Hallo → Grüezi']);
});

test('the tool: text, or the structure with --json; a missing «before» is an empty spec', () => {
  const run = (...args: string[]) => spawnSync(process.execPath, [join(root, 'tools/spec2diff.ts'), ...args], { encoding: 'utf8', timeout: 20_000 });
  const same = run(fixture, fixture);
  assert.equal(same.status, 0, same.stderr);
  assert.equal(same.stdout, 'Keine Änderungen in der Spezifikation.\n');
  const fresh = run(join(fixture, 'missing'), fixture, '--json');
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.deepEqual(JSON.parse(fresh.stdout).processes.map((p: { op: string }) => p.op), ['add']);
});
