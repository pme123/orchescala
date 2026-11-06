// JUEL the import cannot translate: the UI says why — not just that.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importExpression, juelImportReason } from '../src/juelFeel.ts';

test('concat is string concatenation', () => {
  assert.equal(importExpression('${"fileLink".concat(loopCounter)}'), '= "fileLink" + string(loopCounter)');
});

test('getVariable with a fixed name is the variable', () => {
  assert.equal(importExpression('${execution.getVariable("fileLink")}'), '= fileLink');
});

test('getVariable with a computed name stays JUEL — with the reason', () => {
  const juel = '${execution.getVariable("fileLink".concat(loopCounter))}';
  assert.equal(importExpression(juel), juel);
  const reason = juelImportReason(juel);
  assert.ok(reason?.includes('berechnetem Namen'), reason ?? 'no reason');
  assert.ok(reason?.includes('"fileLink" + string(loopCounter)'), reason ?? 'no reason');
});

test('no reason for translatable JUEL, FEEL or fixed text', () => {
  assert.equal(juelImportReason('${a.concat(b)}'), null);
  assert.equal(juelImportReason('= a + b'), null);
  assert.equal(juelImportReason('fest'), null);
});
