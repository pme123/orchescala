// c7 is the BPMN of Camunda 7 - Operaton runs it unchanged: one label for both, from one place.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { C7_LABEL, ENGINES, engineLabel } from '../src/template';
import { regexIssue, scriptWarning } from '../src/findings';

test('the c7 engine names Camunda 7 and Operaton, c8 stays Camunda 8', () => {
  assert.equal(C7_LABEL, 'Camunda 7 / Operaton');
  assert.equal(engineLabel('c7'), C7_LABEL);
  assert.equal(engineLabel('c8'), 'Camunda 8');
  assert.equal(ENGINES.find((e) => e.id === 'c7')?.label, C7_LABEL);
});

test('the findings for c7 use the label', () => {
  assert.match(scriptWarning('c7'), /Camunda 7 \/ Operaton/);
  assert.match(regexIssue('[0-9]{1,2}', 'c7')?.text ?? '', /In Camunda 7 \/ Operaton trennt das Komma/);
  assert.doesNotMatch(scriptWarning('c8'), /Operaton/);
});
