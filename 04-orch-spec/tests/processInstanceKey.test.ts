// `processInstanceKey`: in Camunda 8 setzt ihn der InitWorker — ohne InitWorker fehlt er,
// darum ist er dort unbekannt (und sein Gebrauch wird gemeldet).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { importBpmn } from '../src/bpmn';
import { processVariables } from '../src/feel';
import type { ProcessSpec } from '../src/types';

(globalThis as unknown as { DOMParser: unknown }).DOMParser = DOMParser;

const PID = 'acme-demo-keyV1';

/** Start → Service-Task mit dem Topic `topic` → Ende */
const bpmn = (topic: string) => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="d" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="${PID}" name="${PID}" isExecutable="true">
    <bpmn:startEvent id="StartEvent"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:serviceTask id="Task" name="Task" camunda:type="external" camunda:topic="${topic}">
      <bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing>
    </bpmn:serviceTask>
    <bpmn:endEvent id="End"><bpmn:incoming>f2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="f1" sourceRef="StartEvent" targetRef="Task" />
    <bpmn:sequenceFlow id="f2" sourceRef="Task" targetRef="End" />
  </bpmn:process>
</bpmn:definitions>`;

const knowsKey = (topic: string, engine: ProcessSpec['engine']): boolean => {
  const spec = { ...importBpmn(bpmn(topic), 'key.bpmn').spec, engine };
  return processVariables(spec, null).some(v => v.name === 'processInstanceKey');
};

test('Camunda 8: processInstanceKey is known with an InitWorker - it sets it', () => {
  assert.ok(knowsKey(PID, 'c8'));
});

test('Camunda 8: without an InitWorker processInstanceKey is unknown - nobody sets it', () => {
  assert.ok(!knowsKey('acme-other-topic', 'c8'));
});

test('Camunda 7: processInstanceKey is always known - the export uses execution.processInstanceId', () => {
  assert.ok(knowsKey('acme-other-topic', 'c7'));
});
