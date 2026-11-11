// A variable set on a gateway: inside Orch Spec an output of the step (the diagram keeps
// it as camunda:inputOutput); only the export for Camunda 7 turns it into a listener -
// Camunda 7 rejects an inputOutput on a gateway (ENGINE-09005).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { allSteps, importBpmn } from '../src/bpmn';
import { writeBpmn } from '../src/bpmnWrite';
import { C7_LABEL } from '../src/engineLabels';
import { exportBpmnFor } from '../src/exporters';
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
    <bpmn:${kind} id="gw" name="Check">${gatewayExt ? `<bpmn:extensionElements>${gatewayExt}</bpmn:extensionElements>` : ''}<bpmn:incoming>f1</bpmn:incoming>${opts.join ? '<bpmn:incoming>f0</bpmn:incoming>' : ''}<bpmn:outgoing>f2</bpmn:outgoing></bpmn:${kind}>
    <bpmn:serviceTask id="t" name="Work" camunda:type="external" camunda:topic="acme-work"><bpmn:incoming>f2</bpmn:incoming><bpmn:outgoing>f3</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:endEvent id="e"><bpmn:incoming>f3</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="gw" />
    <bpmn:sequenceFlow id="f2" sourceRef="gw" targetRef="t" />
    <bpmn:sequenceFlow id="f3" sourceRef="t" targetRef="e" />
  </bpmn:process>
</bpmn:definitions>`;
};
const LISTENER = '<camunda:executionListener expression="${execution.setVariable(&#34;count&#34;, execution.getVariable(&#34;count&#34;) + 1)}" event="start" />';
const COUNT = { name: 'count', expression: '= count + 1' };

const parse = (xml: string) => new DOMParser().parseFromString(xml, 'text/xml') as unknown as Document;
const gwOf = (xml: string) => Array.from(parse(xml).querySelectorAll('*')).find(e => e.getAttribute('id') === 'gw');
const tagged = (el: Element | undefined, tag: string) => Array.from(el?.querySelectorAll('*') ?? []).filter(e => e.tagName === tag);
/** the listeners on the gateway, as the engine reads them */
const listeners = (xml: string) => tagged(gwOf(xml), 'camunda:executionListener').map(l => `${l.getAttribute('event')}: ${l.getAttribute('expression')}`);
const comments = (xml: string) => [...xml.matchAll(/<!--([\s\S]*?)-->/g)].map(m => m[1].trim());
const specOf = (xml: string): ProcessSpec => importBpmn(xml, 'p.bpmn').spec;
/** the spec with these rows on the gateway */
const withRows = (spec: ProcessSpec, rows: Pick<Step, 'inputs' | 'outputs'>): ProcessSpec => {
  const copy = structuredClone(spec);
  Object.assign(allSteps(copy.steps).find(s => s.id === 'gw')!, rows);
  return copy;
};
/** the diagram as Orch Spec keeps it, and its export for Camunda 7 */
const both = (xml: string, rows: Pick<Step, 'inputs' | 'outputs'>) => {
  const spec = withRows(specOf(xml), rows);
  return { internal: writeBpmn(xml, spec), exported: exportBpmnFor(spec, xml, 'c7') };
};

test('inside Orch Spec the output stays an inputOutput - only the export changes it', () => {
  const { internal } = both(c7(''), { outputs: [COUNT] });
  assert.equal(tagged(gwOf(internal.xml), 'camunda:outputParameter')[0]?.getAttribute('name'), 'count', internal.xml);
  assert.deepEqual(listeners(internal.xml), []);
});

test('export C7: an output on a gateway becomes a start listener - null-safe, the inputOutput goes', () => {
  const { exported } = both(c7(''), { outputs: [COUNT] });
  assert.deepEqual(tagged(gwOf(exported.xml), 'camunda:inputOutput'), [], exported.xml);
  assert.deepEqual(listeners(exported.xml), ['start: ${execution.setVariable("count", execution.getVariable("count") + 1)}']);
  assert.ok(exported.issues.some(i => i.stepId === 'gw' && i.text.startsWith('Ausgabe «count» als Start-Listener')), JSON.stringify(exported.issues));
});

test('export C7: a listener for the same variable is replaced - not doubled', () => {
  const { exported } = both(c7(LISTENER), { outputs: [{ name: 'count', expression: '= count + 2' }] });
  assert.deepEqual(listeners(exported.xml), ['start: ${execution.setVariable("count", execution.getVariable("count") + 2)}']);
});

test('export C7: a join of a parallel gateway - an end listener', () => {
  const { exported } = both(c7('', { kind: 'parallelGateway', join: true }), { outputs: [COUNT] });
  assert.deepEqual(listeners(exported.xml).map(l => l.split(':')[0]), ['end']);
});

test('export C7: an input on a gateway is left out - a comment and an issue', () => {
  const { exported } = both(c7(''), { inputs: [{ name: 'limit', expression: '= 3' }], outputs: [COUNT] });
  assert.deepEqual(tagged(gwOf(exported.xml), 'camunda:inputOutput'), [], exported.xml);
  assert.deepEqual(comments(exported.xml), [`${C7_LABEL}, nicht übernommen: camunda:inputParameter name="limit"`]);
  assert.ok(exported.issues.some(i => i.stepId === 'gw' && i.text.startsWith('Eingabe «limit» nicht übernommen')), JSON.stringify(exported.issues));
});

test('export C7: an untranslatable output - no listener, a comment and an issue', () => {
  const { exported } = both(c7(''), { outputs: [{ name: 'any', expression: '= some x in xs satisfies x > 1' }] });
  assert.deepEqual(listeners(exported.xml), []);
  assert.deepEqual(tagged(gwOf(exported.xml), 'camunda:inputOutput'), [], exported.xml);
  assert.ok(exported.issues.some(i => i.stepId === 'gw' && i.text.includes('nicht nach JUEL übersetzbar')), JSON.stringify(exported.issues));
});

test('export C7: an output parameter the spec does not know - its JUEL as it is', () => {
  const xml = c7('<camunda:inputOutput><camunda:outputParameter name="count">${count + 1}</camunda:outputParameter></camunda:inputOutput>');
  const exported = exportBpmnFor(withRows(specOf(xml), { outputs: [] }), xml, 'c7');
  assert.deepEqual(listeners(exported.xml), ['start: ${execution.setVariable("count", count + 1)}']);
});

test('export C7: without an inputOutput on a gateway the export is what Orch Spec writes', () => {
  const xml = c7(LISTENER);
  const spec = specOf(xml);
  assert.equal(exportBpmnFor(spec, xml, 'c7').xml, writeBpmn(xml, spec).xml);
});

test('export C8: unchanged - the transform is only for Camunda 7', () => {
  const { exported } = both(c7(''), { outputs: [COUNT] });
  const c8 = exportBpmnFor(withRows(specOf(c7('')), { outputs: [COUNT] }), c7(''), 'c8');
  assert.ok(!c8.xml.includes('camunda:executionListener'), c8.xml);
  assert.ok(exported.xml.includes('camunda:executionListener'));
});
