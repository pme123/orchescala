// The designer of the pages: what a page can call, sample data, the block tree and the checks.
import assert from 'node:assert/strict';
import { COALESCE_MS, emptyHistory, HISTORY_LIMIT, record, travel } from '../src/pages/designer/history';
import { test } from 'node:test';
import {
  blockAt, convertBlock, flatten, insertBlock, moveBlock, newBlock, pageFindings, parseScalaType, placeBlock, relocateBlock,
  dataOf, removeBlock, sampleOf, slugOf, statePaths, targetsOf, unwrapSection, updateBlock, wrapInSection,
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
  assert.ok(findings.some((f) => f.message.includes('PublicAccess.workers')));
  assert.ok(findings.some((f) => f.message.includes('PublicAccess.processStarts')));
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
  has('error: Button «OK»: auf einer öffentlichen Seite braucht der Aufruf «ohne Login»');
});

test('the gateway hints name fields PublicAccess really has', async () => {
  const { readFileSync } = await import('node:fs');
  const scala = readFileSync('../06-gateway/src/main/scala/orchescala/gateway/PublicAccess.scala', 'utf-8');
  for (const field of ['workers', 'processStarts', 'messages']) assert.match(scala, new RegExp(`\\b${field}: Set\\[String\\]`), field);
  const msg: Page = { ...page, body: [{ type: 'button', label: 'OK', actions: [{ do: 'message', name: 'acme-shop-bookV1-verified', public: true, businessKey: '{{query.token}}' }] }] };
  assert.ok(pageFindings(msg, targets).some((f) => f.message.includes('PublicAccess.messages')));
});

test('pageFindings - a message without business key', () => {
  const msg: Page = { ...page, body: [{ type: 'button', label: 'OK', actions: [{ do: 'message', name: 'acme-shop-bookV1-verified', public: true, businessKey: ' ' }] }] };
  assert.ok(pageFindings(msg, targets).some((f) => f.level === 'error' && f.message.includes('braucht einen Business Key')));
});

test('slugOf', () => {
  assert.equal(slugOf('appointments/book'), 'book');
  assert.equal(slugOf('Termin Buchen'), 'termin-buchen');
});

test('placeBlock - before, after, into a section', () => {
  const body = page.body; // 0 heading, 1 section [1.0 pick, 1.1 text], 2 button
  const text = newBlock('text');
  const before = placeBlock(body, text, '1.0', 'before');
  assert.equal(before.key, '1.0');
  assert.equal(blockAt(before.body, '1.1')?.type, 'pick');
  const after = placeBlock(body, text, '2', 'after');
  assert.equal(after.key, '3');
  const inside = placeBlock(body, text, '1', 'inside');
  assert.equal(inside.key, '1.2');
  // inside something that is no section: after it
  assert.equal(placeBlock(body, text, '0', 'inside').key, '1');
});

test('relocateBlock - drag and drop in the outline', () => {
  const body = page.body;
  // down in the same list: the target shifts by one after the removal
  const down = relocateBlock(body, '0', '2', 'after');
  assert.deepEqual(down.body.map((b) => b.type), ['section', 'button', 'heading']);
  assert.equal(down.key, '2');
  // into a section and out again
  const into = relocateBlock(body, '2', '1', 'inside');
  assert.equal(into.key, '1.2');
  assert.equal(blockAt(into.body, '1.2')?.type, 'button');
  const out = relocateBlock(into.body, '1.0', '0', 'before');
  assert.equal(out.key, '0');
  assert.equal(blockAt(out.body, '0')?.type, 'pick');
  assert.equal((blockAt(out.body, '2') as Extract<Component, { type: 'section' }>).body.length, 2);
  // a section into itself or its children: nothing happens
  assert.equal(relocateBlock(body, '1', '1.0', 'before').body, body);
  assert.equal(relocateBlock(body, '1', '1', 'inside').body, body);
  // before a later sibling of a block in a section (the section's index shifts)
  const fromSection = relocateBlock(body, '0', '1.1', 'before');
  assert.equal(fromSection.key, '0.1');
  assert.equal(blockAt(fromSection.body, '0.1')?.type, 'heading');
});

test('wrapInSection and unwrapSection', () => {
  const wrapped = wrapInSection(page.body, '2');
  assert.equal(blockAt(wrapped.body, '2')?.type, 'section');
  assert.equal(blockAt(wrapped.body, '2.0')?.type, 'button');
  const unwrapped = unwrapSection(page.body, '1');
  assert.deepEqual(unwrapped.body.map((b) => b.type), ['heading', 'pick', 'text', 'button']);
  assert.equal(unwrapped.key, '1');
  assert.equal(unwrapSection(page.body, '0').body, page.body); // no section
});

test('convertBlock - the text, the binding and the condition stay', () => {
  const heading = convertBlock({ type: 'text', text: 'Hallo', visible: "step == 'a'" }, 'heading');
  assert.deepEqual(heading, { type: 'heading', text: 'Hallo', visible: "step == 'a'" });
  const button = convertBlock({ type: 'heading', text: 'Weiter' }, 'button');
  assert.equal((button as { label: string }).label, 'Weiter');
  assert.deepEqual((button as { actions: unknown[] }).actions, []);
  const pick = convertBlock({ type: 'choice', bind: 'topic', label: 'Thema', required: true, options: [] }, 'pick');
  assert.equal((pick as { bind: string }).bind, 'topic');
  assert.equal((pick as { label: string }).label, 'Thema');
  assert.equal((pick as { required: boolean }).required, true);
  assert.equal(convertBlock(page.body[0], 'heading'), page.body[0]); // the same type: unchanged
});

test('dataOf - what is in the state of a page and where it comes from', () => {
  const nodes = dataOf(page, targets);
  const at = (path: string) => nodes.find((n) => n.path === path);
  // the result of the load action: the Out of the service, with its list of slots
  const slots = at('slots')!;
  assert.deepEqual(slots.sources, ['Laden: acme-shop-freeSlots']);
  assert.equal(slots.type, 'FreeSlots.Out');
  assert.equal(slots.fields?.[0].name, 'slots');
  assert.equal(slots.fields?.[0].collection, true);
  assert.deepEqual(slots.fields?.[0].fields?.map((f) => f.name), ['start', 'end', 'advisorName', 'topic']);
  // the initial state and a binding on the same path: one entry, both sources
  assert.deepEqual(at('topic')?.sources, ['Anfangszustand']);
  assert.deepEqual(at('slot')?.sources, ['Auswahl aus Liste «slot»']);
  assert.equal(at('slot')?.type, 'ein Eintrag aus slots.slots');
  assert.ok(at('query.token'));
  assert.ok(at('user'));
});

test('placeBlock - the page itself (no block key): at the end of the page, not silently at the start', () => {
  const r = placeBlock(page.body, { type: 'text', text: 'neu' }, '', 'inside');
  assert.equal(r.key, String(page.body.length));
  assert.deepEqual(r.body.map((b) => b.type), [...page.body.map((b) => b.type), 'text']);
  assert.equal(placeBlock(page.body, { type: 'text', text: 'x' }, '', 'before').key, String(page.body.length));
});

test('relocateBlock - into a later sibling\'s child, inside its old parent, to the page', () => {
  const t = (text: string): Component => ({ type: 'text', text });
  const body: Component[] = [
    t('a'),
    { type: 'section', label: 'S', body: [t('s0'), { type: 'section', label: 'Inner', body: [t('i0')] }] },
  ];
  // a (index 0) before i0 (1.1.0) - after the removal the path is 0.1.0
  const deep = relocateBlock(body, '0', '1.1.0', 'before');
  assert.equal(deep.key, '0.1.0');
  assert.equal((blockAt(deep.body, '0.1.0') as { text: string }).text, 'a');
  assert.equal((blockAt(deep.body, '0.1.1') as { text: string }).text, 'i0');
  // s0 «inside» its own section: at its end
  const own = relocateBlock(body, '1.0', '1', 'inside');
  assert.equal(own.key, '1.1');
  assert.deepEqual((blockAt(own.body, '1') as Extract<Component, { type: 'section' }>).body.map((b) => b.type), ['section', 'text']);
  // to the page (''): at its end
  const top = relocateBlock(body, '1.1.0', '', 'inside');
  assert.equal(top.key, '2');
  assert.equal((blockAt(top.body, '2') as { text: string }).text, 'i0');
  assert.deepEqual((blockAt(top.body, '1.1') as Extract<Component, { type: 'section' }>).body, []);
});

test('relocateBlock - the index shifts: into a later sibling section, out to a later place, onto an ancestor', () => {
  const t = (text: string): Component => ({ type: 'text', text });
  const body: Component[] = [t('a'), { type: 'section', label: 'S', body: [t('s0'), t('s1')] }, t('b')];
  // a (0) into the later section (1) - after the removal it is at 0
  const into = relocateBlock(body, '0', '1', 'inside');
  assert.equal(into.key, '0.2');
  assert.deepEqual((into.body[0] as Extract<Component, { type: 'section' }>).body.map((b) => (b as { text: string }).text), ['s0', 's1', 'a']);
  // s0 out of the section, after b (2) - other parent: no shift
  const out = relocateBlock(body, '1.0', '2', 'after');
  assert.equal(out.key, '3');
  assert.deepEqual(out.body.map((b) => (b.type === 'text' ? b.text : b.type)), ['a', 'section', 'b', 's0']);
  // s1 onto its own section (an ancestor) before it - out in front of the section
  const anc = relocateBlock(body, '1.1', '1', 'before');
  assert.equal(anc.key, '1');
  assert.deepEqual(anc.body.map((b) => (b.type === 'text' ? b.text : b.type)), ['a', 's1', 'section', 'b']);
  // a section onto its own child: nothing changes
  assert.equal(relocateBlock(body, '1', '1.0', 'before').body, body);
});

test('unwrapSection - a nested section: its blocks in its place, in the parent section', () => {
  const t = (text: string): Component => ({ type: 'text', text });
  const body: Component[] = [{ type: 'section', label: 'S', body: [t('s0'), { type: 'section', label: 'Inner', body: [t('i0'), t('i1')] }, t('s2')] }];
  const r = unwrapSection(body, '0.1');
  assert.equal(r.key, '0.1');
  assert.deepEqual((r.body[0] as Extract<Component, { type: 'section' }>).body.map((b) => (b as { text: string }).text), ['s0', 'i0', 'i1', 's2']);
  const empty = unwrapSection([{ type: 'section', label: 'S', body: [{ type: 'section', label: 'E', body: [] }] }], '0.0');
  assert.equal(empty.key, '0'); // the parent section is selected
});

test('dataOf - an input field gives text (the inputs deliver strings), an object for a dotted path', () => {
  const form: Page = {
    ...page,
    state: { count: 0 },
    body: [{ type: 'fields', fields: [
      { bind: 'name', label: 'Name' },
      { bind: 'count', label: 'Anzahl' },
      { bind: 'contact.email', label: 'E-Mail', input: 'email' },
    ] }],
  };
  const nodes = dataOf(form, targets);
  const at = (path: string) => nodes.find((n) => n.path === path);
  assert.equal(at('name')?.type, 'Text');
  assert.equal(at('contact')?.type, 'Objekt');
  // the initial state is named first - its type stays, the field is a further source
  assert.equal(at('count')?.type, 'Zahl');
  assert.deepEqual(at('count')?.sources, ['Anfangszustand', 'Eingabefeld «Anzahl»']);
});

test('history - a step per change, typing in one field is one step, redo is gone after a change', () => {
  let h = emptyHistory<string>();
  h = record(h, 'a', undefined, 0); // a -> b
  h = record(h, 'b', 'props:0', 100); // b -> c (typing)
  h = record(h, 'c', 'props:0', 600); // c -> d: the same field within 1 s - the same step
  assert.deepEqual(h.past, ['a', 'b']);
  h = record(h, 'd', 'props:0', 600 + COALESCE_MS); // a pause: a new step
  assert.deepEqual(h.past, ['a', 'b', 'd']);
  h = record(h, 'e', 'props:1', 2700); // another field: a new step
  assert.deepEqual(h.past, ['a', 'b', 'd', 'e']);
  const back = travel(h, 'f', 'undo')!;
  assert.equal(back.value, 'e');
  assert.deepEqual(back.history.future, ['f']);
  assert.equal(back.history.last, null); // typing after an undo is a new step
  const again = travel(back.history, 'e', 'redo')!;
  assert.equal(again.value, 'f');
  assert.deepEqual(again.history.past, ['a', 'b', 'd', 'e']);
  assert.deepEqual(record(back.history, 'e', undefined, 5000).future, []); // a change drops redo
  assert.equal(travel(emptyHistory<string>(), 'x', 'undo'), null);
  assert.equal(travel(emptyHistory<string>(), 'x', 'redo'), null);
  let long = emptyHistory<number>();
  for (let i = 0; i < HISTORY_LIMIT + 20; i++) long = record(long, i, undefined, i * 2000);
  assert.equal(long.past.length, HISTORY_LIMIT);
  assert.equal(long.past[0], 20); // the oldest are gone
});

test('history - typing without a 1 s pause stays one step, however long; a pause starts the next', () => {
  let h = emptyHistory<string>();
  // a keystroke every 400 ms for 10 s - each refreshes the time, so all of it is one step
  for (let i = 0; i < 25; i++) h = record(h, `v${i}`, 'props:0', i * 400);
  assert.deepEqual(h.past, ['v0']);
  h = record(h, 'v25', 'props:0', 24 * 400 + COALESCE_MS); // the pause: a new step
  assert.deepEqual(h.past, ['v0', 'v25']);
});

test('relocateBlock - out of its own section, and into a later section after the shift', () => {
  // 0 heading, 1 section [1.0 pick, 1.1 text], 2 button
  const out = relocateBlock(page.body, '1.0', '1', 'before'); // a child before its own section
  assert.deepEqual(out.body.map((b) => b.type), ['heading', 'pick', 'section', 'button']);
  assert.equal(out.key, '1');
  const two: Component[] = [
    { type: 'text', text: 'a' },
    { type: 'section', label: 'A', body: [] },
    { type: 'section', label: 'B', body: [{ type: 'text', text: 'b' }] },
  ];
  // the text at 0 into section B (index 2) - after the removal B is at 1
  const into = relocateBlock(two, '0', '2', 'inside');
  assert.equal(into.key, '1.1');
  assert.equal((blockAt(into.body, '1') as Extract<Component, { type: 'section' }>).label, 'B');
  assert.equal((blockAt(into.body, '1.1') as { text: string }).text, 'a');
});

test('unwrapSection - an empty section: its parent is selected (the page: no key)', () => {
  const body: Component[] = [{ type: 'heading', text: 'x' }, { type: 'section', label: 'leer', body: [] }];
  const r = unwrapSection(body, '1');
  assert.deepEqual(r.body.map((b) => b.type), ['heading']);
  assert.equal(r.key, '');
  assert.equal(blockAt(r.body, r.key), undefined);
});
