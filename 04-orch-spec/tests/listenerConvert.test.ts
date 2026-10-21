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

const refs = (doc: Document, id: string, tag: string) =>
  Array.from(byId(doc, id)?.children ?? []).filter(c => c.tagName === `bpmn:${tag}`).map(c => c.textContent);

test('a join gateway keeps all its incoming flows: one None-Throw-Event per flow - it still waits for every branch', () => {
  for (const gateway of ['parallelGateway', 'exclusiveGateway']) {
    const xml = c7(`
      <bpmn:startEvent id="s"><bpmn:outgoing>f0</bpmn:outgoing></bpmn:startEvent>
      <bpmn:parallelGateway id="fork"><bpmn:incoming>f0</bpmn:incoming><bpmn:outgoing>f1</bpmn:outgoing><bpmn:outgoing>f2</bpmn:outgoing></bpmn:parallelGateway>
      <bpmn:${gateway} id="join">${listener('joined', 'true')}<bpmn:incoming>f1</bpmn:incoming><bpmn:incoming>f2</bpmn:incoming><bpmn:outgoing>f3</bpmn:outgoing></bpmn:${gateway}>
      <bpmn:endEvent id="e"><bpmn:incoming>f3</bpmn:incoming></bpmn:endEvent>`,
    `<bpmn:sequenceFlow id="f0" sourceRef="s" targetRef="fork" />
      <bpmn:sequenceFlow id="f1" sourceRef="fork" targetRef="join" />
      <bpmn:sequenceFlow id="f2" sourceRef="fork" targetRef="join" />
      <bpmn:sequenceFlow id="f3" sourceRef="join" targetRef="e" />`,
    `<bpmndi:BPMNEdge id="f1_di" bpmnElement="f1"><di:waypoint x="200" y="50" /><di:waypoint x="300" y="50" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="f2_di" bpmnElement="f2"><di:waypoint x="200" y="150" /><di:waypoint x="300" y="150" /></bpmndi:BPMNEdge>`);
    const doc = parse(convertBpmn(xml, 'c8').xml);
    assert.deepEqual(refs(doc, 'join', 'incoming'), ['join_SetBefore_Flow', 'join_SetBefore_2_Flow'], gateway);
    assert.equal(byId(doc, 'f1')?.getAttribute('targetRef'), 'join_SetBefore');
    assert.equal(byId(doc, 'f2')?.getAttribute('targetRef'), 'join_SetBefore_2');
    assert.deepEqual(outputsOf(byId(doc, 'join_SetBefore_2')), ['joined==true']);
    // each event on its own flow in the diagram
    const y = (id: string) => byId(doc, `${id}_di`)?.firstElementChild?.getAttribute('y');
    assert.deepEqual([y('join_SetBefore'), y('join_SetBefore_2')], ['32', '132'], gateway);
  }
});

test('an end listener on a gateway with outputs: still a None-Throw-Event after it - the gateway ignores any output mapping', () => {
  const xml = c7(`
    <bpmn:startEvent id="s"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:exclusiveGateway id="gw"><bpmn:extensionElements>
      <camunda:inputOutput><camunda:outputParameter name="route">\${route}</camunda:outputParameter></camunda:inputOutput>
      <camunda:executionListener expression="\${execution.setVariable(&#34;decided&#34;, true)}" event="end" />
    </bpmn:extensionElements><bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing></bpmn:exclusiveGateway>
    <bpmn:endEvent id="e"><bpmn:incoming>f2</bpmn:incoming></bpmn:endEvent>`,
  `<bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="gw" />
    <bpmn:sequenceFlow id="f2" sourceRef="gw" targetRef="e" />`);
  const doc = parse(convertBpmn(xml, 'c8').xml);
  assert.ok(!outputsOf(byId(doc, 'gw')).includes('decided==true'));
  assert.deepEqual(outputsOf(byId(doc, 'gw_SetAfter')), ['decided==true']);
});

test('no flow to put the event on: reported - nothing inserted', () => {
  const xml = c7(`
    <bpmn:startEvent id="s" />
    <bpmn:userTask id="u">${listener('opened', 'true')}</bpmn:userTask>`, '');
  const r = convertBpmn(xml, 'c8');
  const doc = parse(r.xml);
  assert.equal(named(doc, 'intermediateThrowEvent').length, 0);
  assert.ok(r.issues.some(i => i.stepId === 'u' && /keinen Fluss davor: von Hand umsetzen/.test(i.text)), JSON.stringify(r.issues));
});

test('a start and an end listener on one task: an event before and one after it', () => {
  const xml = c7(`
    <bpmn:startEvent id="s"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:userTask id="u"><bpmn:extensionElements>
      <camunda:executionListener expression="\${execution.setVariable(&#34;opened&#34;, true)}" event="start" />
      <camunda:executionListener expression="\${execution.setVariable(&#34;closed&#34;, true)}" event="end" />
    </bpmn:extensionElements><bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing></bpmn:userTask>
    <bpmn:endEvent id="e"><bpmn:incoming>f2</bpmn:incoming></bpmn:endEvent>`,
  `<bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="u" />
    <bpmn:sequenceFlow id="f2" sourceRef="u" targetRef="e" />`);
  const doc = parse(convertBpmn(xml, 'c8').xml);
  assert.deepEqual(outputsOf(byId(doc, 'u_SetBefore')), ['opened==true']);
  assert.deepEqual(outputsOf(byId(doc, 'u_SetAfter')), ['closed==true']);
  assert.deepEqual(refs(doc, 'u', 'incoming'), ['u_SetBefore_Flow']);
  assert.equal(byId(doc, 'f2')?.getAttribute('targetRef'), 'u_SetAfter');
});

test('several listeners on one element: one event with all output mappings', () => {
  const xml = c7(`
    <bpmn:startEvent id="s"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:eventBasedGateway id="gw"><bpmn:extensionElements>
      <camunda:executionListener expression="\${execution.setVariable(&#34;readyForEvents&#34;, true)}" event="start" />
      <camunda:executionListener expression="\${execution.setVariable(&#34;waitingFor&#34;, &#34;events&#34;)}" event="start" />
    </bpmn:extensionElements><bpmn:incoming>f1</bpmn:incoming></bpmn:eventBasedGateway>`,
  '<bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="gw" />');
  const r = convertBpmn(xml, 'c8');
  const doc = parse(r.xml);
  assert.equal(named(doc, 'intermediateThrowEvent').length, 1);
  assert.deepEqual(outputsOf(byId(doc, 'gw_SetBefore')), ['readyForEvents==true', 'waitingFor=="events"']);
  assert.equal(byId(doc, 'gw_SetBefore')?.getAttribute('name'), 'set readyForEvents, waitingFor');
});

test('a flow without an edge in the diagram: the event is inserted, reported as not drawn', () => {
  const xml = c7(`
    <bpmn:startEvent id="s"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:eventBasedGateway id="gw">${listener('readyForEvents', 'true')}<bpmn:incoming>f1</bpmn:incoming></bpmn:eventBasedGateway>`,
  '<bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="gw" />');
  const r = convertBpmn(xml, 'c8');
  const doc = parse(r.xml);
  assert.ok(byId(doc, 'gw_SetBefore'));
  assert.ok(!byId(doc, 'gw_SetBefore_di'));
  assert.ok(r.issues.some(i => /Ohne Diagramm-Eintrag/.test(i.text)), JSON.stringify(r.issues));
  assert.ok(!r.issues.some(i => /Lage im Diagramm prüfen/.test(i.text)));
});

test('back to Camunda 7: the inserted event keeps setting the variable (inputOutput on the throw event)', () => {
  const xml = c7(`
    <bpmn:startEvent id="s"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:eventBasedGateway id="gw">${listener('readyForEvents', 'true')}<bpmn:incoming>f1</bpmn:incoming></bpmn:eventBasedGateway>`,
  '<bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="gw" />');
  const back = parse(convertBpmn(convertBpmn(xml, 'c8').xml, 'c7').xml);
  const ev = byId(back, 'gw_SetBefore');
  const out = ev && Array.from(ev.querySelectorAll('*')).find(e => e.tagName === 'camunda:outputParameter');
  assert.equal(out?.getAttribute('name'), 'readyForEvents');
  assert.equal(out?.textContent?.trim(), '${true}');
  assert.equal(byId(back, 'f1')?.getAttribute('targetRef'), 'gw_SetBefore');
});

/** start → event-based gateway (with `gwExt`) → two timer catch events (the first with `t1Ext`) → end */
const eventGateway = (gwExt: string, t1Ext = '') => c7(`
  <bpmn:startEvent id="s"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
  <bpmn:eventBasedGateway id="gw">${gwExt}<bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing><bpmn:outgoing>f3</bpmn:outgoing></bpmn:eventBasedGateway>
  <bpmn:intermediateCatchEvent id="t1">${t1Ext}<bpmn:incoming>f2</bpmn:incoming><bpmn:outgoing>f4</bpmn:outgoing><bpmn:timerEventDefinition><bpmn:timeDuration>PT1H</bpmn:timeDuration></bpmn:timerEventDefinition></bpmn:intermediateCatchEvent>
  <bpmn:intermediateCatchEvent id="t2"><bpmn:incoming>f3</bpmn:incoming><bpmn:outgoing>f5</bpmn:outgoing><bpmn:timerEventDefinition><bpmn:timeDuration>PT2H</bpmn:timeDuration></bpmn:timerEventDefinition></bpmn:intermediateCatchEvent>
  <bpmn:endEvent id="e"><bpmn:incoming>f4</bpmn:incoming><bpmn:incoming>f5</bpmn:incoming></bpmn:endEvent>`,
`<bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="gw" />
  <bpmn:sequenceFlow id="f2" sourceRef="gw" targetRef="t1" />
  <bpmn:sequenceFlow id="f3" sourceRef="gw" targetRef="t2" />
  <bpmn:sequenceFlow id="f4" sourceRef="t1" targetRef="e" />
  <bpmn:sequenceFlow id="f5" sourceRef="t2" targetRef="e" />`);

test('an end listener on an event-based gateway: NOT inserted - only catch events may follow it, reported', () => {
  const r = convertBpmn(eventGateway(listener('triggered', 'true', 'end')), 'c8');
  const doc = parse(r.xml);
  assert.equal(named(doc, 'intermediateThrowEvent').length, 0);
  assert.equal(byId(doc, 'f2')?.getAttribute('targetRef'), 't1');
  assert.equal(r.issues.filter(i => /NICHT übernommen auf «f[23]» — nach einem Event-Based Gateway/.test(i.text)).length, 2, JSON.stringify(r.issues));
});

test('a start listener on a catch event after an event-based gateway: NOT inserted, reported', () => {
  const r = convertBpmn(eventGateway('', listener('waiting', 'true')), 'c8');
  const doc = parse(r.xml);
  assert.equal(named(doc, 'intermediateThrowEvent').length, 0);
  assert.ok(r.issues.some(i => i.stepId === 't1' && /NICHT übernommen auf «f2»/.test(i.text)), JSON.stringify(r.issues));
});

test('the default flow of a gateway stays its default - the event goes behind it', () => {
  const xml = c7(`
    <bpmn:startEvent id="s"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:exclusiveGateway id="gw" default="f3">${listener('decided', 'true', 'end')}<bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing><bpmn:outgoing>f3</bpmn:outgoing></bpmn:exclusiveGateway>
    <bpmn:endEvent id="e1"><bpmn:incoming>f2</bpmn:incoming></bpmn:endEvent>
    <bpmn:endEvent id="e2"><bpmn:incoming>f3</bpmn:incoming></bpmn:endEvent>`,
  `<bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="gw" />
    <bpmn:sequenceFlow id="f2" sourceRef="gw" targetRef="e1"><bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">\${ok}</bpmn:conditionExpression></bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="f3" sourceRef="gw" targetRef="e2" />`);
  const doc = parse(convertBpmn(xml, 'c8').xml);
  assert.equal(byId(doc, 'gw')?.getAttribute('default'), 'f3');
  assert.equal(byId(doc, 'f3')?.getAttribute('sourceRef'), 'gw');
  assert.equal(byId(doc, 'f3')?.getAttribute('targetRef'), 'gw_SetAfter_2');
  assert.equal(byId(doc, 'gw_SetAfter_2_Flow')?.getAttribute('targetRef'), 'e2');
});

test('an end listener on a task without an outgoing flow: NOT inserted, reported - the variable is lost', () => {
  const xml = c7(`
    <bpmn:startEvent id="s"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:userTask id="u">${listener('closed', 'true', 'end')}<bpmn:incoming>f1</bpmn:incoming></bpmn:userTask>`,
  '<bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="u" />');
  const r = convertBpmn(xml, 'c8');
  assert.equal(named(parse(r.xml), 'intermediateThrowEvent').length, 0);
  assert.ok(r.issues.some(i => i.stepId === 'u' && /NICHT übernommen — .*keinen Fluss danach: von Hand umsetzen/.test(i.text)), JSON.stringify(r.issues));
});

test('a take listener on a sequence flow: the event goes on that flow', () => {
  const xml = c7(`
    <bpmn:startEvent id="s"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:endEvent id="e"><bpmn:incoming>f1</bpmn:incoming></bpmn:endEvent>`,
  `<bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="e">${listener('passed', 'true', 'take')}</bpmn:sequenceFlow>`);
  const doc = parse(convertBpmn(xml, 'c8').xml);
  assert.equal(byId(doc, 'f1')?.getAttribute('targetRef'), 'f1_Set');
  assert.deepEqual(outputsOf(byId(doc, 'f1_Set')), ['passed==true']);
  assert.equal(byId(doc, 'f1_Set_Flow')?.getAttribute('targetRef'), 'e');
});

test('an unknown listener event - or take on a task: NOT inserted, reported', () => {
  for (const event of ['foo', 'take']) {
    const xml = c7(`
      <bpmn:startEvent id="s"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
      <bpmn:userTask id="u">${listener('x', 'true', event)}<bpmn:incoming>f1</bpmn:incoming></bpmn:userTask>`,
    '<bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="u" />');
    const r = convertBpmn(xml, 'c8');
    assert.equal(named(parse(r.xml), 'intermediateThrowEvent').length, 0, event);
    assert.ok(r.issues.some(i => i.text.includes(`NICHT übernommen — Listener-Event «${event}» hier unbekannt`)), JSON.stringify(r.issues));
  }
});

test('a multi-instance task: the event runs once, the listener ran per instance - reported', () => {
  const xml = c7(`
    <bpmn:startEvent id="s"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:userTask id="u">${listener('opened', 'true')}<bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing><bpmn:multiInstanceLoopCharacteristics camunda:collection="\${items}" camunda:elementVariable="item" /></bpmn:userTask>
    <bpmn:endEvent id="e"><bpmn:incoming>f2</bpmn:incoming></bpmn:endEvent>`,
  `<bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="u" />
    <bpmn:sequenceFlow id="f2" sourceRef="u" targetRef="e" />`);
  const r = convertBpmn(xml, 'c8');
  assert.ok(byId(parse(r.xml), 'u_SetBefore'));
  assert.ok(r.issues.some(i => /Mehrfachausführung: das Event läuft einmal/.test(i.text)), JSON.stringify(r.issues));
});

test('an output parameter that does not become an output mapping (a script) does not count - the event goes after the task', () => {
  const xml = c7(`
    <bpmn:startEvent id="s"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:serviceTask id="t" camunda:type="external" camunda:topic="my-topic"><bpmn:extensionElements>
      <camunda:inputOutput><camunda:outputParameter name="result"><camunda:script scriptFormat="groovy">answer</camunda:script></camunda:outputParameter></camunda:inputOutput>
      <camunda:executionListener expression="\${execution.setVariable(&#34;done&#34;, true)}" event="end" />
    </bpmn:extensionElements><bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:endEvent id="e"><bpmn:incoming>f2</bpmn:incoming></bpmn:endEvent>`,
  `<bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="t" />
    <bpmn:sequenceFlow id="f2" sourceRef="t" targetRef="e" />`);
  const doc = parse(convertBpmn(xml, 'c8').xml);
  assert.deepEqual(outputsOf(byId(doc, 't')), []);
  assert.deepEqual(outputsOf(byId(doc, 't_SetAfter')), ['done==true']);
});

test('a short stretch of flow: drawn, reported as tight; diagram ids stay unique', () => {
  const xml = c7(`
    <bpmn:startEvent id="s"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:eventBasedGateway id="gw">${listener('readyForEvents', 'true')}<bpmn:incoming>f1</bpmn:incoming></bpmn:eventBasedGateway>`,
  '<bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="gw" />',
  `<bpmndi:BPMNShape id="gw_SetBefore_di" bpmnElement="gw"><dc:Bounds x="182" y="93" width="50" height="50" /></bpmndi:BPMNShape>
    <bpmndi:BPMNEdge id="f1_di" bpmnElement="f1"><di:waypoint x="136" y="118" /><di:waypoint x="182" y="118" /></bpmndi:BPMNEdge>`);
  const r = convertBpmn(xml, 'c8');
  const doc = parse(r.xml);
  const shapes = named(doc, 'BPMNShape').filter(e => e.getAttribute('bpmnElement') === 'gw_SetBefore');
  assert.deepEqual(shapes.map(e => e.getAttribute('id')), ['gw_SetBefore_di_2']);
  assert.ok(r.issues.some(i => /wenig Platz auf dem Fluss/.test(i.text)), JSON.stringify(r.issues));
});

test('a stretch shorter than the event: no diagram entry - the shortened edges would run backwards', () => {
  const xml = c7(`
    <bpmn:startEvent id="s"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:eventBasedGateway id="gw">${listener('readyForEvents', 'true')}<bpmn:incoming>f1</bpmn:incoming></bpmn:eventBasedGateway>`,
  '<bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="gw" />',
  '<bpmndi:BPMNEdge id="f1_di" bpmnElement="f1"><di:waypoint x="136" y="118" /><di:waypoint x="166" y="118" /></bpmndi:BPMNEdge>');
  const r = convertBpmn(xml, 'c8');
  const doc = parse(r.xml);
  assert.ok(byId(doc, 'gw_SetBefore'));
  assert.ok(!byId(doc, 'gw_SetBefore_di'));
  assert.ok(r.issues.some(i => /zu wenig Platz auf dem Fluss/.test(i.text)), JSON.stringify(r.issues));
});

test('a start listener on a task with two incoming flows: an event on each - and a hint, the variable is set up to twice', () => {
  const xml = c7(`
    <bpmn:startEvent id="s"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:exclusiveGateway id="x"><bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing><bpmn:outgoing>f3</bpmn:outgoing></bpmn:exclusiveGateway>
    <bpmn:userTask id="u">${listener('opened', 'true')}<bpmn:incoming>f2</bpmn:incoming><bpmn:incoming>f3</bpmn:incoming></bpmn:userTask>`,
  `<bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="x" />
    <bpmn:sequenceFlow id="f2" sourceRef="x" targetRef="u"><bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">\${a}</bpmn:conditionExpression></bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="f3" sourceRef="x" targetRef="u" />`);
  const r = convertBpmn(xml, 'c8');
  const doc = parse(r.xml);
  assert.deepEqual(refs(doc, 'u', 'incoming'), ['u_SetBefore_Flow', 'u_SetBefore_2_Flow']);
  assert.ok(r.issues.some(i => /bis zu 2-mal gesetzt/.test(i.text)), JSON.stringify(r.issues));
});

test('an end listener on a task with an interrupting boundary event: a hint - on that path the variable is not set', () => {
  const xml = c7(`
    <bpmn:startEvent id="s"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:userTask id="u">${listener('closed', 'true', 'end')}<bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing></bpmn:userTask>
    <bpmn:boundaryEvent id="timeout" name="too late" attachedToRef="u"><bpmn:outgoing>f3</bpmn:outgoing><bpmn:timerEventDefinition><bpmn:timeDuration>PT1H</bpmn:timeDuration></bpmn:timerEventDefinition></bpmn:boundaryEvent>
    <bpmn:boundaryEvent id="remind" attachedToRef="u" cancelActivity="false"><bpmn:timerEventDefinition><bpmn:timeDuration>PT10M</bpmn:timeDuration></bpmn:timerEventDefinition></bpmn:boundaryEvent>
    <bpmn:endEvent id="e"><bpmn:incoming>f2</bpmn:incoming><bpmn:incoming>f3</bpmn:incoming></bpmn:endEvent>`,
  `<bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="u" />
    <bpmn:sequenceFlow id="f2" sourceRef="u" targetRef="e" />
    <bpmn:sequenceFlow id="f3" sourceRef="timeout" targetRef="e" />`);
  const r = convertBpmn(xml, 'c8');
  const hint = r.issues.find(i => /Abbruch über/.test(i.text))?.text ?? '';
  assert.match(hint, /Abbruch über «too late»: dort lief der Listener auch, das Event nicht/);
  assert.ok(!hint.includes('remind'), 'a non-interrupting boundary event does not end the task');
});

test('an end listener on A and a start listener on the next B: both events on the flow, in order', () => {
  const xml = c7(`
    <bpmn:startEvent id="s"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:userTask id="a">${listener('aDone', 'true', 'end')}<bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing></bpmn:userTask>
    <bpmn:userTask id="b">${listener('bOpen', 'true')}<bpmn:incoming>f2</bpmn:incoming><bpmn:outgoing>f3</bpmn:outgoing></bpmn:userTask>
    <bpmn:endEvent id="e"><bpmn:incoming>f3</bpmn:incoming></bpmn:endEvent>`,
  `<bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="a" />
    <bpmn:sequenceFlow id="f2" sourceRef="a" targetRef="b" />
    <bpmn:sequenceFlow id="f3" sourceRef="b" targetRef="e" />`);
  const doc = parse(convertBpmn(xml, 'c8').xml);
  const next = (id: string) => {
    const out = Array.from(doc.querySelectorAll('*')).find(e => e.tagName === 'bpmn:sequenceFlow' && e.getAttribute('sourceRef') === id);
    return out?.getAttribute('targetRef');
  };
  assert.deepEqual([next('a'), next('a_SetAfter'), next('b_SetBefore')], ['a_SetAfter', 'b_SetBefore', 'b']);
});
