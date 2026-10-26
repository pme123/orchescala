// A pattern that reuses a root element of the diagram (message, signal, error) brings along the
// extensions it needs there - e.g. in Camunda 8 the correlation key (`zeebe:subscription`) of the
// start message, which an event subprocess catching the same message needs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { applyPattern, detectPatterns, removePattern } from '../src/patterns';
import type { PatternDef } from '../src/types';

const g = globalThis as unknown as Record<string, unknown>;
g.DOMParser ??= DOMParser;
g.XMLSerializer ??= class { serializeToString(doc: { toString(): string }) { return doc.toString(); } };

const ZEEBE = 'http://camunda.org/schema/zeebe/1.0';
const BASE_NS = 'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" '
  + 'xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI"';
const NS = `${BASE_NS} xmlns:zeebe="${ZEEBE}"`;

// the event subprocess of «Einmalige Ausführung» in Camunda 8
const fragment = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${NS} id="PatternDefinitions" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="PatternProcess" isExecutable="true">
    <bpmn:subProcess id="AlreadyRunningSubProcess" name="Process already running" triggeredByEvent="true">
      <bpmn:startEvent id="AlreadyRunningStart" name="already running" isInterrupting="false">
        <bpmn:messageEventDefinition id="AlreadyRunningStartDef" messageRef="StartMessage" />
      </bpmn:startEvent>
    </bpmn:subProcess>
  </bpmn:process>
  <bpmn:message id="StartMessage" name="{{startMessage}}">
    <bpmn:extensionElements>
      <zeebe:subscription correlationKey="=businessKey" />
    </bpmn:extensionElements>
  </bpmn:message>
  <bpmndi:BPMNDiagram id="PatternDiagram">
    <bpmndi:BPMNPlane id="PatternPlane" bpmnElement="PatternProcess">
      <bpmndi:BPMNShape id="AlreadyRunningSubProcess_di" bpmnElement="AlreadyRunningSubProcess" isExpanded="true">
        <dc:Bounds x="250" y="270" width="340" height="140" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="AlreadyRunningStart_di" bpmnElement="AlreadyRunningStart">
        <dc:Bounds x="302" y="322" width="36" height="36" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;
const def = { id: 'unique-execution', name: 'Einmalige Ausführung', appliesTo: ['process'], bpmn: { c8: fragment } } as unknown as PatternDef;

const processWith = (roots: string, body: string, ns = NS) => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${ns} id="Defs" targetNamespace="http://bpmn.io/schema/bpmn">
  ${roots}
  <bpmn:process id="acme-demo" isExecutable="true">
    ${body}
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram">
    <bpmndi:BPMNPlane id="Plane" bpmnElement="acme-demo">
      <bpmndi:BPMNShape id="StartStartEvent_di" bpmnElement="StartStartEvent">
        <dc:Bounds x="100" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;
const messageStart = '<bpmn:startEvent id="StartStartEvent"><bpmn:messageEventDefinition id="StartDef" messageRef="Msg1" /></bpmn:startEvent>';
const espOf = (msg: string) => `<bpmn:subProcess id="AlreadyRunningSubProcess" triggeredByEvent="true">
      <bpmn:startEvent id="AlreadyRunningStart" isInterrupting="false"><bpmn:messageEventDefinition id="EspDef" messageRef="${msg}" /></bpmn:startEvent>
    </bpmn:subProcess>`;

// ── reading the result as a DOM, not as text ─────────────────────────────────
/** the name without prefix - linkedom keeps `bpmn:` in localName */
const ln = (e: Element) => (e.localName ?? '').replace(/^.*:/, '');
const parse = (xml: string) => {
  const d = new DOMParser().parseFromString(xml, 'text/xml') as unknown as Document;
  assert.ok(d.documentElement && ln(d.documentElement) === 'definitions', 'the result is readable BPMN');
  return d;
};
const walk = (e: Element): Element[] => [e, ...Array.from(e.children).flatMap(walk)];
const all = (d: Document) => walk(d.documentElement);
/** the root elements of a kind with their extensions: id, name, [kind, attributes] */
const roots = (xml: string, kind = 'message') => {
  const d = parse(xml);
  return all(d).filter(e => ln(e) === kind && e.parentElement === d.documentElement).map(m => ({
    id: m.getAttribute('id'), name: m.getAttribute('name'),
    ext: Array.from(m.children).filter(c => ln(c) === 'extensionElements')
      .flatMap(x => Array.from(x.children).map(c => `${ln(c)}${c.getAttribute('correlationKey') ? ` ${c.getAttribute('correlationKey')}` : ''}${c.children.length ? ` [${Array.from(c.children).map(k => k.getAttribute('name')).join(',')}]` : ''}`)),
  }));
};
const espRefs = (xml: string) => all(parse(xml)).filter(e => ln(e) === 'messageEventDefinition' && e.parentElement?.getAttribute('isInterrupting') === 'false').map(e => e.getAttribute('messageRef'));

test('the start message the process already has gets the correlation key', () => {
  const r = applyPattern(processWith('<bpmn:message id="Msg1" name="acme-demo" />', messageStart), def, 'c8', null);
  assert.deepEqual(r.issues, []);
  assert.ok(r.changed);
  // one message - the existing one, now with the subscription; the event subprocess refers to it
  assert.deepEqual(roots(r.xml), [{ id: 'Msg1', name: 'acme-demo', ext: ['subscription =businessKey'] }]);
  assert.deepEqual(espRefs(r.xml), ['Msg1']);
  assert.ok(detectPatterns(r.xml, [def], 'c8').hits.some(h => h.patternId === 'unique-execution'));
});

test('without a message start the process gets one - with the correlation key', () => {
  const r = applyPattern(processWith('', '<bpmn:startEvent id="StartStartEvent" />'), def, 'c8', null);
  assert.deepEqual(r.issues, []);
  const msgs = roots(r.xml);
  assert.equal(msgs.length, 1);
  assert.deepEqual(msgs[0].ext, ['subscription =businessKey']);
  assert.equal(msgs[0].name, 'acme-demo');
});

test('an existing correlation key stays as it is - not a second one', () => {
  const xml = processWith(
    '<bpmn:message id="Msg1" name="acme-demo"><bpmn:extensionElements><zeebe:subscription correlationKey="=clientKey" /></bpmn:extensionElements></bpmn:message>',
    messageStart);
  const r = applyPattern(xml, def, 'c8', null);
  assert.deepEqual(r.issues, []);
  assert.deepEqual(roots(r.xml)[0].ext, ['subscription =clientKey']);
});

test('a diagram without the zeebe namespace gets it declared - the result stays readable', () => {
  const r = applyPattern(processWith('<bpmn:message id="Msg1" name="acme-demo" />', messageStart, BASE_NS), def, 'c8', null);
  assert.deepEqual(r.issues, []);
  const d = parse(r.xml);
  assert.equal(d.documentElement.getAttribute('xmlns:zeebe'), ZEEBE);
  // bound to that prefix (linkedom does not resolve namespaces - the browser does, from the declaration)
  assert.equal(all(d).find(e => ln(e) === 'subscription')?.tagName, 'zeebe:subscription');
  assert.deepEqual(roots(r.xml)[0].ext, ['subscription =businessKey']);
});

test('applied again on a complete event subprocess: only the missing correlation key is added', () => {
  // the event subprocess is already there (e.g. modelled by hand) - only the key on the message is missing
  const xml = processWith('<bpmn:message id="Msg1" name="acme-demo" />', messageStart + espOf('Msg1'));
  const r = applyPattern(xml, def, 'c8', null);
  assert.deepEqual(r.issues, []);
  assert.ok(r.changed, 'reports the change');
  assert.deepEqual(roots(r.xml)[0].ext, ['subscription =businessKey']);
  assert.equal(espRefs(r.xml).length, 1, 'no second event subprocess');
  // and once more: nothing left to do
  const again = applyPattern(r.xml, def, 'c8', null);
  assert.equal(again.changed, false);
});

test('removing the pattern leaves the correlation key on the shared message', () => {
  const applied = applyPattern(processWith('<bpmn:message id="Msg1" name="acme-demo" />', messageStart), def, 'c8', null).xml;
  const r = removePattern(applied, def, 'c8', null, [def]);
  assert.ok(r.changed);
  assert.deepEqual(espRefs(r.xml), [], 'the event subprocess is gone');
  // the message belongs to the start as well - its extension stays (documented on addRootExtensions)
  assert.deepEqual(roots(r.xml), [{ id: 'Msg1', name: 'acme-demo', ext: ['subscription =businessKey'] }]);
});

test('any root kind, by kind only: a different kind is added, the same kind is not merged', () => {
  // a pattern catching a signal whose root carries two extensions
  const sigFragment = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${NS} id="PatternDefinitions" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="PatternProcess" isExecutable="true">
    <bpmn:subProcess id="CancelSub" triggeredByEvent="true">
      <bpmn:startEvent id="CancelStart"><bpmn:signalEventDefinition id="CancelStartDef" signalRef="Sig" /></bpmn:startEvent>
    </bpmn:subProcess>
  </bpmn:process>
  <bpmn:signal id="Sig" name="acme-cancel">
    <bpmn:extensionElements>
      <zeebe:properties><zeebe:property name="fromPattern" value="1" /></zeebe:properties>
      <zeebe:subscription correlationKey="=x" />
    </bpmn:extensionElements>
  </bpmn:signal>
</bpmn:definitions>`;
  const sigDef = { id: 'cancel', name: 'Abbruch', appliesTo: ['process'], bpmn: { c8: sigFragment } } as unknown as PatternDef;
  const xml = processWith(
    '<bpmn:signal id="Sig1" name="acme-cancel"><bpmn:extensionElements><zeebe:properties><zeebe:property name="own" value="2" /></zeebe:properties></bpmn:extensionElements></bpmn:signal>',
    '<bpmn:startEvent id="StartStartEvent" />');
  const r = applyPattern(xml, sigDef, 'c8', null);
  assert.deepEqual(r.issues, []);
  // the own properties stay untouched (not merged), the missing kind is added
  assert.deepEqual(roots(r.xml, 'signal'), [{ id: 'Sig1', name: 'acme-cancel', ext: ['properties [own]', 'subscription =x'] }]);
});
