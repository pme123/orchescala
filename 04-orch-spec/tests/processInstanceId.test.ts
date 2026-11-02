// `processInstanceId`: in Camunda 8 the InitWorker sets it — without an InitWorker it is missing,
// that is why it is unknown there (and its use is reported).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { importBpmn } from '../src/bpmn';
import { checkFeel, processVariables } from '../src/feel';
import type { ProcessSpec } from '../src/types';

(globalThis as unknown as { DOMParser: unknown }).DOMParser = DOMParser;

const PID = 'acme-demo-keyV1';

/** Start → service task with the topic `topic` → end */
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
  return processVariables(spec, null).some(v => v.name === 'processInstanceId');
};

test('Camunda 8: processInstanceId is known with an InitWorker - it sets it', () => {
  assert.ok(knowsKey(PID, 'c8'));
});

test('Camunda 8: without an InitWorker processInstanceId is unknown - nobody sets it', () => {
  assert.ok(!knowsKey('acme-other-topic', 'c8'));
});

test('Camunda 7: processInstanceId is always known - the export uses execution.processInstanceId', () => {
  assert.ok(knowsKey('acme-other-topic', 'c7'));
});

test('Camunda 8: the old name processInstanceKey is reported with the new one', () => {
  const spec = { ...importBpmn(bpmn(PID), 'key.bpmn').spec, engine: 'c8' as const };
  const r = checkFeel('= processInstanceKey', processVariables(spec, null));
  assert.ok(r.issues.some(i => i.level === 'error' && i.text.includes('processInstanceId')));
});

// What the gateway sets: the identity of the start always, the one of the actor only after a task
test('the identities of the gateway are known - _identityCorrelation always, _identityCorrelationOfActor as optional', () => {
  for (const engine of ['c7', 'c8'] as const) {
    const spec = { ...importBpmn(bpmn(PID), 'key.bpmn').spec, engine };
    const vars = processVariables(spec, null);
    const start = vars.find(v => v.name === '_identityCorrelation');
    const actor = vars.find(v => v.name === '_identityCorrelationOfActor');
    assert.ok(start && !start.optional, engine);
    assert.ok(actor?.optional, engine);
    // its fields are known (IdentityCorrelation of Orchescala)
    for (const expr of ['= _identityCorrelation', '= _identityCorrelation.username', '= if _identityCorrelationOfActor = null then _identityCorrelation else _identityCorrelationOfActor']) {
      const unknown = checkFeel(expr, vars).issues.filter(i => i.text.includes('nicht bekannt'));
      assert.deepEqual(unknown, [], `${engine}: ${expr}`);
    }
  }
});
