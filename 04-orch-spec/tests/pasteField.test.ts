// A copied field pasted: it stays as it is - its name and its type.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pasteField } from '../src/copyPaste.ts';
import { checkTypes } from '../src/scala.ts';
import type { Field, ProcessSpec, TypeDef } from '../src/types.ts';

const gender: TypeDef = { id: 'e-gender', name: 'Gender', kind: 'enum', status: 'ready', values: [{ name: 'Male' }, { name: 'Female' }] };
const person: TypeDef = { id: 't-person', name: 'NaturalPerson', kind: 'case', status: 'ready', fields: [{ id: 'g', name: 'gender', type: 'e-gender' }] };
const result: TypeDef = {
  id: 't-result', name: 'Result', kind: 'enum', status: 'ready',
  fields: [{ id: 'np', name: 'naturalPerson', type: 't-person' }],
  values: [{ name: 'Single' }, { name: 'Many' }],
};
const spec = { slug: 's', types: [result, person, gender] } as unknown as ProcessSpec;
const field: Field = result.fields![0];
// as the TypeBuilder copies it: the field and the classes it refers to
const clip = { field, types: [person, gender] };

test('pasteField in the same specification: same name, same type - no new class', () => {
  const r = pasteField(spec, 't-result', clip, 0)!;
  assert.equal(r.types.length, 3);
  const single = r.types.find(t => t.id === 't-result')!.values![0];
  assert.deepEqual(single.fields!.map(f => [f.name, f.type]), [['naturalPerson', 't-person']]);
  assert.notEqual(single.fields![0].id, field.id);
  assert.equal(single.fields![0].id, r.fieldId);
});

test('pasteField: a name that is there already stays - also in the same class', () => {
  const r = pasteField(spec, 't-result', clip)!;
  const t = r.types.find(x => x.id === 't-result')!;
  assert.deepEqual(t.fields!.map(f => [f.name, f.type]), [['naturalPerson', 't-person'], ['naturalPerson', 't-person']]);
  assert.equal(r.types.length, 3);
});

test('pasteField into another specification: a class with the same name is taken, a missing one comes under its own name', () => {
  const ownGender: TypeDef = { id: 'x-gender', name: 'Gender', kind: 'enum', values: [{ name: 'Male' }, { name: 'Female' }] };
  const target: TypeDef = { id: 'x-in', name: 'In', kind: 'case', fields: [] };
  const other = { slug: 'o', types: [target, ownGender] } as unknown as ProcessSpec;
  const r = pasteField(other, 'x-in', clip)!;
  const copies = r.types.filter(t => t.name === 'NaturalPerson');
  assert.equal(copies.length, 1);
  const copy = copies[0];
  assert.notEqual(copy.id, 't-person');
  assert.equal(copy.status, 'draft');
  // the copy refers to the Gender that was there
  assert.equal(copy.fields![0].type, 'x-gender');
  assert.equal(r.types.filter(t => t.name === 'Gender').length, 1);
  assert.deepEqual(r.types.find(t => t.id === 'x-gender'), ownGender);
  const pasted = r.types.find(t => t.id === 'x-in')!.fields!;
  assert.deepEqual(pasted.map(f => [f.name, f.type]), [['naturalPerson', copy.id]]);
  // pasted a second time: the copy is there now - taken, not copied again
  const again = pasteField({ ...other, types: r.types }, 'x-in', clip)!;
  assert.equal(again.types.length, r.types.length);
  assert.deepEqual(again.types.find(t => t.id === 'x-in')!.fields!.map(f => f.type), [copy.id, copy.id]);
});

test('pasteField: a simple type or a catalog type stays; an unknown class or case is null', () => {
  const text: Field = { id: 'n', name: 'name', type: 'String' };
  const r = pasteField(spec, 't-person', { field: text, types: [] })!;
  assert.deepEqual(r.types.find(t => t.id === 't-person')!.fields!.map(f => [f.name, f.type]), [['gender', 'e-gender'], ['name', 'String']]);
  assert.equal(pasteField(spec, 'nope', clip), null);
  assert.equal(pasteField(spec, 't-result', clip, 5), null);
});

test('pasteField: a class with the same name but another shape is not taken - a copy under a free name', () => {
  // the target's Gender has other cases: the field would point to a different class
  const ownGender: TypeDef = { id: 'x-gender', name: 'Gender', kind: 'enum', values: [{ name: 'M' }, { name: 'F' }, { name: 'X' }] };
  const target: TypeDef = { id: 'x-in', name: 'In', kind: 'case', fields: [] };
  const r = pasteField({ slug: 'o', types: [target, ownGender] } as unknown as ProcessSpec, 'x-in', clip)!;
  const genders = r.types.filter(t => t.name.startsWith('Gender'));
  assert.equal(genders.length, 2);
  const copy = genders.find(t => t.id !== 'x-gender')!;
  assert.notEqual(copy.name, 'Gender');
  assert.deepEqual(copy.values!.map(v => v.name), ['Male', 'Female']);
  assert.equal(r.types.find(t => t.name === 'NaturalPerson')!.fields![0].type, copy.id);
  // the same kind and names, but other fields: not taken either
  const ownPerson: TypeDef = { id: 'x-person', name: 'NaturalPerson', kind: 'case', fields: [{ id: 'a', name: 'age', type: 'Int' }] };
  const p = pasteField({ slug: 'o', types: [target, ownPerson] } as unknown as ProcessSpec, 'x-in', clip)!;
  assert.notEqual(p.types.find(t => t.id === 'x-in')!.fields![0].type, 'x-person');
});

test('pasteField: the same name twice in a class - the class shows it as an issue', () => {
  const r = pasteField(spec, 't-person', { field: person.fields![0], types: [gender] })!;
  const issues = checkTypes(r.types).filter(i => i.typeId === 't-person');
  assert.ok(issues.some(i => !i.warn && i.message === 'Feld «gender» kommt doppelt vor.'), JSON.stringify(issues));
  // in a case of an ADT too
  const twice = pasteField({ ...spec, types: pasteField(spec, 't-result', { field: { id: 'x', name: 'note', type: 'String' }, types: [] }, 1)!.types }, 't-result', { field: { id: 'y', name: 'note', type: 'String' }, types: [] }, 1)!;
  assert.ok(checkTypes(twice.types).some(i => i.message === 'Feld «note» kommt im Fall «Many» doppelt vor.'));
});
