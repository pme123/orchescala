// A boundary event without a name gets one on writing (`label-required`).
// Its label position in the diagram was never visible until then — often a leftover from
// earlier, somewhere off to the side. It is dropped; the modeler places the label anew.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { importBpmn } from '../src/bpmn';
import { writeBpmn } from '../src/bpmnWrite';

(globalThis as unknown as { DOMParser: unknown }).DOMParser = DOMParser;
(globalThis as unknown as { XMLSerializer: unknown }).XMLSerializer = class { serializeToString(n: Node) { return String(n); } };

const bpmn = (boundaryName: string) => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" id="d" targetNamespace="x">
  <bpmn:process id="acme-demo-labelV1" isExecutable="true">
    <bpmn:startEvent id="StartEvent"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:serviceTask id="InitProcessTask" name="Init Process"><bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:endEvent id="EndEvent" name="done"><bpmn:incoming>f2</bpmn:incoming></bpmn:endEvent>
    <bpmn:boundaryEvent id="MockedBoundaryEvent"${boundaryName} attachedToRef="InitProcessTask">
      <bpmn:errorEventDefinition id="ed" errorRef="MockedError" />
    </bpmn:boundaryEvent>
    <bpmn:sequenceFlow id="f1" sourceRef="StartEvent" targetRef="InitProcessTask"/>
    <bpmn:sequenceFlow id="f2" sourceRef="InitProcessTask" targetRef="EndEvent"/>
  </bpmn:process>
  <bpmn:error id="MockedError" name="output-mocked" errorCode="output-mocked" />
  <bpmndi:BPMNDiagram id="D"><bpmndi:BPMNPlane id="P" bpmnElement="acme-demo-labelV1">
    <bpmndi:BPMNShape id="Boundary_di" bpmnElement="MockedBoundaryEvent">
      <dc:Bounds x="402" y="241" width="36" height="36" />
      <bpmndi:BPMNLabel><dc:Bounds x="453" y="193" width="73" height="14" /></bpmndi:BPMNLabel>
    </bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="End_di" bpmnElement="EndEvent">
      <dc:Bounds x="600" y="200" width="36" height="36" />
      <bpmndi:BPMNLabel><dc:Bounds x="605" y="243" width="26" height="14" /></bpmndi:BPMNLabel>
    </bpmndi:BPMNShape>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`;

test('a boundary event named on write loses the old label position - the modeler places it anew', () => {
  const xml = writeBpmn(bpmn(''), importBpmn(bpmn(''), 'label').spec).xml;
  assert.match(xml, /<bpmn:boundaryEvent [^>]*name="output-mocked"/);
  assert.doesNotMatch(xml, /x="453"/);
  // the shape stays where it is — and so does a label that already applied
  assert.match(xml, /x="402" y="241"/);
  assert.match(xml, /x="605" y="243"/);
});

test('a boundary event with a name keeps its label where it is', () => {
  const named = bpmn(' name="output-mocked"');
  const xml = writeBpmn(named, importBpmn(named, 'label').spec).xml;
  assert.match(xml, /x="453" y="193"/);
});
