// The type search: first the typed text as it is, then its characters in this order.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { searchByName, subsequenceSpan } from '../src/typeSearch.ts';

const names = [
  'NaturalPersonAddress2',
  'NaturalPersonCreateNaturalPerson3Request',
  'NaturalPersonConstructNaturalPerson2Response',
  'NotificationType1EnumValues',
  'Nat3Code',
  'ClientNat',
];
const search = (q: string) => searchByName(names, q, n => n, n => n.toLowerCase());

test('the characters in this order, the shortest stretch counts', () => {
  assert.equal(subsequenceSpan('naturalperson3', 'nat3'), 14);
  assert.equal(subsequenceSpan('nat3code', 'nat3'), 4);
  assert.equal(subsequenceSpan('natural', 'nat3'), null);
  assert.equal(subsequenceSpan('x', ''), 0);
});

test('the typed text as it is comes first, then its characters in order', () => {
  assert.deepEqual(search('nat3'), [
    'Nat3Code', // holds «nat3» as it is
    'NaturalPersonCreateNaturalPerson3Request', // n-a-t … 3, the closer one
  ]);
  // «nat» is in five names: the one starting with it first, the others as given
  assert.deepEqual(search('nat').slice(0, 2), ['NaturalPersonAddress2', 'NaturalPersonCreateNaturalPerson3Request']);
  assert.ok(search('nat').includes('ClientNat'));
});

test('words, and characters across them', () => {
  // all words somewhere → a hit as before
  assert.deepEqual(search('person 2'), ['NaturalPersonAddress2', 'NaturalPersonConstructNaturalPerson2Response']);
  // characters of several words in order
  assert.deepEqual(search('npc2r'), ['NaturalPersonConstructNaturalPerson2Response']);
  assert.deepEqual(search(''), names);
});
