// Camunda 7 → 8: ein Listener, der nur eine Variable setzt, wird ein Output-Mapping —
// am Element, wo es greift, sonst an einem None-Throw-Event davor oder danach.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { convertBpmn } from '../src/engineConvert';
import { installXmlNamespaces } from './xmlNamespaces';

const g = globalThis as unknown as Record<string, unknown>;
g.DOMParser ??= DOMParser;
g.XMLSerializer ??= class { serializeToString(doc: { toString(): string }) { return doc.toString(); } };
installXmlNamespaces();

const listener = (name: string, value: string, event = 'start') =>
  `<bpmn:extensionElements><camunda:executionListener expression="\${execution.setVariable(&#34;${name}&#34;, ${value})}" event="${event}" /></bpmn:extensionElements>`;

/** start → (body) → end, mit Diagramm für den ersten und letzten Fluss */
const c7 = (body: string, flows: string, di = '') => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" id="d" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:error id="err" name="failed" errorCode="failed" />
  <bpmn:process id="p" isExecutable="true">
    ${body}
    ${flows}
  </bpmn:process>
  <bpmndi:BPMNDiagram id="dia"><bpmndi:BPMNPlane id="plane" bpmnElement="p">
    <bpmndi:BPMNShape id="s_di" bpmnElement="s"><dc:Bounds x="100" y="100" width="36" height="36" /></bpmndi:BPMNShape>
    ${di}
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`;

const parse = (xml: string) => new DOMParser().parseFromString(xml, 'text/xml') as unknown as Document;
const byId = (doc: Document, id: string) => Array.from(doc.querySelectorAll('*')).find(e => e.getAttribute('id') === id);
const named = (doc: Document, local: string) => Array.from(doc.querySelectorAll('*')).filter(e => e.localName === local || e.tagName.endsWith(`:${local}`));
const outputsOf = (el: Element | undefined) =>
  el ? Array.from(el.querySelectorAll('*')).filter(e => e.tagName === 'zeebe:output').map(o => `${o.getAttribute('target')}=${o.getAttribute('source')}`) : [];

test('a start listener on an event-based gateway: a None-Throw-Event before it - Zeebe ignores an ioMapping on a gateway', () => {
  const xml = c7(`
    <bpmn:startEvent id="s"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:eventBasedGateway id="gw">${listener('readyForEvents', 'true')}<bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing><bpmn:outgoing>f3</bpmn:outgoing></bpmn:eventBasedGateway>
    <bpmn:intermediateCatchEvent id="t1"><bpmn:incoming>f2</bpmn:incoming><bpmn:timerEventDefinition><bpmn:timeDuration>PT1H</bpmn:timeDuration></bpmn:timerEventDefinition></bpmn:intermediateCatchEvent>
    <bpmn:intermediateCatchEvent id="t2"><bpmn:incoming>f3</bpmn:incoming><bpmn:timerEventDefinition><bpmn:timeDuration>PT2H</bpmn:timeDuration></bpmn:timerEventDefinition></bpmn:intermediateCatchEvent>`,
  `<bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="gw" />
    <bpmn:sequenceFlow id="f2" sourceRef="gw" targetRef="t1" />
    <bpmn:sequenceFlow id="f3" sourceRef="gw" targetRef="t2" />`,
  `<bpmndi:BPMNShape id="gw_di" bpmnElement="gw"><dc:Bounds x="300" y="93" width="50" height="50" /></bpmndi:BPMNShape>
    <bpmndi:BPMNEdge id="f1_di" bpmnElement="f1"><di:waypoint x="136" y="118" /><di:waypoint x="300" y="118" /></bpmndi:BPMNEdge>`);
  const r = convertBpmn(xml, 'c8');
  const doc = parse(r.xml);
  const ev = byId(doc, 'gw_SetBefore');
  assert.ok(ev, r.xml);
  assert.equal(ev.tagName, 'bpmn:intermediateThrowEvent');
  assert.deepEqual(outputsOf(ev), ['readyForEvents==true']);
  assert.deepEqual(outputsOf(byId(doc, 'gw')), [], 'no ioMapping on the gateway');
  // the flows: start → event → gateway
  assert.equal(byId(doc, 'f1')?.getAttribute('targetRef'), 'gw_SetBefore');
  const nf = byId(doc, 'gw_SetBefore_Flow');
  assert.equal(nf?.getAttribute('sourceRef'), 'gw_SetBefore');
  assert.equal(nf?.getAttribute('targetRef'), 'gw');
  const refs = (id: string, tag: string) => Array.from(byId(doc, id)?.children ?? []).filter(c => c.tagName === `bpmn:${tag}`).map(c => c.textContent);
  assert.deepEqual(refs('gw', 'incoming'), ['gw_SetBefore_Flow']);
  assert.deepEqual(refs('gw_SetBefore', 'incoming'), ['f1']);
  assert.deepEqual(refs('gw_SetBefore', 'outgoing'), ['gw_SetBefore_Flow']);
  // the diagram: the event on the last stretch of f1, the edges end at it
  const bounds = byId(doc, 'gw_SetBefore_di')?.firstElementChild;
  assert.deepEqual([bounds?.getAttribute('x'), bounds?.getAttribute('y')], ['200', '100']);
  const points = (id: string) => Array.from(byId(doc, id)?.children ?? []).map(w => `${w.getAttribute('x')},${w.getAttribute('y')}`);
  assert.deepEqual(points('f1_di'), ['136,118', '200,118']);
  assert.deepEqual(points('gw_SetBefore_Flow_di'), ['236,118', '300,118']);
  assert.ok(r.issues.some(i => i.stepId === 'gw' && /None-Throw-Event «set readyForEvents» davor/.test(i.text)), JSON.stringify(r.issues));
});

test('a listener on a None-End-Event stays an output mapping on the event - it completes when reached', () => {
  const xml = c7(`
    <bpmn:startEvent id="s"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:endEvent id="e">${listener('processStatus', '&#34;succeeded&#34;')}<bpmn:incoming>f1</bpmn:incoming></bpmn:endEvent>`,
  '<bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="e" />');
  const doc = parse(convertBpmn(xml, 'c8').xml);
  assert.deepEqual(outputsOf(byId(doc, 'e')), ['processStatus=="succeeded"']);
  assert.equal(named(doc, 'intermediateThrowEvent').length, 0);
});

test('a listener on an Error-End-Event: a None-Throw-Event before it - Zeebe ignores the ioMapping there', () => {
  const xml = c7(`
    <bpmn:startEvent id="s"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:endEvent id="e">${listener('processStatus', '&#34;validation-failed&#34;')}<bpmn:incoming>f1</bpmn:incoming><bpmn:errorEventDefinition errorRef="err" /></bpmn:endEvent>`,
  '<bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="e" />');
  const doc = parse(convertBpmn(xml, 'c8').xml);
  assert.deepEqual(outputsOf(byId(doc, 'e')), []);
  assert.deepEqual(outputsOf(byId(doc, 'e_SetBefore')), ['processStatus=="validation-failed"']);
});

test('an end listener on a task without outputs: a None-Throw-Event after each outgoing flow - the condition stays on it', () => {
  const xml = c7(`
    <bpmn:startEvent id="s"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:serviceTask id="t" camunda:type="external" camunda:topic="my-topic">${listener('done', 'true', 'end')}<bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing><bpmn:outgoing>f3</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:endEvent id="e1"><bpmn:incoming>f2</bpmn:incoming></bpmn:endEvent>
    <bpmn:endEvent id="e2"><bpmn:incoming>f3</bpmn:incoming></bpmn:endEvent>`,
  `<bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="t" />
    <bpmn:sequenceFlow id="f2" sourceRef="t" targetRef="e1"><bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">\${ok}</bpmn:conditionExpression></bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="f3" sourceRef="t" targetRef="e2" />`);
  const doc = parse(convertBpmn(xml, 'c8').xml);
  assert.deepEqual(outputsOf(byId(doc, 't')), [], 'no first output mapping on the task - it would keep its other results local');
  assert.deepEqual(outputsOf(byId(doc, 't_SetAfter')), ['done==true']);
  assert.deepEqual(outputsOf(byId(doc, 't_SetAfter_2')), ['done==true']);
  assert.equal(byId(doc, 'f2')?.getAttribute('targetRef'), 't_SetAfter');
  assert.ok(byId(doc, 'f2')?.querySelector('*')?.textContent?.includes('ok'), 'the condition stays on the flow from the task');
  assert.equal(byId(doc, 't_SetAfter_Flow')?.getAttribute('targetRef'), 'e1');
  const incoming = Array.from(byId(doc, 'e1')?.children ?? []).filter(c => c.tagName === 'bpmn:incoming').map(c => c.textContent);
  assert.deepEqual(incoming, ['t_SetAfter_Flow']);
});

test('an end listener on a task with outputs: one more output mapping on the task', () => {
  const xml = c7(`
    <bpmn:startEvent id="s"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:serviceTask id="t" camunda:type="external" camunda:topic="my-topic"><bpmn:extensionElements>
      <camunda:inputOutput><camunda:outputParameter name="result">\${answer}</camunda:outputParameter></camunda:inputOutput>
      <camunda:executionListener expression="\${execution.setVariable(&#34;done&#34;, true)}" event="end" />
    </bpmn:extensionElements><bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:endEvent id="e"><bpmn:incoming>f2</bpmn:incoming></bpmn:endEvent>`,
  `<bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="t" />
    <bpmn:sequenceFlow id="f2" sourceRef="t" targetRef="e" />`);
  const doc = parse(convertBpmn(xml, 'c8').xml);
  assert.deepEqual(outputsOf(byId(doc, 't')).sort(), ['done==true', 'result==answer']);
  assert.equal(named(doc, 'intermediateThrowEvent').length, 0);
});

test('a start listener on a task: a None-Throw-Event before it - an output mapping would only apply when the task completes', () => {
  const xml = c7(`
    <bpmn:startEvent id="s"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:userTask id="u">${listener('opened', 'true')}<bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing></bpmn:userTask>
    <bpmn:endEvent id="e"><bpmn:incoming>f2</bpmn:incoming></bpmn:endEvent>`,
  `<bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="u" />
    <bpmn:sequenceFlow id="f2" sourceRef="u" targetRef="e" />`);
  const doc = parse(convertBpmn(xml, 'c8').xml);
  assert.deepEqual(outputsOf(byId(doc, 'u')), []);
  assert.deepEqual(outputsOf(byId(doc, 'u_SetBefore')), ['opened==true']);
});
