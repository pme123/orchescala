// A pattern that reuses a root element of the diagram (message, signal, error) brings along the
// extensions it needs there - e.g. in Camunda 8 the correlation key (`zeebe:subscription`) of the
// start message, which an event subprocess catching the same message needs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { applyPattern, detectPatterns } from '../src/patterns';
import type { PatternDef } from '../src/types';

const g = globalThis as unknown as Record<string, unknown>;
g.DOMParser ??= DOMParser;
g.XMLSerializer ??= class { serializeToString(doc: { toString(): string }) { return doc.toString(); } };

const NS = 'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" '
  + 'xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" '
  + 'xmlns:zeebe="http://camunda.org/schema/zeebe/1.0" xmlns:modeler="http://camunda.org/schema/modeler/1.0" modeler:executionPlatform="Camunda Cloud"';

// the event subprocess of «Einmalige Ausführung» in Camunda 8
const fragment = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${NS} id="PatternDefinitions" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="PatternProcess" isExecutable="true">
    <bpmn:subProcess id="AlreadyRunningSubProcess" name="Process already running" triggeredByEvent="true">
      <bpmn:startEvent id="AlreadyRunningStart" name="already running" isInterrupting="false">
        <bpmn:messageEventDefinition id="AlreadyRunningStartDef" messageRef="StartMessage" />
      </bpmn:startEvent>
    </bpmn:subProcess>
  </bpmn:process>
  <bpmn:message id="StartMessage" name="{{startMessage}}">
    <bpmn:extensionElements>
      <zeebe:subscription correlationKey="=businessKey" />
    </bpmn:extensionElements>
  </bpmn:message>
  <bpmndi:BPMNDiagram id="PatternDiagram">
    <bpmndi:BPMNPlane id="PatternPlane" bpmnElement="PatternProcess">
      <bpmndi:BPMNShape id="AlreadyRunningSubProcess_di" bpmnElement="AlreadyRunningSubProcess" isExpanded="true">
        <dc:Bounds x="250" y="270" width="340" height="140" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="AlreadyRunningStart_di" bpmnElement="AlreadyRunningStart">
        <dc:Bounds x="302" y="322" width="36" height="36" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;
const def = { id: 'unique-execution', name: 'Einmalige Ausführung', appliesTo: ['process'], bpmn: { c8: fragment } } as unknown as PatternDef;

const processWith = (message: string, start: string) => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${NS} id="Defs" targetNamespace="http://bpmn.io/schema/bpmn">
  ${message}
  <bpmn:process id="acme-demo" isExecutable="true">
    ${start}
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram">
    <bpmndi:BPMNPlane id="Plane" bpmnElement="acme-demo">
      <bpmndi:BPMNShape id="StartStartEvent_di" bpmnElement="StartStartEvent">
        <dc:Bounds x="100" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

const subscriptions = (xml: string) => xml.match(/<zeebe:subscription [^>]*>/g) ?? [];

test('the start message the process already has gets the correlation key', () => {
  const xml = processWith('<bpmn:message id="Msg1" name="acme-demo" />',
    '<bpmn:startEvent id="StartStartEvent"><bpmn:messageEventDefinition id="StartDef" messageRef="Msg1" /></bpmn:startEvent>');
  const r = applyPattern(xml, def, 'c8', null);
  assert.deepEqual(r.issues, []);
  assert.ok(r.changed);
  // one message - the existing one, now with the subscription; the event subprocess refers to it
  assert.equal((r.xml.match(/<bpmn:message /g) ?? []).length, 1);
  assert.match(r.xml, /<bpmn:message [^>]*id="Msg1"[^>]*>\s*<bpmn:extensionElements>\s*<zeebe:subscription correlationKey="=businessKey"\s*\/>/);
  assert.match(r.xml, /isInterrupting="false">\s*<bpmn:messageEventDefinition [^>]*messageRef="Msg1"/);
  assert.ok(detectPatterns(r.xml, [def], 'c8').hits.some(h => h.patternId === 'unique-execution'));
});

test('without a message start the process gets one - with the correlation key', () => {
  const r = applyPattern(processWith('', '<bpmn:startEvent id="StartStartEvent" />'), def, 'c8', null);
  assert.deepEqual(r.issues, []);
  assert.equal(subscriptions(r.xml).length, 1);
  assert.match(r.xml, /<bpmn:message [^>]*name="acme-demo"[^>]*>\s*<bpmn:extensionElements>\s*<zeebe:subscription correlationKey="=businessKey"/);
});

test('an existing correlation key stays as it is - not a second one', () => {
  const xml = processWith(
    '<bpmn:message id="Msg1" name="acme-demo"><bpmn:extensionElements><zeebe:subscription correlationKey="=clientKey" /></bpmn:extensionElements></bpmn:message>',
    '<bpmn:startEvent id="StartStartEvent"><bpmn:messageEventDefinition id="StartDef" messageRef="Msg1" /></bpmn:startEvent>');
  const r = applyPattern(xml, def, 'c8', null);
  assert.deepEqual(r.issues, []);
  assert.deepEqual(subscriptions(r.xml), ['<zeebe:subscription correlationKey="=clientKey" />']);
});
