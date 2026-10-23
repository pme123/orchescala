// Pages like processes: stable IDs of the building blocks, comments at the page and its blocks.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyBlock, convertBlock, flatten, hasIds, keyOfId, logBase, newBlock, relocateBlock, withIds } from '../src/pages/designer/model';
import type { Component, Page } from '../src/pages/runtime/spec';
import { addThread, countIndex, setResolved } from '../src/comments';
import { auditPath, createdPageEntry, deleteAudit, diffPages, entryOf } from '../src/audit';
import { blockOfTarget, blockTarget, carryComments, cleanSpec, keepComments, pageCommentTargets, pageTarget, rememberPagePlaces } from '../src/pages/designer/pageComments';

const body: Component[] = [
  { type: 'heading', text: 'Termin' },
  { type: 'section', label: 'Kontakt', id: 'b-sec', body: [{ type: 'fields', fields: [] }, { type: 'text', text: 'x', id: 'b-sec' }] },
];

test('withIds - every building block an ID of its own; existing ones stay, duplicates get a new one', () => {
  assert.equal(hasIds(body), false);
  const fixed = withIds(body);
  assert.equal(hasIds(fixed), true);
  const ids = flatten(fixed).map(({ block }) => block.id!);
  assert.equal(ids[1], 'b-sec'); // the section keeps its ID
  assert.notEqual(ids[3], 'b-sec'); // the text inside had the same - it gets a new one
  assert.equal(new Set(ids).size, 4);
  assert.deepEqual(withIds(fixed), fixed); // nothing to do: the same IDs
  assert.equal(body[0].id, undefined); // the input stays untouched
});

test('withIds - a hand-edited page: a section without a list, a value that is no object - no crash, it stays', () => {
  const odd = [{ type: 'text', text: 'A' }, { type: 'section', title: 'S' }, 'nonsense'] as unknown as Component[];
  const fixed = withIds(odd);
  assert.equal(fixed.length, 3);
  assert.ok(fixed[0].id && fixed[1].id);
  assert.equal((fixed[1] as { body?: unknown }).body, undefined);
  assert.equal(fixed[2], 'nonsense' as unknown as Component);
  assert.deepEqual(withIds(undefined as unknown as Component[]), []);
});

test('logBase - the first state, and again once the IDs are added (read-only first, then editable)', () => {
  const bare: Page = { path: 'p', title: 'P', access: 'public', body };
  const ided: Page = { ...bare, body: withIds(body) };
  assert.equal(logBase(null, bare), bare);
  assert.equal(logBase(bare, ided), ided); // the IDs came later: compare from the page with IDs
  assert.equal(logBase(ided, { ...ided, title: 'Q' }), ided); // a base with IDs stays until the next cut
  assert.equal(logBase(bare, bare), bare);
  assert.equal(logBase(bare, null), bare);
});

test('newBlock, copyBlock, convertBlock - new ones and copies get new IDs, a conversion keeps it', () => {
  assert.match(newBlock('text').id!, /^b-/);
  const fixed = withIds(body);
  const copy = copyBlock(fixed[1]);
  assert.notEqual(copy.id, fixed[1].id);
  assert.notEqual(copy.type === 'section' && copy.body[0].id, fixed[1].type === 'section' && fixed[1].body[0].id);
  assert.equal(convertBlock({ type: 'text', text: 'Hallo', id: 'b-1' }, 'heading').id, 'b-1');
});

test('keyOfId - the ID finds its building block after it moved', () => {
  const fixed = withIds(body);
  const id = fixed[0].id!;
  const moved = relocateBlock(fixed, '0', '1', 'inside').body;
  assert.equal(keyOfId(moved, id), '0.2');
  assert.equal(keyOfId(moved, 'gone'), undefined);
});

// ---------------------------------------------------------------- comments


const me = { name: 'Anna', email: 'anna@example.ch' };
const page: Page = { path: 'shop/book', title: 'Buchen', access: 'public', body: withIds(body) };

test('pageCommentTargets - the page, then the building blocks in the order of the outline', () => {
  const places = pageCommentTargets(page);
  assert.deepEqual(places.map((p) => [p.key.split(':')[0], p.label]), [
    ['page', 'Seite Buchen'], ['block', 'Überschrift «Termin»'], ['block', 'Abschnitt «Kontakt»'], ['block', 'Eingabefelder'], ['block', 'Text «x»'],
  ]);
  assert.equal(blockOfTarget(blockTarget('b-1')), 'b-1');
  assert.equal(blockOfTarget(pageTarget), null);
});

test('comments on the spec part of a page - the same functions as for a process', () => {
  const id = page.body[0].id!;
  const spec = addThread(page.spec ?? {}, blockTarget(id), me, 'Titel zu lang?');
  assert.equal(spec.comments?.length, 1);
  assert.deepEqual(countIndex(spec).exact.get(blockTarget(id)), { open: 1, resolved: 0 });
  const done = setResolved(spec, spec.comments![0].id, true, 'Anna');
  assert.deepEqual(countIndex(done).exact.get(blockTarget(id)), { open: 0, resolved: 1 });
});

test('rememberPagePlaces, keepComments - a removed block keeps its name; an older state does not bring old comments back', () => {
  const id = page.body[0].id!;
  const withComment: Page = { ...page, spec: addThread({}, blockTarget(id), me, 'Weg damit?') };
  const removed: Page = { ...withComment, body: withComment.body.slice(1) };
  assert.equal(rememberPagePlaces(withComment, removed)?.[0].place, 'Überschrift «Termin»');
  assert.equal(rememberPagePlaces(withComment, withComment), withComment.spec?.comments); // nothing to remember
  // undo to the state before the comment: the comment stays
  assert.equal(keepComments(page, withComment).spec?.comments?.length, 1);
  assert.equal(keepComments(withComment, withComment), withComment);
  assert.equal(cleanSpec({ comments: [], epics: undefined }), undefined);
  assert.deepEqual(cleanSpec({ project: 'acme-shop', comments: [] }), { project: 'acme-shop' });
});

test('carryComments - an undo that removes a commented block: the thread stays and keeps its name', () => {
  const id = page.body[0].id!;
  // the block was added (before: without it), then commented - undo goes back to the state without it
  const before: Page = { ...page, body: page.body.slice(1) };
  const now: Page = { ...page, spec: addThread({}, blockTarget(id), me, 'Passt das?') };
  const undone = carryComments(before, now);
  assert.equal(undone.spec?.comments?.length, 1);
  assert.equal(undone.spec?.comments?.[0].place, 'Überschrift «Termin»');
  // redo brings the block back - the thread is at its place again, the remembered name does no harm
  const redone = carryComments(now, undone);
  assert.equal(redone.spec?.comments?.[0].target, blockTarget(id));
  assert.equal(carryComments(now, now), now); // nothing to do
});

// ---------------------------------------------------------------- the change log

test('diffPages - the page, its building blocks by ID: changed field by field, new, removed, moved; comments do not count', () => {
  const a: Page = { path: 'shop/book', title: 'Buchen', access: 'public', body: withIds(body) };
  const [heading, section] = a.body;
  const moved = relocateBlock(a.body, '0', '1', 'inside').body; // the heading into the section, at its end
  const b: Page = {
    ...a, title: 'Termin buchen', access: { roles: ['advisor'] }, spec: { project: 'acme-shop', epics: ['adr'], comments: addThread({}, pageTarget, me, 'x').comments },
    body: [
      ...moved.map((x) => (x.id === section.id && x.type === 'section' ? { ...x, label: 'Ihre Angaben', body: x.body.filter((y) => y.type !== 'text') } : x)),
      { type: 'button', label: 'Senden', actions: [], id: 'b-new' },
    ],
  };
  const changes = diffPages(a, b);
  const line = (c: (typeof changes)[number]) => [c.op, c.label, c.field ?? '', c.before ?? '', c.after ?? ''].join(' | ');
  assert.deepEqual(changes.map(line), [
    'change | Seite Termin buchen | Titel | Buchen | Termin buchen',
    'change | Seite Termin buchen | Zugang | public | {"roles":["advisor"]}',
    'change | Seite Termin buchen | Projekt |  | acme-shop',
    'change | Seite Termin buchen | Epics |  | ["adr"]',
    'remove | Text «x» |  |  | ',
    'change | Abschnitt «Ihre Angaben» | Bezeichnung | Kontakt | Ihre Angaben',
    'add | Button «Senden» |  |  | ',
    `change | Überschrift «Termin» | Lage | Seite, Stelle 1 | Abschnitt «Ihre Angaben», Stelle 2`,
  ]);
  assert.ok(changes.every((c) => c.target === pageTarget || c.target.startsWith('block:')));
  assert.equal(changes.find((c) => c.label.startsWith('Überschrift'))?.target, blockTarget(heading.id!));
  // only comments: nothing for the log; an entry from the changes
  assert.deepEqual(diffPages(a, { ...a, spec: { comments: addThread({}, pageTarget, me, 'y').comments } }), []);
  const e = entryOf(changes, { source: 'ai', note: 'Mit KI (Claude): «Titel»' }, me);
  assert.equal(e?.source, 'ai');
  assert.equal(e?.changes.length, 8);
  assert.equal(entryOf([], { source: 'manual' }, me), null);
});

test('createdPageEntry - a new page names its building blocks; blocks without an ID are left out, never «block:undefined»', () => {
  const fresh: Page = { path: 'p', title: 'P', access: 'public', body: [{ type: 'heading', text: 'P' }] };
  const bare = createdPageEntry(fresh, me)!;
  assert.ok(bare.changes.every((c) => c.target === pageTarget)); // without IDs: only the page itself
  const ided = { ...fresh, body: withIds(fresh.body) };
  const entry = createdPageEntry(ided, me)!;
  assert.equal(entry.note, 'Seite angelegt');
  assert.ok(entry.changes.some((c) => c.target === blockTarget(ided.body[0].id!) && c.op === 'add'));
});

test('diffPages - a swap of two neighbours names both, a longer move only the moved one', () => {
  const a: Page = { path: 'p', title: 'P', access: 'public', body: withIds([{ type: 'text', text: 'A' }, { type: 'text', text: 'B' }, { type: 'text', text: 'C' }]) };
  const b: Page = { ...a, body: [a.body[0], a.body[2], a.body[1]] };
  assert.deepEqual(diffPages(a, b).map((c) => [c.label, c.before, c.after]), [['Text «C»', 'Seite, Stelle 3', 'Seite, Stelle 2'], ['Text «B»', 'Seite, Stelle 2', 'Seite, Stelle 3']]);
  const far: Page = { ...a, body: [a.body[2], a.body[0], a.body[1]] };
  assert.deepEqual(diffPages(a, far).map((c) => c.label), ['Text «C»']);
});

test('deleteAudit - the log of a deleted page: done, a failure said, an exception caught (the page is gone already)', async () => {
  const asked: string[] = [];
  const ok = { delete: async (path: string) => { asked.push(path); return { ok: true as const }; } };
  assert.deepEqual(await deleteAudit(ok, 'pages', 'book'), { ok: true });
  assert.deepEqual(asked, [auditPath('pages', 'book')]);
  const refused = { delete: async () => ({ ok: false as const, reason: 'forbidden', message: 'Keine Berechtigung.' }) };
  assert.deepEqual(await deleteAudit(refused, 'pages', 'book'), { ok: false, message: 'Keine Berechtigung.' });
  const throws = { delete: async (): Promise<{ ok: true }> => { throw new Error('offline'); } };
  assert.deepEqual(await deleteAudit(throws, 'pages', 'book'), { ok: false, message: 'offline' });
});
