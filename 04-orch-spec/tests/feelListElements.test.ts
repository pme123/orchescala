// The elements of a list against what the target field expects: `[persons, companies]` for a
// `Seq[Client]` is a list of lists - concatenate or flatten gives the objects.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkFeel, expectedFor, type VarNode } from '../src/feel';
import type { TypeDef } from '../src/types';

const client: TypeDef = { id: 'client', name: 'Client', kind: 'enum', values: [{ name: 'Person', fields: [{ id: 'f', name: 'firstName', type: 'String' }] }] };
const list = (name: string): VarNode => ({
  name, type: 'list', label: 'Seq[Person]', source: 'Ausgabe',
  children: [{ name: 'firstName', type: 'string', label: 'String', source: 'Ausgabe' }],
});
const vars = [list('persons'), list('companies')];
const expected = expectedFor({ id: 'c', name: 'clients', type: 'client', collection: true }, [client]);

test('expectedFor a list: what its elements must be', () => {
  assert.deepEqual(expected?.elements, ['context']);
  assert.deepEqual(expectedFor({ id: 'k', name: 'keys', type: 'String', collection: true })?.elements, ['string']);
});

test('a list of lists for a list of objects is an error - concatenate and flatten fit', () => {
  const nested = checkFeel('= [persons, companies]', vars, expected).issues;
  assert.equal(nested.length, 1);
  assert.match(nested[0].text, /Die Elemente sind Listen, .* erwartet Objekt - Listen aneinanderhängen mit concatenate/);
  assert.deepEqual(checkFeel('= concatenate(persons, companies)', vars, expected).issues, []);
  assert.deepEqual(checkFeel('= flatten([persons, companies])', vars, expected).issues, []);
});

test('a list of unknown elements says nothing about them', () => {
  const unknown: VarNode = { name: 'items', type: 'list', label: 'Seq[?]', source: 'Ausgabe' };
  assert.deepEqual(checkFeel('= items', [unknown], expected).issues, []);
});
