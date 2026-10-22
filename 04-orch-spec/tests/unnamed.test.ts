// An element without a label in the BPMN is named in the flow like its ID (`Activity_04tlno2`) —
// that reports a warning; a name from the specification is kept on reconciliation and
// goes into the BPMN as a label on export.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { allSteps, importBpmn, mergeSpec } from '../src/bpmn';
import { writeBpmn } from '../src/bpmnWrite';
import { collectFindings } from '../src/findings';

(globalThis as unknown as { DOMParser: unknown }).DOMParser = DOMParser;
// linkedom has no XMLSerializer — `toString()` returns the XML
(globalThis as unknown as { XMLSerializer: unknown }).XMLSerializer = class { serializeToString(n: Node) { return String(n); } };

const bpmn = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d" targetNamespace="x">
  <bpmn:process id="acme-demo-unnamedV1" isExecutable="true">
    <bpmn:startEvent id="StartEvent"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:subProcess id="Activity_04tlno2">
      <bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing>
      <bpmn:startEvent id="SubStart"><bpmn:outgoing>s1</bpmn:outgoing></bpmn:startEvent>
      <bpmn:endEvent id="SubEnd"><bpmn:incoming>s1</bpmn:incoming></bpmn:endEvent>
      <bpmn:sequenceFlow id="s1" sourceRef="SubStart" targetRef="SubEnd"/>
    </bpmn:subProcess>
    <bpmn:endEvent id="EndEvent"><bpmn:incoming>f2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="f1" sourceRef="StartEvent" targetRef="Activity_04tlno2"/>
    <bpmn:sequenceFlow id="f2" sourceRef="Activity_04tlno2" targetRef="EndEvent"/>
  </bpmn:process>
</bpmn:definitions>`;

const sub = (s: ReturnType<typeof importBpmn>['spec']) => allSteps(s.steps).find(x => x.id === 'Activity_04tlno2')!;

test('a step without label warns; start and end do not', () => {
  const spec = importBpmn(bpmn, 'unnamed').spec;
  assert.equal(sub(spec).name, 'Activity_04tlno2');
  const findings = collectFindings(spec, null, allSteps(spec.steps));
  assert.ok(findings.get('Activity_04tlno2')?.warnings.some(w => w.startsWith('Kein Name')));
  assert.ok(!findings.get('StartEvent')?.warnings.some(w => w.startsWith('Kein Name')));
  assert.ok(!findings.get('EndEvent')?.warnings.some(w => w.startsWith('Kein Name')));
});

test('a name from the spec stays on merge and goes into the BPMN on export', () => {
  const previous = importBpmn(bpmn, 'unnamed').spec;
  sub(previous).name = 'Check Age';
  // reconciling with the unchanged BPMN keeps the name
  assert.equal(sub(mergeSpec(importBpmn(bpmn, 'unnamed').spec, previous).spec).name, 'Check Age');
  // the export writes it as a label — start and end get no substitute name
  const xml = writeBpmn(bpmn, previous).xml;
  assert.match(xml, /<bpmn:subProcess [^>]*name="Check Age"/);
  assert.match(xml, /<bpmn:startEvent id="StartEvent">/);
  assert.equal(sub(importBpmn(xml, 'unnamed').spec).name, 'Check Age');
});
