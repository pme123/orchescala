// `${masterRead.prop("clientSegment", 10)}` setzt in Camunda 7 (Spin) ein Feld
// und gibt den Knoten zurück — in FEEL `context put(…)`. Und zurück.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { feelToJuel } from '../src/feelJuel';
import { importExpression } from '../src/juelFeel';

test('import: Spin prop(name, value) is context put', () => {
  assert.equal(importExpression('${masterRead.prop("clientSegment", 10)}'), '= context put(masterRead, "clientSegment", 10)');
  assert.equal(importExpression('${client.prop("address").prop("zip", "3000")}'), '= context put(client.address, "zip", "3000")');
  // prop mit einem Argument liest weiterhin
  assert.equal(importExpression('${masterRead.prop("clientSegment")}'), '= masterRead.clientSegment');
});

test('export: context put is Spin prop(name, value)', () => {
  assert.deepEqual(feelToJuel('context put(masterRead, "clientSegment", 10)'), { ok: true, juel: 'masterRead.prop("clientSegment", 10)' });
  assert.equal(feelToJuel('context put(masterRead, k, 10)').ok, false);
});
