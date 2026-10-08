// c7 is the BPMN of Camunda 7 - Operaton runs it unchanged: one label for both, from one place,
// and the messages for c7 use it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { C7_LABEL, C8_LABEL, engineLabel } from '../src/engineLabels';
import { ENGINES } from '../src/template';
import { regexIssue, scriptWarning } from '../src/findings';
import { juelToFeel } from '../src/juelFeel';
import { convertBpmn } from '../src/engineConvert';
import { exportSpec } from '../src/exporters';
import type { EngineId, ProcessSpec } from '../src/types';

// the converter works on the DOM of the browser
const g = globalThis as unknown as Record<string, unknown>;
g.DOMParser ??= DOMParser;
g.XMLSerializer ??= class { serializeToString(doc: { toString(): string }) { return doc.toString(); } };

test('the engines take their labels from engineLabels', () => {
  assert.equal(engineLabel('c7'), C7_LABEL);
  assert.equal(engineLabel('c8'), C8_LABEL);
  assert.deepEqual(ENGINES.map((e) => e.label), [C7_LABEL, C8_LABEL]);
  assert.equal(engineLabel(undefined), C7_LABEL); // without an engine: the default c7
  assert.equal(engineLabel('c9' as EngineId), 'c9'); // an unknown value stays visible
  // the words themselves - the other checks only compare with the constants
  assert.equal(C7_LABEL, 'Camunda 7 / Operaton');
  assert.equal(C8_LABEL, 'Camunda 8');
});

test('the findings and the JUEL import for c7 name the label', () => {
  assert.ok(scriptWarning('c7').includes(C7_LABEL));
  assert.ok(regexIssue('[0-9]{1,2}', 'c7')?.text.includes(`In ${C7_LABEL} trennt das Komma`));
  assert.ok(!scriptWarning('c8').includes(C7_LABEL));
  const r = juelToFeel('execution.someUnknownProperty');
  assert.ok(!r.ok && r.reason.includes(`gibt es nur in ${C7_LABEL}`), JSON.stringify(r));
});

test('converting to c7 names the label in its notes', () => {
  const c8 = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:zeebe="http://camunda.org/schema/zeebe/1.0" id="d" targetNamespace="x">
  <bpmn:process id="p" isExecutable="true"><bpmn:startEvent id="s" /></bpmn:process>
</bpmn:definitions>`;
  const r = convertBpmn(c8, 'c7');
  assert.ok(r.issues.some((i) => i.text === `${C7_LABEL} verlangt historyTimeToLive — in der Spezifikation setzen.`), JSON.stringify(r.issues));
});

test('the Orchescala export names the engine of the spec', () => {
  const spec = { version: 1, slug: 'acme-shop-bookv1', name: 'bookV1', title: 'Buchen', processId: 'acme-shop-bookV1',
    updatedAt: '2026-10-08T09:00:00Z', steps: [], types: [], interactions: [] } as unknown as ProcessSpec;
  assert.match(exportSpec({ ...spec, engine: 'c7' }, 'orchescala', null), /\| Engine \| Camunda 7 \/ Operaton \|/);
  assert.match(exportSpec({ ...spec, engine: 'c8' }, 'orchescala', null), /\| Engine \| Camunda 8 \|/);
});
