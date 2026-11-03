// An Out with cases in the output mapping: the saved cases and the chain of the worker.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caseChain, prunedOutCases, withOutCase } from '../src/services/outCases.ts';
import type { TypeDef } from '../src/types.ts';
import type { OutCase } from '../src/services/types.ts';

const cases: OutCase[] = [
  { name: 'Found', condition: '= body != null' },
  { name: 'Gone', condition: '= status = 410' },
  { name: 'NotFound', mappings: [{ name: 'reason', expression: '= "no client"' }] },
];

test('withOutCase: a changed case stays in its place - the saved spec keeps its order', () => {
  const next = withOutCase(cases, 'Found', c => ({ ...c, condition: '= body.id != null' }));
  assert.deepEqual(next.map(c => c.name), ['Found', 'Gone', 'NotFound']);
  assert.equal(next[0].condition, '= body.id != null');
  // a new one comes last
  assert.deepEqual(withOutCase(cases, 'Other', c => ({ ...c, condition: '= true' })).map(c => c.name), ['Found', 'Gone', 'NotFound', 'Other']);
});

test('withOutCase: a case without a condition and without an expression is left out', () => {
  assert.deepEqual(withOutCase(cases, 'Gone', c => ({ ...c, condition: '  ' })).map(c => c.name), ['Found', 'NotFound']);
  // a blank expression counts as none
  assert.deepEqual(withOutCase(cases, 'NotFound', c => ({ ...c, mappings: [{ name: 'reason', expression: ' ' }] })).map(c => c.name), ['Found', 'Gone']);
  // a condition alone keeps it, an expression alone too
  assert.equal(withOutCase(undefined, 'Found', c => ({ ...c, condition: '= true' })).length, 1);
  assert.equal(withOutCase(undefined, 'Found', c => ({ ...c, mappings: [{ name: 'x', expression: '= 1' }] })).length, 1);
});

test('caseChain: the conditions in order, the last case without one is the otherwise', () => {
  assert.equal(caseChain([{ cond: 'a', value: 'A' }, { cond: 'b', value: 'B' }], 'X'), 'if a then\n  A\nelse if b then\n  B\nelse\n  X');
  assert.equal(caseChain([{ cond: 'a', value: 'A' }, { value: 'B' }], 'X'), 'if a then\n  A\nelse\n  B');
  assert.equal(caseChain([{ value: 'A' }], 'X'), 'A');
  // a blank line in a value stays blank - no trailing spaces
  assert.equal(caseChain([{ cond: 'a', value: 'x\n\ny' }], 'X'), 'if a then\n  x\n\n  y\nelse\n  X');
});

test('caseChain: a case without a condition before the last one would lose the others - an error', () => {
  assert.throws(() => caseChain([{ value: 'A' }, { cond: 'b', value: 'B' }], 'X'), /only the last branch/);
});

test('prunedOutCases: a case or a field the Out no longer has is not kept', () => {
  const out: TypeDef = {
    id: 'o', name: 'Out', kind: 'enum', fields: [{ id: 'e', name: 'etag', type: 'String' }],
    values: [{ name: 'Found', fields: [{ id: 'c', name: 'client', type: 'String' }] }, { name: 'NotFound' }],
  };
  const saved: OutCase[] = [
    { name: 'Found', condition: '= true', mappings: [{ name: 'client', expression: '= body' }, { name: 'gone', expression: '= 1' }, { name: 'etag', expression: '= "x"' }] },
    { name: 'Renamed', condition: '= false' },
    { name: 'NotFound', condition: '= body = null' },
  ];
  assert.deepEqual(prunedOutCases(saved, out), [
    { name: 'Found', condition: '= true', mappings: [{ name: 'client', expression: '= body' }, { name: 'etag', expression: '= "x"' }] },
    { name: 'NotFound', condition: '= body = null' },
  ]);
  assert.deepEqual(prunedOutCases(undefined, out), []);
  // a case being renamed (no name yet): nothing is dropped until it has one
  const renaming: TypeDef = { ...out, values: [{ name: '', fields: [{ id: 'c', name: 'client', type: 'String' }] }, { name: 'NotFound' }] };
  assert.deepEqual(prunedOutCases(saved, renaming), saved);
  const fieldRenaming: TypeDef = { ...out, values: [{ name: 'Found', fields: [{ id: 'c', name: '', type: 'String' }] }, { name: 'NotFound' }] };
  assert.deepEqual(prunedOutCases(saved, fieldRenaming), saved);
});
