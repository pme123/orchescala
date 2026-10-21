// Eine fangende Nachricht: über welchen Schlüssel sie korreliert — und wie man sie am Gateway sendet.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { allSteps, importBpmn, mergeSpec, syncCorrelationKeys } from '../src/bpmn';
import { messageCorrelation, messageRequest } from '../src/messageCall';
import type { ProcessSpec, Step } from '../src/types';

(globalThis as unknown as { DOMParser: unknown }).DOMParser = DOMParser;

const bpmn = (subscription: string) => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:zeebe="http://camunda.org/schema/zeebe/1.0" xmlns:modeler="http://camunda.org/schema/modeler/1.0" modeler:executionPlatform="Camunda Cloud" id="d" targetNamespace="x">
  <bpmn:process id="acme-demo-kubeV1" isExecutable="true">
    <bpmn:startEvent id="StartEvent"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:intermediateCatchEvent id="ResetEvent" name="Reset"><bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing>
      <bpmn:messageEventDefinition id="md" messageRef="Msg"/>
    </bpmn:intermediateCatchEvent>
    <bpmn:endEvent id="EndEvent"><bpmn:incoming>f2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="f1" sourceRef="StartEvent" targetRef="ResetEvent"/>
    <bpmn:sequenceFlow id="f2" sourceRef="ResetEvent" targetRef="EndEvent"/>
  </bpmn:process>
  <bpmn:message id="Msg" name="acme-demo-kube-reset">${subscription}</bpmn:message>
</bpmn:definitions>`;

const reset = (s: ProcessSpec): Step => allSteps(s.steps).find(x => x.id === 'ResetEvent')!;
const sub = (key: string) => `<bpmn:extensionElements><zeebe:subscription correlationKey="${key}"/></bpmn:extensionElements>`;

test('import: the correlation key of a waiting message - from zeebe:subscription', () => {
  const s = importBpmn(bpmn(sub('=processInstanceKey')), 'kube').spec;
  assert.equal(reset(s).messageName, 'acme-demo-kube-reset');
  assert.equal(reset(s).correlationKey, '=processInstanceKey');
});

test('C8: the key decides the gateway parameter', () => {
  const step = (correlationKey?: string): Step => ({ id: 'E', kind: 'event', name: 'E', status: 'implemented', eventKind: 'message', eventDirection: 'catch', messageName: 'm', correlationKey });
  assert.deepEqual(messageCorrelation(step('=processInstanceKey'), 'c8'), { param: 'processInstanceId', value: '{{processInstanceId}}', expression: '=processInstanceKey' });
  assert.deepEqual(messageCorrelation(step('=businessKey'), 'c8'), { param: 'businessKey', value: '{{businessKey}}', expression: '=businessKey' });
  assert.equal(messageCorrelation(step('=order.id'), 'c8')?.value, '{{id}}');
  assert.equal(messageCorrelation(step(), 'c8')?.missing, true);
  // Camunda 7: der Sender wählt
  assert.deepEqual(messageCorrelation(step(), 'c7'), { param: 'businessKey', value: '{{businessKey}}', either: true });
  // ein werfendes Ereignis wartet auf nichts
  assert.equal(messageCorrelation({ ...step('=businessKey'), eventDirection: 'throw' }, 'c8'), null);
});

test('the request: like in Postman - with the fields of the In', () => {
  const step: Step = { id: 'E', kind: 'event', name: 'E', status: 'implemented', eventKind: 'message', eventDirection: 'catch', messageName: 'acme-reset', correlationKey: '=processInstanceKey' };
  const spec = {
    interactions: [{ id: 'i', stepId: 'E', kind: 'message' as const, name: 'ResetME', key: 'acme-reset', inTypeId: 't' }],
    types: [{ id: 't', name: 'In', kind: 'case' as const, fields: [{ id: 'f', name: 'reason', type: 'String' }] }],
  };
  assert.equal(messageRequest(step, messageCorrelation(step, 'c8')!, spec),
    'POST {{baseUrl}}/message/acme-reset?processInstanceId={{processInstanceId}}\nContent-Type: application/json\n\n{\n  "reason": …\n}');
});

test('a saved spec gets the key from the diagram - on load and on merge', () => {
  const fresh = importBpmn(bpmn(sub('=businessKey')), 'kube').spec;
  const saved: ProcessSpec = { ...fresh, steps: fresh.steps.map(s => ({ ...s, correlationKey: undefined })) };
  assert.equal(reset(syncCorrelationKeys(saved, fresh)!).correlationKey, '=businessKey');
  assert.equal(syncCorrelationKeys(fresh, fresh), null);
  assert.equal(reset(mergeSpec(fresh, saved).spec).correlationKey, '=businessKey');
});
