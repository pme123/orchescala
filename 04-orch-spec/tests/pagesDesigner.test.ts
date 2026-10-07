// The designer of the pages: what a page can call, sample data, the block tree and the checks.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  blockAt, flatten, insertBlock, moveBlock, newBlock, pageFindings, parseScalaType, removeBlock, sampleOf,
  slugOf, statePaths, targetsOf, updateBlock,
} from '../src/pages/designer/model';
import type { Model, ProcessSpec } from '../src/types';
import type { Component, Page } from '../src/pages/runtime/spec';

const pkg = 'acme.shop.domain';
const model = {
  version: 1,
  services: [],
  domainTypes: [
    { id: `${pkg}.FreeSlots.In`, name: 'FreeSlots.In', pkg, kind: 'member', importPath: '', topicName: 'acme-shop-freeSlots', dsl: 'CustomTask',
      fields: [{ name: 'topic', type: 'Topic' }, { name: 'days', type: 'Int' }, { name: 'from', type: 'Option[LocalDate]' }] },
    { id: `${pkg}.FreeSlots.Out`, name: 'FreeSlots.Out', pkg, kind: 'member', importPath: '', topicName: 'acme-shop-freeSlots', dsl: 'CustomTask',
      fields: [{ name: 'slots', type: 'Seq[Slot]' }] },
    { id: `${pkg}.Slot`, name: 'Slot', pkg, kind: 'case', importPath: '',
      fields: [{ name: 'start', type: 'LocalDateTime' }, { name: 'end', type: 'LocalDateTime' }, { name: 'advisorName', type: 'String' }, { name: 'topic', type: 'Topic' }] },
    { id: `${pkg}.Topic`, name: 'Topic', pkg, kind: 'enum', importPath: '', values: ['advice', 'mortgage'] },
    // a worker of a process - runs in it, not offered to pages
    { id: `${pkg}.Assign.In`, name: 'Assign.In', pkg, kind: 'member', importPath: '', topicName: 'acme-shop-bookV1-Assign', dsl: 'CustomTask', fields: [] },
  ],
} as unknown as Model;

const spec = {
  slug: 'acme-shop-bookv1', title: 'Buchen', processId: 'acme-shop-bookV1', steps: [],
  types: [
    { id: 't-in', name: 'In', kind: 'case', root: true, fields: [{ id: 'f1', name: 'token', type: 'String' }] },
    { id: 't-me', name: 'VerifiedME.In', kind: 'case', fields: [] },
    { id: 't-ut-out', name: 'ConfirmUT.Out', kind: 'case', fields: [{ id: 'f2', name: 'accepted', type: 'Boolean' }] },
  ],
  interactions: [
    { id: 'i1', stepId: 's1', kind: 'message', name: 'VerifiedME', key: 'acme-shop-bookV1-verified', inTypeId: 't-me' },
    { id: 'i2', stepId: 'ConfirmTask', kind: 'userTask', name: 'ConfirmUT', key: 'ConfirmTask', outTypeId: 't-ut-out' },
  ],
} as unknown as ProcessSpec;

const targets = targetsOf(model, [spec]);

const page: Page = {
  path: 'shop/book',
  title: 'Buchen',
  access: 'public',
  state: { step: 'choose', topic: 'advice' },
  load: [{ do: 'call', service: 'acme-shop-freeSlots', public: true, input: { topic: '{{topic}}', days: 7 }, result: 'slots' }],
  body: [
    { type: 'heading', text: 'Termin' },
    { type: 'section', label: 'Wahl', body: [
      { type: 'pick', bind: 'slot', items: 'slots.slots', itemLabel: '{{start|time}}' },
      { type: 'text', text: 'Gewählt: {{slot.start|datetime}}' },
    ] },
    { type: 'button', label: 'Buchen', actions: [{ do: 'start', process: 'acme-shop-bookV1', public: true, businessKey: '{{query.token}}' }] },
  ],
};

test('parseScalaType - Option, Seq and Iron (also inside)', () => {
  assert.deepEqual(parseScalaType('Option[Seq[Slot]]'), { base: 'Slot', qualified: 'Slot', optional: true, collection: true });
  assert.deepEqual(parseScalaType('String :| ValidEmail'), { base: 'String', qualified: 'String', optional: false, collection: false });
  assert.deepEqual(parseScalaType('Option[Seq[String :| ValidEmail]]'), { base: 'String', qualified: 'String', optional: true, collection: true });
  assert.deepEqual(parseScalaType('schema.Topic'), { base: 'Topic', qualified: 'schema.Topic', optional: false, collection: false });
});

test('targetsOf - a qualified type from another package, an aliased Out', () => {
  const other = 'acme.crm.domain';
  const m = {
    version: 1, services: [],
    domainTypes: [
      { id: `${pkg}.Lookup.In`, name: 'Lookup.In', pkg, kind: 'member', importPath: '', topicName: 'acme-shop-lookup', dsl: 'CustomTask', fields: [] },
      // type Out = Other.Out
      { id: `${pkg}.Lookup.Out`, name: 'Lookup.Out', pkg, kind: 'alias', importPath: '', topicName: 'acme-shop-lookup', dsl: 'CustomTask', target: 'Other.Out' },
      { id: `${other}.Other.Out`, name: 'Other.Out', pkg: other, kind: 'member', importPath: '',
        fields: [{ name: 'local', type: 'Customer' }, { name: 'crm', type: `${other}.Customer` }] },
      { id: `${pkg}.Customer`, name: 'Customer', pkg, kind: 'case', importPath: '', fields: [{ name: 'shopId', type: 'String' }] },
      { id: `${other}.Customer`, name: 'Customer', pkg: other, kind: 'case', importPath: '', fields: [{ name: 'crmId', type: 'String' }] },
    ],
  } as unknown as Model;
  const out = targetsOf(m, []).services.find((s) => s.topic === 'acme-shop-lookup')!.out;
  assert.deepEqual(out.map((f) => f.name), ['local', 'crm']); // through the alias
  assert.deepEqual(out[1].fields?.map((f) => f.name), ['crmId']); // the qualified one, not the local
  assert.deepEqual(out[0].fields?.map((f) => f.name), ['crmId']); // unqualified: the package of Other.Out
});

test('targetsOf - the workers of the domain with their fields, the processes, messages and tasks', () => {
  assert.deepEqual(targets.services.map((s) => s.topic), ['acme-shop-freeSlots']); // not the worker of the process
  const free = targets.services[0];
  assert.deepEqual(free.in.map((f) => [f.name, f.type, f.optional]), [['topic', 'Topic', false], ['days', 'Int', false], ['from', 'LocalDate', true]]);
  assert.deepEqual(free.in[0].values, ['advice', 'mortgage']);
  const slots = free.out[0];
  assert.equal(slots.collection, true);
  assert.deepEqual(slots.fields?.map((f) => f.name), ['start', 'end', 'advisorName', 'topic']);
  assert.deepEqual(targets.processes.map((p) => [p.key, p.in.map((f) => f.name)]), [['acme-shop-bookV1', ['token']]]);
  assert.deepEqual(targets.messages.map((m) => m.name), ['acme-shop-bookV1-verified']);
  assert.deepEqual(targets.userTasks.map((t) => [t.key, t.out.map((f) => f.name)]), [['ConfirmTask', ['accepted']]]);
});

test('sampleOf - three items per list, enum values, dates in the future, start before end', () => {
  const sample = sampleOf(targets.services[0].out) as { slots: { start: string; end: string; topic: string; advisorName: string }[] };
  assert.equal(sample.slots.length, 3);
  assert.equal(sample.slots[0].topic, 'advice');
  assert.equal(sample.slots[1].topic, 'mortgage');
  assert.match(sample.slots[0].start, /^\d{4}-\d{2}-\d{2}T09:00$/);
  assert.match(sample.slots[0].end, /^\d{4}-\d{2}-\d{2}T10:00$/);
  assert.ok(new Date(sample.slots[0].start) > new Date());
  assert.equal(typeof sample.slots[0].advisorName, 'string');
});

test('the block tree - find, insert, move, remove, update, flatten', () => {
  const body = page.body;
  assert.equal(blockAt(body, '1.0')?.type, 'pick');
  assert.deepEqual(flatten(body).map((f) => [f.key, f.depth]), [['0', 0], ['1', 0], ['1.0', 1], ['1.1', 1], ['2', 0]]);

  const inserted = insertBlock(body, newBlock('loading'), '1.0');
  assert.equal(inserted.key, '1.1');
  assert.equal(blockAt(inserted.body, '1.1')?.type, 'loading');
  assert.equal(blockAt(inserted.body, '1.2')?.type, 'text');

  const into = insertBlock(body, newBlock('text'), '1', true);
  assert.equal(into.key, '1.2');
  const atEnd = insertBlock(body, newBlock('text'));
  assert.equal(atEnd.key, '3');

  const moved = moveBlock(body, '1.1', -1);
  assert.equal(moved.key, '1.0');
  assert.equal(blockAt(moved.body, '1.0')?.type, 'text');
  assert.equal(moveBlock(body, '0', -1).key, '0'); // already first

  const removed = removeBlock(body, '1.0');
  assert.equal((blockAt(removed, '1') as Extract<Component, { type: 'section' }>).body.length, 1);

  const updated = updateBlock(body, '0', (b) => ({ ...b, text: 'Neu' }) as Component);
  assert.equal((blockAt(updated, '0') as { text: string }).text, 'Neu');
  assert.equal((blockAt(body, '0') as { text: string }).text, 'Termin'); // unchanged
});

test('statePaths - the state, the results with the fields of the service, the binds', () => {
  const paths = statePaths(page, targets);
  for (const p of ['step', 'topic', 'slots', 'slots.slots', 'slots.slots.0.start', 'slot', 'query', 'user.name']) assert.ok(paths.includes(p), p);
});

test('pageFindings - a page that fits: only the hints for the gateway', () => {
  const findings = pageFindings(page, targets);
  assert.deepEqual(findings.filter((f) => f.level !== 'info'), []);
  assert.ok(findings.some((f) => f.message.includes('PUBLIC_WORKERS')));
  assert.ok(findings.some((f) => f.message.includes('PUBLIC_PROCESSES')));
});

test('pageFindings - what does not fit', () => {
  const bad: Page = {
    ...page,
    title: '',
    load: [{ do: 'call', service: 'acme-shop-unknown', result: 'x' }],
    body: [
      { type: 'pick', bind: 'slot', items: 'nothing.here', itemLabel: '{{start}}', visible: 'step == sent' },
      { type: 'text', text: '{{missing.value}}' },
      { type: 'button', label: 'OK', actions: [
        { do: 'message', name: 'acme-shop-other', businessKey: '{{query.token}}' },
        { do: 'completeTask', taskKey: 'NoTask', taskId: '{{task.id}}' },
      ] },
    ],
  };
  const messages = pageFindings(bad, targets, [page, bad]).map((f) => `${f.level}: ${f.message}`);
  const has = (text: string) => assert.ok(messages.some((m) => m.includes(text)), `${text} in ${messages.join(' | ')}`);
  has('error: Die Seite hat keinen Titel');
  has('error: Den Pfad «shop/book» hat noch eine andere Seite');
  has('warning: Laden: den Service «acme-shop-unknown»');
  has('warning: Die Liste «nothing.here»');
  has('warning: «{{missing.value}}»');
  has('die Message «acme-shop-other»');
  has('den Benutzer-Task «NoTask»');
  has('error: Button «OK»: einen Task abschliessen geht nur mit Login');
  has("warning: Sichtbar, wenn «step == sent»: «sent» – ein Text braucht Anführungszeichen");
});

test('slugOf', () => {
  assert.equal(slugOf('appointments/book'), 'book');
  assert.equal(slugOf('Termin Buchen'), 'termin-buchen');
});
