// A copied class into an In/Out that cannot be removed and pasted anew.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { replaceType } from '../src/copyPaste.ts';
import type { ProcessSpec, TypeDef } from '../src/types.ts';

const target: TypeDef = { id: 't-in', name: 'In', kind: 'case', status: 'ready', interactionId: 's1', fields: [{ id: 'old', name: 'old', type: 'String' }] };
const spec = { slug: 's', types: [target] } as unknown as ProcessSpec;

// the copy: an ADT whose case refers to a class of its own
const clip = {
  typeId: 'c-root',
  types: [
    { id: 'c-root', name: 'ReadIn', kind: 'enum', root: true, description: 'Lesen', fields: [{ id: 'r', name: 'readFromFcs', type: 'Boolean', optional: true }],
      values: [{ name: 'ByKey', fields: [{ id: 'k', name: 'key', type: 'c-key' }] }, { name: 'Standard' }] },
    { id: 'c-key', name: 'Key', kind: 'case', fields: [{ id: 'v', name: 'value', type: 'String' }] },
  ] as TypeDef[],
};

test('replaceType: the In keeps ID, name, status and role, takes the content of the copy', () => {
  const types = replaceType(spec, 't-in', clip)!;
  const t = types.find(x => x.id === 't-in')!;
  assert.equal(t.name, 'In');
  assert.equal(t.status, 'ready');
  assert.equal(t.interactionId, 's1');
  assert.equal(t.kind, 'enum');
  assert.equal(t.description, 'Lesen');
  assert.equal(t.root, undefined);
  assert.deepEqual(t.fields?.map(f => f.name), ['readFromFcs']);
  assert.deepEqual(t.values?.map(v => v.name), ['ByKey', 'Standard']);
  // the class it refers to comes as a copy - the case points to it
  const key = types.find(x => x.name === 'Key')!;
  assert.notEqual(key.id, 'c-key');
  assert.equal(t.values![0].fields![0].type, key.id);
  // the copy of the root itself is not added
  assert.equal(types.filter(x => x.name === 'ReadIn').length, 0);
  assert.equal(types.length, 2);
});

test('replaceType: a class instead of an ADT - no cases left; an unknown target is null', () => {
  const asAdt = replaceType(spec, 't-in', clip)!;
  const back = replaceType({ ...spec, types: asAdt }, 't-in', { typeId: 'c-key', types: [clip.types[1]] })!;
  const t = back.find(x => x.id === 't-in')!;
  assert.equal(t.kind, 'case');
  assert.equal(t.values, undefined);
  assert.deepEqual(t.fields?.map(f => f.name), ['value']);
  assert.equal(replaceType(spec, 'nope', clip), null);
});
