// Pages like processes: stable IDs of the building blocks (comments and the change log hang on them).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyBlock, convertBlock, flatten, hasIds, keyOfId, newBlock, relocateBlock, withIds } from '../src/pages/designer/model';
import type { Component } from '../src/pages/runtime/spec';

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
