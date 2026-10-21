// Eine fangende Nachricht: über welchen Schlüssel sie korreliert — und wie man sie am Gateway sendet.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { allSteps, importBpmn, mergeSpec, syncCorrelationKeys } from '../src/bpmn';
import { writeBpmn } from '../src/bpmnWrite';
import { CORRELATION_KEY, correlationKeysOf, messageCorrelation, messageRequest, withMessageName } from '../src/messageCall';
import { convertBpmn } from '../src/engineConvert';
import type { ProcessSpec, Step } from '../src/types';
import { installXmlNamespaces } from './xmlNamespaces';

const g = globalThis as unknown as Record<string, unknown>;
g.DOMParser ??= DOMParser;
g.XMLSerializer ??= class { serializeToString(doc: { toString(): string }) { return doc.toString(); } };
installXmlNamespaces();

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
  const s = importBpmn(bpmn(sub('=processInstanceId')), 'kube').spec;
  assert.equal(reset(s).messageName, 'acme-demo-kube-reset');
  assert.equal(reset(s).correlationKey, '=processInstanceId');
});

test('one of the two ways is chosen - in C8 as the key of the message', () => {
  const step = (correlationKey?: string): Step => ({ id: 'E', kind: 'event', name: 'E', status: 'implemented', eventKind: 'message', eventDirection: 'catch', messageName: 'm', correlationKey });
  assert.deepEqual(messageCorrelation(step('=processInstanceId'), 'c8'), { choice: 'processInstanceId', param: 'processInstanceId', value: '{{processInstanceId}}', expression: '=processInstanceId' });
  assert.deepEqual(messageCorrelation(step('=businessKey'), 'c8'), { choice: 'businessKey', param: 'businessKey', value: '{{businessKey}}', expression: '=businessKey' });
  assert.equal(messageCorrelation(step(CORRELATION_KEY.processInstanceId), 'c8')?.choice, 'processInstanceId');
  // ein anderer Ausdruck aus dem Diagramm: keiner der beiden
  assert.equal(messageCorrelation(step('=order.id'), 'c8')?.choice, null);
  assert.equal(messageCorrelation(step('=order.id'), 'c8')?.value, '{{id}}');
  // processInstanceKey ist der alte Name — der InitWorker setzt processInstanceId
  assert.equal(messageCorrelation(step('=processInstanceKey'), 'c8')?.misnamed, true);
  assert.equal(messageCorrelation(step('=processInstanceKey'), 'c8')?.choice, null);
  assert.equal(messageCorrelation(step(), 'c8')?.missing, true);
  // Camunda 7: ohne Wahl nimmt der Sender einen der beiden — mit Wahl gilt sie
  assert.equal(messageCorrelation(step(), 'c7')?.either, true);
  assert.equal(messageCorrelation(step('=processInstanceId'), 'c7')?.choice, 'processInstanceId');
  // ein werfendes Ereignis wartet auf nichts
  assert.equal(messageCorrelation({ ...step('=businessKey'), eventDirection: 'throw' }, 'c8'), null);
});

test('C7 -> C8: the chosen key goes into the message - instead of the proposal', () => {
  const c7 = bpmn('').replace(/ xmlns:zeebe="[^"]*"| xmlns:modeler="[^"]*"| modeler:executionPlatform="[^"]*"/g, '');
  const spec = importBpmn(c7, 'kube').spec;
  const chosen = { ...spec, steps: spec.steps.map(s => (s.id === 'ResetEvent' ? { ...s, correlationKey: CORRELATION_KEY.processInstanceId } : s)) };
  const conv = convertBpmn(c7, 'c8', { correlationKeys: correlationKeysOf(chosen) });
  assert.equal(reset(importBpmn(conv.xml, 'kube').spec).correlationKey, '=processInstanceId');
  assert.ok(!conv.issues.some(i => i.where === 'Nachricht'));
  // ohne Wahl: der Vorschlag, gemeldet
  const proposed = convertBpmn(c7, 'c8');
  assert.equal(reset(importBpmn(proposed.xml, 'kube').spec).correlationKey, '=businessKey');
  assert.ok(proposed.issues.some(i => i.where === 'Nachricht'));
});

test('the request: like in Postman - with the fields of the In', () => {
  const step: Step = { id: 'E', kind: 'event', name: 'E', status: 'implemented', eventKind: 'message', eventDirection: 'catch', messageName: 'acme-reset', correlationKey: '=processInstanceId' };
  const spec = {
    interactions: [{ id: 'i', stepId: 'E', kind: 'message' as const, name: 'ResetME', key: 'acme-reset', inTypeId: 't' }],
    types: [{ id: 't', name: 'In', kind: 'case' as const, fields: [{ id: 'f', name: 'reason', type: 'String' }] }],
  };
  assert.equal(messageRequest(step, messageCorrelation(step, 'c8')!, spec),
    'POST {{baseUrl}}/message/acme-reset?processInstanceId={{processInstanceId}}\nContent-Type: application/json\n\n{\n  "reason": …\n}');
});

test('a saved spec gets the key from the diagram - on load and on merge', () => {
  const fresh = importBpmn(bpmn(sub('=businessKey')), 'kube').spec;
  const saved: ProcessSpec = { ...fresh, steps: fresh.steps.map(s => {
    const { correlationKey: _, ...rest } = s;
    return rest;
  }) };
  assert.equal(reset(syncCorrelationKeys(saved, fresh)!).correlationKey, '=businessKey');
  assert.equal(syncCorrelationKeys(fresh, fresh), null);
  assert.equal(reset(mergeSpec(fresh, saved).spec).correlationKey, '=businessKey');
});

/** die Spezifikation des Diagramms, mit geändertem Schritt `ResetEvent` */
const edited = (xml: string, patch: Partial<Step>, name?: string): ProcessSpec => {
  let spec = importBpmn(xml, 'kube').spec;
  if (name !== undefined) spec = withMessageName(spec, 'ResetEvent', name);
  const walk = (steps: Step[]): Step[] => steps.map(s => (s.id === 'ResetEvent' ? { ...s, ...patch } : s));
  return { ...spec, steps: walk(spec.steps) };
};

test('an edit in the app survives a merge with the unchanged diagram', () => {
  const xml = bpmn(sub('=businessKey'));
  const base = importBpmn(xml, 'kube').spec;
  const mine = edited(xml, { correlationKey: '=processInstanceId' }, 'acme-demo-kube-restart');
  const merged = mergeSpec(importBpmn(xml, 'kube').spec, mine, base).spec;
  assert.equal(reset(merged).correlationKey, '=processInstanceId');
  assert.equal(reset(merged).messageName, 'acme-demo-kube-restart');
});

test('export: name and key go into the message', () => {
  const xml = bpmn(sub('=businessKey'));
  const out = writeBpmn(xml, edited(xml, { correlationKey: '=processInstanceId' }, 'acme-demo-kube-restart')).xml;
  const back = importBpmn(out, 'kube').spec;
  assert.equal(reset(back).messageName, 'acme-demo-kube-restart');
  assert.equal(reset(back).correlationKey, '=processInstanceId');
  assert.equal(out.match(/<bpmn:message /g)?.length, 1);
  // nichts geändert — nichts geschrieben
  assert.equal(writeBpmn(xml, importBpmn(xml, 'kube').spec).xml.match(/correlationKey="=businessKey"/g)?.length, 1);
});

test('export: a message shared with another element is not renamed under its feet', () => {
  const shared = bpmn(sub('=businessKey')).replace('<bpmn:endEvent id="EndEvent"><bpmn:incoming>f2</bpmn:incoming></bpmn:endEvent>',
    '<bpmn:endEvent id="EndEvent"><bpmn:incoming>f2</bpmn:incoming><bpmn:messageEventDefinition id="md2" messageRef="Msg"/></bpmn:endEvent>');
  const out = writeBpmn(shared, edited(shared, {}, 'acme-demo-kube-restart')).xml;
  const back = importBpmn(out, 'kube').spec;
  assert.equal(reset(back).messageName, 'acme-demo-kube-restart');
  assert.equal(reset(back).correlationKey, '=businessKey');
  assert.equal(allSteps(back.steps).find(s => s.id === 'EndEvent')?.messageName, 'acme-demo-kube-reset');
});

test('rename: the interaction keeping the old name follows', () => {
  const spec = importBpmn(bpmn(''), 'kube').spec;
  const withIa = { ...spec, interactions: [{ id: 'i', stepId: 'ResetEvent', kind: 'message' as const, name: 'ResetME', key: 'acme-demo-kube-reset' }] };
  assert.equal(withMessageName(withIa, 'ResetEvent', 'acme-x').interactions?.[0].key, 'acme-x');
});
