// Die Reihenfolge nach dem BPMN-Schema: Camunda 7 lehnt sonst das Deployment ab
// (ENGINE-09005) — etwa nach dem Einfügen eines Patterns ohne den Modeler.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { orderBpmn } from '../src/xmlFormat';

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="d" targetNamespace="x">
  <bpmn:process id="p" isExecutable="true">
    <bpmn:serviceTask id="t" camunda:type="external" camunda:topic="p"><bpmn:outgoing>f</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:association id="a" sourceRef="n" targetRef="t"/>
    <bpmn:textAnnotation id="n"><bpmn:text>Hinweis</bpmn:text></bpmn:textAnnotation>
    <bpmn:boundaryEvent id="b" attachedToRef="t">
      <bpmn:errorEventDefinition id="bd"/>
      <bpmn:outgoing>f</bpmn:outgoing>
      <bpmn:extensionElements><camunda:executionListener expression="x" event="start"/></bpmn:extensionElements>
    </bpmn:boundaryEvent>
    <bpmn:endEvent id="e"><bpmn:incoming>f</bpmn:incoming></bpmn:endEvent>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="dd"/>
  <bpmn:error id="err" errorCode="output-mocked"/>
</bpmn:definitions>`;

const names = (el: Element) => Array.from(el.children).map(c => c.tagName.split(':').pop());

test('artifacts after the flow elements, event definitions after incoming/outgoing, the diagram last', () => {
  const doc = new DOMParser().parseFromString(xml, 'text/xml') as unknown as Document;
  orderBpmn(doc);
  const defs = doc.documentElement;
  assert.deepEqual(names(defs), ['process', 'error', 'BPMNDiagram']);
  const proc = defs.children[0];
  assert.deepEqual(names(proc), ['serviceTask', 'boundaryEvent', 'endEvent', 'association', 'textAnnotation']);
  const boundary = proc.children[1];
  assert.deepEqual(names(boundary), ['extensionElements', 'outgoing', 'errorEventDefinition']);
  // in den Erweiterungen bleibt alles, wie es ist
  assert.equal(boundary.children[0].children[0].tagName, 'camunda:executionListener');
});

test('nothing to do - nothing changes', () => {
  const ok = xml.replace(/<bpmn:association[^>]*\/>\n\s*<bpmn:textAnnotation[\s\S]*?<\/bpmn:textAnnotation>\n/, '');
  const doc = new DOMParser().parseFromString(ok, 'text/xml') as unknown as Document;
  const before = doc.documentElement.children[0].children[0].outerHTML;
  orderBpmn(doc);
  assert.equal(doc.documentElement.children[0].children[0].outerHTML, before);
});
