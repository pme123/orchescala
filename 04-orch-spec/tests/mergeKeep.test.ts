// Ein Abgleich ohne (oder mit veraltetem) Bezug-BPMN: steht im Diagramm genau, was
// die Spezifikation hineinschreibt, hat es nichts geändert — die abgewählten Zeilen
// und die Ausgaben des Services bleiben, der Status auch (nicht «Angepasst»).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { allSteps, importBpmn, mergeSpec } from '../src/bpmn';

(globalThis as unknown as { DOMParser: unknown }).DOMParser = DOMParser;

const bpmn = (master: string) => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="d" targetNamespace="x">
  <bpmn:process id="acme-demo-clientV1" isExecutable="true">
    <bpmn:startEvent id="StartEvent"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:serviceTask id="UpdateClientTask" name="Update client" camunda:type="external" camunda:topic="acme-fil-clientV1.PutClientsClientKey">
      <bpmn:extensionElements>
        <camunda:inputOutput>
          <camunda:inputParameter name="clientKey">#{clientKey}</camunda:inputParameter>
          <camunda:inputParameter name="master">${master}</camunda:inputParameter>
          <camunda:inputParameter name="_manualOutMapping">#{true}</camunda:inputParameter>
          <camunda:inputParameter name="_outputVariables">resourceUri</camunda:inputParameter>
          <camunda:outputParameter name="resourceUriUpdate">#{resourceUri}</camunda:outputParameter>
        </camunda:inputOutput>
      </bpmn:extensionElements>
      <bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing>
    </bpmn:serviceTask>
    <bpmn:endEvent id="EndEvent"><bpmn:incoming>f2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="f1" sourceRef="StartEvent" targetRef="UpdateClientTask"/>
    <bpmn:sequenceFlow id="f2" sourceRef="UpdateClientTask" targetRef="EndEvent"/>
  </bpmn:process>
</bpmn:definitions>`;

const task = (s: ReturnType<typeof importBpmn>['spec']) => allSteps(s.steps).find(x => x.id === 'UpdateClientTask')!;

/** wie nach dem Öffnen: abgewählte Zeilen aus dem Katalog, eine Ausgabe des Services — und abgenommen */
function accepted() {
  const spec = importBpmn(bpmn('${masterRead.prop("clientSegment", 10)}'), 'p').spec;
  const t = task(spec);
  t.inputs = [...t.inputs!, { name: 'useCase', expression: '= useCase', disabled: true }];
  t.outputs = [...t.outputs!, { name: 'person', expression: '= person', disabled: true, fromService: true }];
  t.status = 'accepted';
  return spec;
}

test('without base: the same diagram keeps the spec rows and the status', () => {
  const { spec, report } = mergeSpec(importBpmn(bpmn('${masterRead.prop("clientSegment", 10)}'), 'p').spec, accepted(), null);
  assert.deepEqual(report.changed, []);
  assert.equal(task(spec).status, 'accepted');
  assert.ok(task(spec).inputs!.some(m => m.name === 'useCase' && m.disabled));
  assert.ok(task(spec).outputs!.some(m => m.name === 'person' && m.fromService));
});

test('without base: a real change in the diagram still counts', () => {
  const { spec, report } = mergeSpec(importBpmn(bpmn('${masterRead.prop("clientSegment", 20)}'), 'p').spec, accepted(), null);
  assert.deepEqual(report.changed, ['Update client']);
  assert.equal(task(spec).status, 'changed');
});
