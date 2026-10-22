// Pages like processes: stable IDs of the building blocks, comments at the page and its blocks.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyBlock, convertBlock, flatten, hasIds, keyOfId, newBlock, relocateBlock, withIds } from '../src/pages/designer/model';
import type { Component, Page } from '../src/pages/runtime/spec';
import { addThread, countIndex, setResolved } from '../src/comments';
import { blockOfTarget, blockTarget, cleanSpec, keepComments, pageCommentTargets, pageTarget, rememberPagePlaces } from '../src/pages/designer/pageComments';

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
