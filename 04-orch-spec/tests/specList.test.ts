// The head shared by the lists of processes and pages: search, epics, sorting, groups per project.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { epicChoices, filterEntries, groupByProject, NO_PROJECT, type ListEntry } from '../src/components/SpecList';
import type { Model } from '../src/types';

type Item = { id: string } & ListEntry;
const items: Item[] = [
  { id: 'a', title: 'Termin buchen', terms: ['appointments/book'], project: 'acme-customer', epics: ['adr'], updatedAt: '2026-10-20' },
  { id: 'b', title: 'Adresse ändern', terms: ['acme-crm-changeAddressV1'], project: 'acme-crm', updatedAt: '2026-10-22' },
  { id: 'c', title: 'Bestätigt', terms: ['appointments/verified'], epics: ['old'] },
];
const entry = (i: Item): ListEntry => i;
const model = { version: 1, services: [], epics: [{ id: 'adr', name: 'Adressänderung' }, { id: 'old', name: 'Alt', closed: true }, { id: 'gone', name: 'Weg', closed: true }] } as unknown as Model;
const ids = (list: Item[]) => list.map((i) => i.id);

test('filterEntries - all words, also in project and epic names; the epic; sorted by the last change', () => {
  const f = (query: string, epic: string | null = null, sortBy: 'title' | 'updated' = 'title') => ids(filterEntries(items, entry, { query, epic, sortBy }, model));
  assert.deepEqual(f(''), ['a', 'b', 'c']);
  assert.deepEqual(f('appointments'), ['a', 'c']);
  assert.deepEqual(f('appointments book'), ['a']);
  assert.deepEqual(f('ADRESS'), ['a', 'b']); // the epic «Adressänderung» and the title «Adresse ändern»
  assert.deepEqual(f('crm'), ['b']); // the project
  assert.deepEqual(f('', 'adr'), ['a']);
  assert.deepEqual(f('', null, 'updated'), ['b', 'a', 'c']);
});

test('groupByProject - in the order of the first entry, without project at its place', () => {
  assert.deepEqual(groupByProject(items, (i) => i.project).map(([p, list]) => [p, ids(list)]), [
    ['acme-customer', ['a']], ['acme-crm', ['b']], [NO_PROJECT, ['c']],
  ]);
});

test('epicChoices - the open epics, closed ones only while an entry carries them', () => {
  assert.deepEqual(epicChoices(items, entry, model).map((e) => [e.id, e.n]), [['adr', 1], ['old', 1]]);
});
