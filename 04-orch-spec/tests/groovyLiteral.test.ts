// A Groovy script that is only a literal (`[fileIdLetter, docLink]`) reads the same
// in FEEL — the import takes it as `= […]` instead of a script to rewrite.
// The Camunda 7 export keeps the script as long as the row is unchanged.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { allSteps, importBpmn } from '../src/bpmn';
import { writeBpmn } from '../src/bpmnWrite';
import { groovyToFeel } from '../src/juelFeel';

(globalThis as unknown as { DOMParser: unknown }).DOMParser = DOMParser;
(globalThis as unknown as { XMLSerializer: unknown }).XMLSerializer = class { serializeToString(n: Node) { return String(n); } };

test('Groovy literals become FEEL', () => {
  assert.equal(groovyToFeel('[fileIdLetter, docLink]'), '[fileIdLetter, docLink]');
  assert.equal(groovyToFeel("['a', \"b\", 1, -2.5, true, null]"), '["a", "b", 1, -2.5, true, null]');
  assert.equal(groovyToFeel('[[a], []]'), '[[a], []]');
  assert.equal(groovyToFeel("[key: x, 'other-key': 'v']"), '{key: x, "other-key": "v"}');
  assert.equal(groovyToFeel('[:]'), '{}');
  assert.equal(groovyToFeel('return [a, b];'), '[a, b]');
  assert.equal(groovyToFeel("'it\\'s'"), '"it\'s"');
});

test('anything else stays a script', () => {
  for (const s of ['[a.b]', '[a()]', 'a + b', '"x ${a}"', '[a ? b : c]', '[1L]', 'def x = 1; [x]', '[a: 1, b]', '[a']) {
    assert.equal(groovyToFeel(s), null, s);
  }
});

const bpmn = (script: string) => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="d" targetNamespace="t">
  <bpmn:process id="letters" isExecutable="true">
    <bpmn:startEvent id="Start"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:serviceTask id="SendTask" name="Send" camunda:type="external" camunda:topic="send-letters">
      <bpmn:extensionElements>
        <camunda:inputOutput>
          <camunda:inputParameter name="lettersToSend"><camunda:script scriptFormat="groovy">${script}</camunda:script></camunda:inputParameter>
        </camunda:inputOutput>
      </bpmn:extensionElements>
      <bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing>
    </bpmn:serviceTask>
    <bpmn:endEvent id="End"><bpmn:incoming>f2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="f1" sourceRef="Start" targetRef="SendTask" />
    <bpmn:sequenceFlow id="f2" sourceRef="SendTask" targetRef="End" />
  </bpmn:process>
</bpmn:definitions>`;

const row = (xml: string) => {
  const spec = importBpmn(xml, 'letters').spec;
  return { spec, step: allSteps(spec.steps).find(s => s.id === 'SendTask')! };
};

test('import: a Groovy list is FEEL, a real script stays described', () => {
  assert.equal(row(bpmn('[fileIdLetter, docLink]')).step.inputs?.[0].expression, '= [fileIdLetter, docLink]');
  assert.equal(row(bpmn('[fileIdLetter, docLink].findAll { it }')).step.inputs?.[0].expression, '«groovy» [fileIdLetter, docLink].findAll { it }');
});

test('C7 export: the unchanged list stays the script it was', () => {
  const xml = bpmn('[fileIdLetter, docLink]');
  const { spec } = row(xml);
  const out = writeBpmn(xml, spec).xml;
  assert.ok(out.includes('<camunda:script scriptFormat="groovy">[fileIdLetter, docLink]</camunda:script>'), out);
});
