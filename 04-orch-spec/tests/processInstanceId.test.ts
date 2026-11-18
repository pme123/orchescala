// The own process instance: Camunda 7 `processInstanceId` (execution.processInstanceId),
// Camunda 8 `camunda.processInstance.key` in FEEL (8.10) — no worker sets a variable.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { importBpmn } from '../src/bpmn';
import { checkFeel, processVariables } from '../src/feel';
import { feelToJuel } from '../src/feelJuel';
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

test('C7 and C8: processInstanceId is unknown - also with an InitWorker, the own instance is the context', () => {
  for (const engine of ['c7', 'c8'] as const) {
    assert.ok(!knowsKey(PID, engine), engine);
    assert.ok(!knowsKey('acme-other-topic', engine), engine);
  }
});

test('C7 and C8: camunda.processInstance.key is known - with and without an InitWorker', () => {
  for (const engine of ['c7', 'c8'] as const) for (const topic of [PID, 'acme-other-topic']) {
    const spec = { ...importBpmn(bpmn(topic), 'key.bpmn').spec, engine };
    for (const expr of ['= camunda.processInstance.key', '= string(camunda.processInstance.key)', '= "cancel-" + string(camunda.processInstance.key)', '= camunda.processInstance.businessId'])
      assert.deepEqual(checkFeel(expr, processVariables(spec, null)).issues.filter(i => i.level === 'error'), [], `${engine} ${topic}: ${expr}`);
  }
});

test('export to C7: only the context is execution.processInstanceId - a variable processInstanceId stays a variable', () => {
  const own = feelToJuel('string(camunda.processInstance.key)');
  assert.ok(own.ok && own.juel === 'execution.processInstanceId', JSON.stringify(own));
  const plain = feelToJuel('processInstanceId');
  assert.ok(plain.ok && !plain.juel.includes('execution.'), JSON.stringify(plain));
});

test('C7 and C8: the old variables processInstanceId and processInstanceKey are reported with the own key', () => {
  for (const engine of ['c7', 'c8'] as const) {
    const spec = { ...importBpmn(bpmn(PID), 'key.bpmn').spec, engine };
    for (const old of ['processInstanceId', 'processInstanceKey']) {
      const r = checkFeel(`= ${old}`, processVariables(spec, null));
      assert.ok(r.issues.some(i => i.level === 'error' && i.text.includes('camunda.processInstance.key')), `${engine}: ${old}`);
    }
  }
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

test('an own variable with the name of a gateway identity keeps its own description - the first one counts', () => {
  const base = importBpmn(bpmn(PID), 'key.bpmn').spec;
  const spec = { ...base, types: [...(base.types ?? []), { id: 'in', name: 'In', kind: 'case', root: true, fields: [{ id: 'f1', name: '_identityCorrelation', type: 'String' }] }] } as unknown as ProcessSpec;
  const vars = processVariables(spec, null).filter(v => v.name === '_identityCorrelation');
  assert.equal(vars.length, 1);
  assert.equal(vars[0].source, 'In');
});
