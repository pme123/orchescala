// A copied class brings the classes it refers to as references to the originals where the
// target has them — the domain or the same specification — and only the others as copies.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pasteField, pasteType, replaceType } from '../src/copyPaste.ts';
import type { DomainType, ProcessSpec, TypeDef } from '../src/types.ts';

const pkg = 'acme.crm.domain.client.v1';
// an In of a collection: a person with a gender (an enum) and an address (a class with a country)
const source: TypeDef[] = [
  { id: 'c-in', name: 'In', kind: 'case', interactionId: 'svc', fields: [{ id: 'p', name: 'person', type: 'c-person' }, { id: 'a', name: 'address', type: 'c-address' }] },
  { id: 'c-person', name: 'NaturalPerson', kind: 'case', fields: [{ id: 'g', name: 'gender', type: 'c-gender' }] },
  { id: 'c-gender', name: 'NaturalPersonGender1', kind: 'enum', values: [{ name: 'male' }, { name: 'female' }] },
  { id: 'c-address', name: 'Address', kind: 'case', fields: [{ id: 'c', name: 'country', type: 'c-country' }] },
  { id: 'c-country', name: 'Country', kind: 'case', fields: [{ id: 'iso', name: 'iso', type: 'String' }] },
];
const clip = { typeId: 'c-in', types: source, source: { pkg } };
const dom = (name: string, at = pkg): DomainType => ({ id: `${at}.${name}`, name, pkg: at, kind: 'case', importPath: `${at}.${name}` });
// the domain has the person (and so its gender) — and the gender in `schema`; the address not
const model = { domainTypes: [dom('NaturalPerson'), dom('NaturalPersonGender1', `${pkg}.schema`)] };

const process = { slug: 'p', types: [{ id: 't-root', name: 'In', kind: 'case', root: true, fields: [] }] } as unknown as ProcessSpec;

test('pasteType: what the domain has is a reference, only the rest comes as a copy', () => {
  const r = pasteType(process, clip, model);
  const added = r.types.slice(1);
  assert.deepEqual(added.map(t => t.name), ['In2', 'Address', 'Country']);
  const pasted = added.find(t => t.id === r.id)!;
  assert.equal(pasted.fields![0].type, `dom:${pkg}.NaturalPerson`);
  const address = added.find(t => t.name === 'Address')!;
  assert.equal(pasted.fields![1].type, address.id);
  assert.equal(address.fields![0].type, added.find(t => t.name === 'Country')!.id);
});

test('replaceType: the In of the process gets the fields, the person stays the original of the domain', () => {
  const types = replaceType(process, 't-root', clip, model)!;
  assert.deepEqual(types.map(t => t.name), ['In', 'Address', 'Country']);
  assert.equal(types[0].fields![0].type, `dom:${pkg}.NaturalPerson`);
  assert.ok(types[0].root);
});

test('in the same specification the classes it refers to are the same — no Address2', () => {
  const same = { slug: 'c', types: source } as unknown as ProcessSpec;
  const r = pasteType(same, { typeId: 'c-person', types: source.slice(1, 3), source: { pkg } });
  const added = r.types.slice(source.length);
  assert.deepEqual(added.map(t => t.name), ['NaturalPerson2']);
  assert.equal(added[0].fields![0].type, 'c-gender');
});

test('without the domain everything comes as a copy, as before', () => {
  const r = pasteType(process, clip);
  assert.deepEqual(r.types.slice(1).map(t => t.name), ['In2', 'NaturalPerson', 'NaturalPersonGender1', 'Address', 'Country']);
});

test('pasteField: a field to a class of the domain refers to it', () => {
  const r = pasteField(process, 't-root', { field: source[0].fields![0], types: source.slice(1, 3), source: { pkg } }, undefined, model)!;
  assert.equal(r.types.length, 1);
  assert.equal(r.types[0].fields![0].type, `dom:${pkg}.NaturalPerson`);
});
