// A variable set on a gateway in Camunda 7: the import reads its `setVariable` listener
// as an output of the step, the export writes the output as such a listener again —
// never as camunda:inputOutput, which Camunda 7 rejects on a gateway (ENGINE-09005).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { allSteps, importBpmn } from '../src/bpmn';
import { writeBpmn } from '../src/bpmnWrite';
import type { ProcessSpec, Step } from '../src/types';
import { installXmlNamespaces } from './xmlNamespaces';

const g = globalThis as unknown as Record<string, unknown>;
g.DOMParser ??= DOMParser;
g.XMLSerializer ??= class { serializeToString(doc: { toString(): string }) { return doc.toString(); } };
installXmlNamespaces();

/** start → gateway `gw` → task → end; `join`: a second start also flows into the gateway */
const c7 = (gatewayExt: string, opts: { kind?: string; join?: boolean } = {}) => {
  const kind = opts.kind ?? 'exclusiveGateway';
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" xmlns:modeler="http://camunda.org/schema/modeler/1.0" modeler:executionPlatform="Camunda Platform" id="d" targetNamespace="x">
  <bpmn:process id="acme-demo-processV1" isExecutable="true">
    <bpmn:startEvent id="s"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    ${opts.join ? '<bpmn:startEvent id="s2"><bpmn:outgoing>f0</bpmn:outgoing></bpmn:startEvent><bpmn:sequenceFlow id="f0" sourceRef="s2" targetRef="gw" />' : ''}
    <bpmn:${kind} id="gw" name="Check"><bpmn:extensionElements>${gatewayExt}</bpmn:extensionElements><bpmn:incoming>f1</bpmn:incoming>${opts.join ? '<bpmn:incoming>f0</bpmn:incoming>' : ''}<bpmn:outgoing>f2</bpmn:outgoing></bpmn:${kind}>
    <bpmn:serviceTask id="t" name="Work" camunda:type="external" camunda:topic="acme-work"><bpmn:incoming>f2</bpmn:incoming><bpmn:outgoing>f3</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:endEvent id="e"><bpmn:incoming>f3</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="gw" />
    <bpmn:sequenceFlow id="f2" sourceRef="gw" targetRef="t" />
    <bpmn:sequenceFlow id="f3" sourceRef="t" targetRef="e" />
  </bpmn:process>
</bpmn:definitions>`;
};
const LISTENER = '<camunda:executionListener expression="${execution.setVariable(&#34;count&#34;, execution.getVariable(&#34;count&#34;) + 1)}" event="start" />';
const OLD_IO = '<camunda:inputOutput><camunda:outputParameter name="count">${count + 1}</camunda:outputParameter></camunda:inputOutput>';

const parse = (xml: string) => new DOMParser().parseFromString(xml, 'text/xml') as unknown as Document;
const gwOf = (xml: string) => Array.from(parse(xml).querySelectorAll('*')).find(e => e.getAttribute('id') === 'gw');
const tagged = (el: Element | undefined, tag: string) => Array.from(el?.querySelectorAll('*') ?? []).filter(e => e.tagName === tag);
/** the listeners on the gateway, as the engine reads them */
const listeners = (xml: string) => tagged(gwOf(xml), 'camunda:executionListener').map(l => `${l.getAttribute('event')}: ${l.getAttribute('expression')}`);
const specOf = (xml: string): ProcessSpec => importBpmn(xml, 'p.bpmn').spec;
const gatewayStep = (spec: ProcessSpec): Step => allSteps(spec.steps).find(s => s.id === 'gw')!;
/** the spec with other rows on the gateway */
const withRows = (spec: ProcessSpec, rows: Pick<Step, 'inputs' | 'outputs'>): ProcessSpec => {
  const copy = structuredClone(spec);
  Object.assign(gatewayStep(copy), rows);
  return copy;
};

test('import: a setVariable listener on a gateway is an output of the step - null-safe', () => {
  assert.deepEqual(gatewayStep(specOf(c7(LISTENER))).outputs, [{ name: 'count', expression: '= (if count = null then 0 else count) + 1' }]);
});

test('import + export unchanged: the listener stays literally', () => {
  const xml = c7(LISTENER);
  const r = writeBpmn(xml, specOf(xml));
  assert.deepEqual(listeners(r.xml), ['start: ${execution.setVariable("count", execution.getVariable("count") + 1)}']);
  assert.deepEqual(tagged(gwOf(r.xml), 'camunda:inputOutput'), []);
});

test('export: an output on a gateway (from an older state) becomes a listener - the inputOutput goes', () => {
  const xml = c7(OLD_IO);
  const spec = withRows(specOf(xml), { outputs: [{ name: 'count', expression: '= count + 1' }] });
  const r = writeBpmn(xml, spec);
  assert.deepEqual(tagged(gwOf(r.xml), 'camunda:inputOutput'), [], r.xml);
  assert.deepEqual(listeners(r.xml), ['start: ${execution.setVariable("count", execution.getVariable("count") + 1)}']);
});

test('export: a changed row rewrites its listener, a removed row removes it', () => {
  const xml = c7(LISTENER);
  const changed = writeBpmn(xml, withRows(specOf(xml), { outputs: [{ name: 'count', expression: '= count + 2' }] }));
  assert.deepEqual(listeners(changed.xml), ['start: ${execution.setVariable("count", execution.getVariable("count") + 2)}']);
  const removed = writeBpmn(xml, withRows(specOf(xml), { outputs: [{ name: 'other', expression: '= true' }] }));
  assert.deepEqual(listeners(removed.xml), ['start: ${execution.setVariable("other", true)}']);
});

test('export: a join of a parallel gateway - an end listener', () => {
  const xml = c7('', { kind: 'parallelGateway', join: true });
  const r = writeBpmn(xml, withRows(specOf(xml), { outputs: [{ name: 'count', expression: '= count + 1' }] }));
  assert.deepEqual(listeners(r.xml).map(l => l.split(':')[0]), ['end']);
});

test('export: an input on a gateway is not written - with an issue', () => {
  const xml = c7('');
  const r = writeBpmn(xml, withRows(specOf(xml), { inputs: [{ name: 'limit', expression: '= 3' }] }));
  assert.deepEqual(tagged(gwOf(r.xml), 'camunda:inputOutput'), [], r.xml);
  assert.ok(r.issues.some(i => i.stepId === 'gw' && i.text.startsWith('Eingabe «limit» nicht geschrieben')), JSON.stringify(r.issues));
});

test('export: an untranslatable output on a gateway - no listener, an issue', () => {
  const xml = c7('');
  const r = writeBpmn(xml, withRows(specOf(xml), { outputs: [{ name: 'any', expression: '= some x in xs satisfies x > 1' }] }));
  assert.deepEqual(listeners(r.xml), []);
  assert.ok(r.issues.some(i => i.stepId === 'gw' && i.text.includes('nicht nach JUEL übersetzbar')), JSON.stringify(r.issues));
});

test('export: other listeners on the gateway stay', () => {
  const other = '<camunda:executionListener class="acme.Audit" event="start" />';
  const xml = c7(`${other}${LISTENER}`);
  const r = writeBpmn(xml, withRows(specOf(xml), { outputs: [{ name: 'count', expression: '= count + 2' }] }));
  const all = tagged(gwOf(r.xml), 'camunda:executionListener');
  assert.equal(all.length, 2, r.xml);
  assert.equal(all[0].getAttribute('class'), 'acme.Audit');
});
