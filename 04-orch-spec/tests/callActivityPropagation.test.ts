// Ein Teilprozess in Camunda 8: Orchescala mappt explizit — nie alle Variablen, in keine Richtung.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { importBpmn } from '../src/bpmn';
import { writeBpmn } from '../src/bpmnWrite';
import { convertBpmn } from '../src/engineConvert';
import { installXmlNamespaces } from './xmlNamespaces';

const g = globalThis as unknown as Record<string, unknown>;
g.DOMParser ??= DOMParser;
g.XMLSerializer ??= class { serializeToString(doc: { toString(): string }) { return doc.toString(); } };
installXmlNamespaces();

const flow = (call: string, ns: string) => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" ${ns} id="d" targetNamespace="x">
  <bpmn:process id="acme-demo-parentV1" isExecutable="true">
    <bpmn:startEvent id="StartEvent"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    ${call}
    <bpmn:endEvent id="EndEvent"><bpmn:incoming>f2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="f1" sourceRef="StartEvent" targetRef="CallTask"/>
    <bpmn:sequenceFlow id="f2" sourceRef="CallTask" targetRef="EndEvent"/>
  </bpmn:process>
</bpmn:definitions>`;
const C8 = 'xmlns:zeebe="http://camunda.org/schema/zeebe/1.0" xmlns:modeler="http://camunda.org/schema/modeler/1.0" modeler:executionPlatform="Camunda Cloud"';
const C7 = 'xmlns:camunda="http://camunda.org/schema/1.0/bpmn"';
const propagation = (xml: string) => [/propagateAllParentVariables="(\w+)"/.exec(xml)?.[1], /propagateAllChildVariables="(\w+)"/.exec(xml)?.[1]];

test('export C8: a call activity never propagates all variables', () => {
  const xml = flow(`<bpmn:callActivity id="CallTask" name="Call"><bpmn:extensionElements><zeebe:calledElement processId="acme-demo-childV1" propagateAllChildVariables="true" /></bpmn:extensionElements><bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing></bpmn:callActivity>`, C8);
  const out = writeBpmn(xml, importBpmn(xml, 'parent').spec).xml;
  assert.deepEqual(propagation(out), ['false', 'false']);
});

test('C7 -> C8: variables="all" becomes false - and is reported', () => {
  const xml = flow(`<bpmn:callActivity id="CallTask" name="Call" calledElement="acme-demo-childV1"><bpmn:extensionElements><camunda:in variables="all" /><camunda:out variables="all" /></bpmn:extensionElements><bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing></bpmn:callActivity>`, C7);
  const conv = convertBpmn(xml, 'c8');
  assert.deepEqual(propagation(conv.xml), ['false', 'false']);
  assert.equal(conv.issues.filter(i => i.where === 'Teilprozess').length, 2);
});
