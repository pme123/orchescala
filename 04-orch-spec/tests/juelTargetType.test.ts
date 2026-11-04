// Camunda 7: a Spin path of unknown type (`printContent.content.docId`, the fields of
// `printContent` are not described) used to end without a value —
// `${printContent.prop("content").prop("docId")}` hands the JSON node to the
// called process, not the String. The target field knows the type: `docId: String`
// → `stringValue()`; an optional target first checks the last step, since
// `stringValue()` on a missing or null field throws.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { allSteps, importBpmn } from '../src/bpmn';
import { writeBpmn } from '../src/bpmnWrite';
import { feelToJuel } from '../src/feelJuel';
import type { Model } from '../src/types';

(globalThis as unknown as { DOMParser: unknown }).DOMParser = DOMParser;
(globalThis as unknown as { XMLSerializer: unknown }).XMLSerializer = class { serializeToString(n: Node) { return String(n); } };

const juel = (body: string, target: { type: 'string' | 'number' | 'boolean'; optional: boolean } | null) =>
  (feelToJuel(body, { target }) as { juel: string }).juel;

test('unknown path: the target type decides the end', () => {
  assert.equal(juel('printContent.content.docId', null), 'printContent.prop("content").prop("docId")');
  assert.equal(juel('printContent.content.docId', { type: 'string', optional: false }), 'printContent.prop("content").prop("docId").stringValue()');
  assert.equal(juel('printContent.content.count', { type: 'number', optional: false }), 'printContent.prop("content").prop("count").numberValue()');
});

test('unknown path into an optional target: the last step is checked first', () => {
  assert.equal(juel('printContent.content.docId', { type: 'string', optional: true }),
    '(printContent.prop("content").hasProp("docId") && !printContent.prop("content").prop("docId").isNull() ? printContent.prop("content").prop("docId").stringValue() : null)');
});

test('a known source type wins, and only the whole expression takes the target', () => {
  const vars = [{ name: 'card', type: 'context' as const, label: 'Card', source: 'In', children: [{ name: 'key', type: 'number' as const, label: 'Long', source: 'In' }] }];
  assert.equal((feelToJuel('card.key', { vars, target: { type: 'string', optional: false } }) as { juel: string }).juel, 'card.prop("key").numberValue()');
  // inside a calculation the path is not the value of the target
  assert.equal(juel('a.b + 1', { type: 'string', optional: false }), 'a.prop("b").value() + 1');
});

const bpmn = (source: string) => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="d" targetNamespace="x">
  <bpmn:process id="acme-demo-printV1" isExecutable="true">
    <bpmn:startEvent id="StartEvent"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:callActivity id="ArchiveCallActivity" name="Archive" calledElement="acme-demo-archive">
      <bpmn:extensionElements>${source}</bpmn:extensionElements>
      <bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing>
    </bpmn:callActivity>
    <bpmn:endEvent id="EndEvent"><bpmn:incoming>f2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="f1" sourceRef="StartEvent" targetRef="ArchiveCallActivity"/>
    <bpmn:sequenceFlow id="f2" sourceRef="ArchiveCallActivity" targetRef="EndEvent"/>
  </bpmn:process>
</bpmn:definitions>`;

const model = (docId: string) => ({
  domainTypes: [
    { id: 'acme.demo.Archive', name: 'Archive', pkg: 'acme.demo', kind: 'case', importPath: 'acme.demo.Archive', processName: 'acme-demo-archive', owner: 'Archive' },
    { id: 'acme.demo.Archive.In', name: 'Archive.In', pkg: 'acme.demo', kind: 'member', owner: 'Archive', importPath: 'acme.demo.Archive',
      fields: [{ name: 'docId', type: docId }] },
  ],
}) as unknown as Model;

const exported = (docId: string, existing = '') => {
  const xml = bpmn(existing);
  const spec = importBpmn(xml, 'print').spec;
  const step = allSteps(spec.steps).find(s => s.id === 'ArchiveCallActivity')!;
  step.inputs = [{ name: 'docId', expression: '= printContent.content.docId' }];
  return writeBpmn(xml, spec, model(docId)).xml.replace(/&quot;/g, '"');
};

test('export: the In of the called process gives the type', () => {
  assert.ok(exported('String').includes('sourceExpression="${printContent.prop("content").prop("docId").stringValue()}"'), exported('String'));
  const opt = exported('Option[String]');
  assert.ok(opt.includes('printContent.prop("content").hasProp("docId") &amp;&amp; !printContent.prop("content").prop("docId").isNull() ? printContent.prop("content").prop("docId").stringValue() : null'), opt);
});

test('export: an existing row without the end is written anew', () => {
  const old = '<camunda:in sourceExpression="${printContent.prop(&quot;content&quot;).prop(&quot;docId&quot;)}" target="docId" />';
  assert.ok(exported('String', old).includes('.prop("docId").stringValue()}'), exported('String', old));
  assert.ok(exported('Option[String]', old).includes('.hasProp("docId")'), exported('Option[String]', old));
});
