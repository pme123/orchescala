// Die eigene processInstanceId in Camunda 8 — und Signalnamen mit einer ID darin.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { allSteps, importBpmn } from '../src/bpmn';
import { convertBpmn } from '../src/engineConvert';
import { collectFindings } from '../src/findings';
import type { ProcessSpec } from '../src/types';
import { installXmlNamespaces } from './xmlNamespaces';

const g = globalThis as unknown as Record<string, unknown>;
g.DOMParser ??= DOMParser;
g.XMLSerializer ??= class { serializeToString(doc: { toString(): string }) { return doc.toString(); } };
installXmlNamespaces();

const PID = 'acme-demo-escalationV1';
const c7 = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="d" targetNamespace="x">
  <bpmn:process id="${PID}" isExecutable="true">
    <bpmn:startEvent id="StartEvent"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:serviceTask id="InitProcessTask" name="Init Process" camunda:type="external" camunda:topic="${PID}">
      <bpmn:extensionElements><camunda:inputOutput>
        <camunda:inputParameter name="processInstanceId">\${execution.processInstanceId}</camunda:inputParameter>
      </camunda:inputOutput></bpmn:extensionElements>
      <bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing>
    </bpmn:serviceTask>
    <bpmn:intermediateThrowEvent id="CancelEvent" name="cancel"><bpmn:incoming>f2</bpmn:incoming><bpmn:outgoing>f3</bpmn:outgoing>
      <bpmn:signalEventDefinition id="sd" signalRef="Sig"/>
    </bpmn:intermediateThrowEvent>
    <bpmn:endEvent id="EndEvent"><bpmn:incoming>f3</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="f1" sourceRef="StartEvent" targetRef="InitProcessTask"/>
    <bpmn:sequenceFlow id="f2" sourceRef="InitProcessTask" targetRef="CancelEvent"/>
    <bpmn:sequenceFlow id="f3" sourceRef="CancelEvent" targetRef="EndEvent"/>
  </bpmn:process>
  <bpmn:signal id="Sig" name="valiant-cancel-\${mainProcessInstanceId}" />
</bpmn:definitions>`;

const signalName = (xml: string) => /<bpmn:signal id="Sig" name="([^"]*)"/.exec(xml)?.[1]?.replace(/&quot;|&#34;/g, '"');

test('C7 -> C8 -> C7: a signal name with an expression becomes FEEL - and back JUEL', () => {
  const c8 = convertBpmn(c7, 'c8').xml;
  assert.equal(signalName(c8), '="valiant-cancel-" + string(mainProcessInstanceId)');
  // zurück JUEL — gleichwertig zum Original
  assert.equal(signalName(convertBpmn(c8, 'c7').xml), '${"valiant-cancel-".concat(mainProcessInstanceId)}');
});

test('C8: the InitWorker reading processInstanceId at its own task is reported - it is still empty there', () => {
  const warningsOf = (spec: ProcessSpec) => collectFindings(spec, null, allSteps(spec.steps)).get('InitProcessTask')?.warnings ?? [];
  const c8 = importBpmn(convertBpmn(c7, 'c8').xml, 'escalation').spec;
  assert.equal(c8.engine, 'c8');
  assert.ok(warningsOf(c8).some(w => w.includes('processInstanceId') && w.includes('leer')));
  // in Camunda 7 ist execution.processInstanceId schon da
  assert.ok(!warningsOf(importBpmn(c7, 'escalation').spec).some(w => w.includes('leer')));
});
