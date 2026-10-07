// `${JSON('[6026, 102]')}` im BPMN (Camunda 7, Spin) ist in FEEL die Liste
// `[6026, 102]` — nicht der Text "[6026, 102]". Und zurück.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { importBpmn, mergeSpec, allSteps } from '../src/bpmn';
import { feelToJuel } from '../src/feelJuel';
import { importExpression } from '../src/juelFeel';

(globalThis as unknown as { DOMParser: unknown }).DOMParser = DOMParser;

test('import: JSON(…) / S(…) with a JSON list or object is the FEEL literal', () => {
  assert.equal(importExpression("${JSON('[6026, 102, 6027, 302, 6092]')}"), '= [6026, 102, 6027, 302, 6092]');
  assert.equal(importExpression("${S('{\"a\": 1, \"b-c\": [\"x\", true, null]}')}"), '= {a: 1, "b-c": ["x", true, null]}');
  assert.equal(importExpression("${JSON('[]')}"), '= []');
});

test('export: a list or context of constants is JSON(…) - with variables it is not JUEL', () => {
  assert.deepEqual(feelToJuel('[6026, 102]'), { ok: true, juel: "JSON('[6026, 102]')" });
  assert.deepEqual(feelToJuel('{a: 1, "b-c": "it\'s"}'), { ok: true, juel: `JSON('{"a": 1, "b-c": "it\\'s"}')` });
  assert.equal(feelToJuel('[a, 1]').ok, false);
});

const bpmn = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="d" targetNamespace="x">
  <bpmn:process id="acme-demo-loadV1" isExecutable="true">
    <bpmn:startEvent id="StartEvent"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:callActivity id="LoadPoasCallActivity" name="Load Poas" calledElement="acme-demo-loadPoas">
      <bpmn:extensionElements>
        <camunda:in sourceExpression="\${JSON('[90]')}" target="poaStatuses"/>
      </bpmn:extensionElements>
      <bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing>
    </bpmn:callActivity>
    <bpmn:endEvent id="EndEvent"><bpmn:incoming>f2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="f1" sourceRef="StartEvent" targetRef="LoadPoasCallActivity"/>
    <bpmn:sequenceFlow id="f2" sourceRef="LoadPoasCallActivity" targetRef="EndEvent"/>
  </bpmn:process>
</bpmn:definitions>`;

test('merge: a row stored as JSON text earlier becomes the list the diagram has', () => {
  const fresh = importBpmn(bpmn, 'load').spec;
  const step = (s: typeof fresh) => allSteps(s.steps).find(x => x.id === 'LoadPoasCallActivity')!;
  assert.equal(step(fresh).inputs?.find(m => m.name === 'poaStatuses')?.expression, '= [90]');
  // die Spezifikation von früher: derselbe Wert als Text
  const previous = structuredClone(fresh);
  step(previous).inputs = step(previous).inputs!.map(m => (m.name === 'poaStatuses' ? { ...m, expression: '= "[90]"' } : m));
  const merged = mergeSpec(importBpmn(bpmn, 'load').spec, previous, fresh).spec;
  assert.equal(step(merged).inputs?.find(m => m.name === 'poaStatuses')?.expression, '= [90]');
});
