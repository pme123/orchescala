// `….numberValue().intValue()` im BPMN (Camunda 7, Spin) ist in FEEL einfach die
// Zahl — FEEL hat nur einen Zahlentyp; `number(…)` liest dort Text. Und zurück.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { importBpmn, mergeSpec, allSteps } from '../src/bpmn';
import { feelToJuel } from '../src/feelJuel';
import { importExpression } from '../src/juelFeel';

(globalThis as unknown as { DOMParser: unknown }).DOMParser = DOMParser;

const juel = '${ masterRead.hasProp("clientSegment") && !masterRead.prop("clientSegment").isNull() ? masterRead.prop("clientSegment").numberValue().intValue() : null }';
const feel = '= if masterRead.clientSegment != null then masterRead.clientSegment else null';

test('import: intValue() / longValue() / doubleValue() is the number itself', () => {
  assert.equal(importExpression(juel), feel);
  assert.equal(importExpression('${amount.longValue() + 1}'), '= amount + 1');
});

test('export: the imported value goes back to JUEL', () => {
  assert.equal(feelToJuel(feel.slice(1)).ok, true);
});

const bpmn = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="d" targetNamespace="x">
  <bpmn:process id="acme-demo-segmentV1" isExecutable="true">
    <bpmn:startEvent id="StartEvent"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:serviceTask id="ReadTask" name="Read" camunda:type="external" camunda:topic="acme-demo-read">
      <bpmn:extensionElements>
        <camunda:inputOutput>
          <camunda:outputParameter name="clientSegment">${juel.replace(/&/g, '&amp;')}</camunda:outputParameter>
        </camunda:inputOutput>
      </bpmn:extensionElements>
      <bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing>
    </bpmn:serviceTask>
    <bpmn:endEvent id="EndEvent"><bpmn:incoming>f2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="f1" sourceRef="StartEvent" targetRef="ReadTask"/>
    <bpmn:sequenceFlow id="f2" sourceRef="ReadTask" targetRef="EndEvent"/>
  </bpmn:process>
</bpmn:definitions>`;

test('merge: number(…) from an older import becomes what the diagram reads today', () => {
  const fresh = importBpmn(bpmn, 'segment').spec;
  const step = (s: typeof fresh) => allSteps(s.steps).find(x => x.id === 'ReadTask')!;
  const out = (s: typeof fresh) => step(s).outputs?.find(m => m.name === 'clientSegment')?.expression;
  assert.equal(out(fresh), feel);
  const previous = structuredClone(fresh);
  const old = '= if masterRead.clientSegment != null then number(masterRead.clientSegment) else null';
  step(previous).outputs = step(previous).outputs!.map(m => (m.name === 'clientSegment' ? { ...m, expression: old } : m));
  assert.equal(out(mergeSpec(importBpmn(bpmn, 'segment').spec, previous, fresh).spec), feel);
  // was jemand selbst so geschrieben hat und das Diagramm anders liest, bleibt
  step(previous).outputs = step(previous).outputs!.map(m => (m.name === 'clientSegment' ? { ...m, expression: '= number(masterRead.text)' } : m));
  assert.equal(out(mergeSpec(importBpmn(bpmn, 'segment').spec, previous, fresh).spec), '= number(masterRead.text)');
});
