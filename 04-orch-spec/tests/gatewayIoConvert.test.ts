// Camunda 8 → 7: an ioMapping on a gateway is not taken over — Camunda 7 rejects
// an inputOutput there (ENGINE-09005), Zeebe ignores it. A comment and an issue remain.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { convertBpmn } from '../src/engineConvert';
import { installXmlNamespaces } from './xmlNamespaces';

const g = globalThis as unknown as Record<string, unknown>;
g.DOMParser ??= DOMParser;
g.XMLSerializer ??= class { serializeToString(doc: { toString(): string }) { return doc.toString(); } };
installXmlNamespaces();

const c8 = (gateway: string, task = '') => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:zeebe="http://camunda.org/schema/zeebe/1.0" xmlns:modeler="http://camunda.org/schema/modeler/1.0" modeler:executionPlatform="Camunda Cloud" id="d" targetNamespace="x">
  <bpmn:process id="p" isExecutable="true">
    <bpmn:startEvent id="s"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    ${gateway}
    <bpmn:serviceTask id="t" name="Check"><bpmn:extensionElements><zeebe:taskDefinition type="check" />${task}</bpmn:extensionElements><bpmn:incoming>f2</bpmn:incoming><bpmn:outgoing>f3</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:endEvent id="e"><bpmn:incoming>f3</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="gw" />
    <bpmn:sequenceFlow id="f2" sourceRef="gw" targetRef="t" />
    <bpmn:sequenceFlow id="f3" sourceRef="t" targetRef="e" />
  </bpmn:process>
</bpmn:definitions>`;

const io = '<bpmn:extensionElements><zeebe:ioMapping><zeebe:input source="=1" target="limit" /><zeebe:output source="=count + 1" target="count" /></zeebe:ioMapping></bpmn:extensionElements>';

for (const kind of ['exclusiveGateway', 'parallelGateway', 'inclusiveGateway']) {
  test(`C8 -> C7: an ioMapping on a ${kind} - the output an end listener, the input a comment`, () => {
    const r = convertBpmn(c8(`<bpmn:${kind} id="gw">${io}<bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing></bpmn:${kind}>`), 'c7');
    const gw = r.xml.slice(r.xml.indexOf(`<bpmn:${kind}`), r.xml.indexOf(`</bpmn:${kind}>`));
    assert.ok(!gw.includes('camunda:inputOutput'), gw);
    const listener = /<camunda:executionListener [^>]*\/>/.exec(gw)?.[0] ?? '';
    assert.ok(listener.includes('event="end"'), gw);
    assert.ok(/expression="\$\{execution\.setVariable\((&#34;|&quot;|")count(&#34;|&quot;|"), count \+ 1\)\}"/.test(listener), gw);
    assert.ok(gw.includes('nicht übernommen: zeebe:input source="=1" target="limit"'), gw);
    assert.ok(!gw.includes('zeebe:output'), gw);
    const issues = r.issues.filter(i => i.stepId === 'gw' && i.where === 'Mapping').map(i => i.text);
    assert.equal(issues.length, 2, JSON.stringify(r.issues));
    assert.ok(issues[0].includes('«count» als End-Listener'), issues[0]);
    assert.ok(issues[1].includes('«limit» NICHT übernommen'), issues[1]);
  });
}

test('C8 -> C7: only outputs on a gateway - only a listener, no comment', () => {
  const r = convertBpmn(c8('<bpmn:exclusiveGateway id="gw"><bpmn:extensionElements><zeebe:ioMapping><zeebe:output source="=count + 1" target="count" /></zeebe:ioMapping></bpmn:extensionElements><bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing></bpmn:exclusiveGateway>'), 'c7');
  const gw = r.xml.slice(r.xml.indexOf('<bpmn:exclusiveGateway'), r.xml.indexOf('</bpmn:exclusiveGateway>'));
  assert.ok(gw.includes('camunda:executionListener'), gw);
  assert.ok(!gw.includes('<!--'), gw);
  assert.equal(r.issues.filter(i => i.stepId === 'gw').length, 1, JSON.stringify(r.issues));
});

test('C8 -> C7: an ioMapping on a task still becomes an inputOutput', () => {
  const r = convertBpmn(c8('<bpmn:exclusiveGateway id="gw"><bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing></bpmn:exclusiveGateway>',
    '<zeebe:ioMapping><zeebe:output source="=count + 1" target="count" /></zeebe:ioMapping>'), 'c7');
  assert.ok(/<camunda:outputParameter name="count">\$\{count \+ 1\}<\/camunda:outputParameter>/.test(r.xml), r.xml);
  assert.ok(!r.issues.some(i => i.where === 'Mapping'), JSON.stringify(r.issues));
});
