// Results of a multi-instance as one list: Camunda 8 natively (outputCollection /
// outputElement, the read variables local per instance), Camunda 7 generated (local
// parameters, an end listener per instance, asyncAfter, a take listener that collects).
// The import reads the construct back; the locals are no inputs of the step.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { allSteps, importBpmn, mergeSpec } from '../src/bpmn';
import { writeBpmn } from '../src/bpmnWrite';
import { variablesByStep } from '../src/feel';
import { MI_COLLECT_MARK, MI_RESULT_MARK, resultLocals } from '../src/miResult';
import type { ProcessSpec, Step } from '../src/types';
import { installXmlNamespaces } from './xmlNamespaces';

const g = globalThis as unknown as Record<string, unknown>;
g.DOMParser ??= DOMParser;
g.XMLSerializer ??= class { serializeToString(doc: { toString(): string }) { return doc.toString(); } };
installXmlNamespaces();

const c8 = (mi = '<bpmn:multiInstanceLoopCharacteristics><bpmn:extensionElements><zeebe:loopCharacteristics inputCollection="=items" inputElement="item" /></bpmn:extensionElements></bpmn:multiInstanceLoopCharacteristics>') => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:zeebe="http://camunda.org/schema/zeebe/1.0" xmlns:modeler="http://camunda.org/schema/modeler/1.0" modeler:executionPlatform="Camunda Cloud" id="d" targetNamespace="x">
  <bpmn:process id="acme-itemsV1" isExecutable="true">
    <bpmn:startEvent id="StartEvent"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:callActivity id="HandleItemsCall" name="Handle Items"><bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing>${mi}</bpmn:callActivity>
    <bpmn:endEvent id="EndEvent"><bpmn:incoming>f2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="f1" sourceRef="StartEvent" targetRef="HandleItemsCall"/>
    <bpmn:sequenceFlow id="f2" sourceRef="HandleItemsCall" targetRef="EndEvent"/>
  </bpmn:process>
</bpmn:definitions>`;
const c7 = () => c8('<bpmn:multiInstanceLoopCharacteristics camunda:collection="items" camunda:elementVariable="item" />')
  .replace('xmlns:zeebe="http://camunda.org/schema/zeebe/1.0"', 'xmlns:camunda="http://camunda.org/schema/1.0/bpmn"')
  .replace('Camunda Cloud', 'Camunda Platform');

const stepOf = (s: ProcessSpec) => allSteps(s.steps).find(x => x.id === 'HandleItemsCall')!;
const withResult = (s: ProcessSpec, result = { collection: 'results', element: '{aId: aId, item: item}' }): ProcessSpec => ({
  ...s, steps: s.steps.map(x => (x.id === 'HandleItemsCall' ? { ...x, multiInstance: { ...x.multiInstance, result } } : x)),
});

test('locals: what the entry reads - without the element and the engine variables', () => {
  assert.deepEqual(resultLocals({ element: 'item', result: { collection: 'r', element: '{aId: aId, item: item, n: loopCounter, b: bId}' } }), ['aId', 'bId']);
});

test('Camunda 8: outputCollection and outputElement, the locals as =null inputs - and back', () => {
  const spec = { ...importBpmn(c8(), 'items').spec, engine: 'c8' as const };
  const out = writeBpmn(c8(), withResult(spec));
  assert.match(out.xml, /outputCollection="results"/);
  assert.match(out.xml, /outputElement="=\{aId: aId, item: item\}"/);
  assert.match(out.xml, /<zeebe:input (source="=null" target="aId"|target="aId" source="=null")/);
  assert.doesNotMatch(out.xml, /target="item"/);
  const back = stepOf(importBpmn(out.xml, 'items').spec);
  assert.deepEqual(back.multiInstance?.result, { collection: 'results', element: '{aId: aId, item: item}' });
  assert.equal((back.inputs ?? []).some(m => m.name === 'aId'), false, 'the local is no input');
  // exported again: the same, not twice
  const again = writeBpmn(out.xml, withResult(importBpmn(out.xml, 'items').spec)).xml;
  assert.equal(again.match(/target="aId"/g)?.length, 1);
});

test('Camunda 7: local parameter, end listener per instance, asyncAfter, collecting take listener - and back', () => {
  const spec = { ...importBpmn(c7(), 'items').spec, engine: 'c7' as const };
  const out = writeBpmn(c7(), withResult(spec));
  assert.deepEqual(out.issues.filter(i => i.where === 'Ergebnisse sammeln'), []);
  assert.match(out.xml, /<camunda:inputParameter name="aId"\s*\/>/);
  assert.match(out.xml, /camunda:asyncAfter="true"/);
  assert.ok(out.xml.includes(`${MI_RESULT_MARK}results = {aId: aId, item: item}`));
  assert.match(out.xml, /execution\.getProcessInstance\(\)\.setVariable\('results_' \+ execution\.getVariable\('loopCounter'\)/);
  assert.match(out.xml, /<camunda:executionListener event="take">/);
  assert.ok(out.xml.includes(`${MI_COLLECT_MARK}results`));
  assert.match(out.xml, /def items = v\('items'\)/);
  assert.match(out.xml, /execution\.removeVariable\('results_' \+ it\)/);
  const back = stepOf(importBpmn(out.xml, 'items').spec);
  assert.deepEqual(back.multiInstance?.result, { collection: 'results', element: '{aId: aId, item: item}' });
  assert.equal((back.inputs ?? []).some(m => m.name === 'aId'), false, 'the local is no input');
  // exported again: one listener each, not two
  const again = writeBpmn(out.xml, { ...withResult(importBpmn(out.xml, 'items').spec), engine: 'c7' }).xml;
  assert.equal(again.split(MI_RESULT_MARK).length - 1, 1);
  assert.equal(again.split(MI_COLLECT_MARK).length - 1, 1);
});

test('the result taken away at the step: out of the diagram too', () => {
  const spec7 = { ...importBpmn(c7(), 'items').spec, engine: 'c7' as const };
  const with7 = writeBpmn(c7(), withResult(spec7)).xml;
  const without7 = writeBpmn(with7, { ...importBpmn(with7, 'items').spec, engine: 'c7', steps: importBpmn(with7, 'items').spec.steps.map(x => ({ ...x, multiInstance: x.multiInstance ? { ...x.multiInstance, result: undefined } : undefined })) }).xml;
  assert.ok(!without7.includes(MI_RESULT_MARK) && !without7.includes(MI_COLLECT_MARK));
  const spec8 = { ...importBpmn(c8(), 'items').spec, engine: 'c8' as const };
  const with8 = writeBpmn(c8(), withResult(spec8)).xml;
  const back8 = importBpmn(with8, 'items').spec;
  const without8 = writeBpmn(with8, { ...back8, engine: 'c8', steps: back8.steps.map(x => ({ ...x, multiInstance: x.multiInstance ? { ...x.multiInstance, result: undefined } : undefined })) }).xml;
  assert.doesNotMatch(without8, /outputCollection/);
});

test('merge: a change of the diagram keeps the result set at the step', () => {
  const base = importBpmn(c8(), 'items').spec;
  const edited = withResult(base);
  const merged = mergeSpec(importBpmn(c8(), 'items').spec, edited, base).spec;
  assert.deepEqual(stepOf(merged).multiInstance?.result, { collection: 'results', element: '{aId: aId, item: item}' });
});

test('after the step the process knows the list - with the fields of the entry', () => {
  const base = importBpmn(c8(), 'items').spec;
  const s: ProcessSpec = { ...withResult(base), steps: [...withResult(base).steps] };
  const end = variablesByStep(s, null).get('EndEvent')!;
  const results = end.find(v => v.name === 'results');
  assert.equal(results?.type, 'list');
  assert.deepEqual(results?.children?.map(c => c.name), ['aId', 'item']);
  assert.equal(variablesByStep(s, null).get('HandleItemsCall')!.some(v => v.name === 'results'), false, 'not yet at the step itself');
});

test('engine conversion: C8 → C7 generates the construct, C7 → C8 makes it native again', async () => {
  const { convertBpmn } = await import('../src/engineConvert');
  const spec = { ...importBpmn(c8(), 'items').spec, engine: 'c8' as const };
  const xml8 = writeBpmn(c8(), withResult(spec)).xml;
  const to7 = convertBpmn(xml8, 'c7');
  assert.ok(to7.xml.includes(`${MI_RESULT_MARK}results = {aId: aId, item: item}`), to7.xml);
  assert.ok(to7.xml.includes(`${MI_COLLECT_MARK}results`));
  assert.match(to7.xml, /<camunda:inputParameter name="aId"\s*\/>/);
  assert.doesNotMatch(to7.xml, /\$\{null\}/);
  assert.deepEqual(to7.issues.filter(i => /outputCollection|Ergebnisse/.test(i.text + i.where)), []);
  const back = convertBpmn(to7.xml, 'c8');
  assert.match(back.xml, /outputCollection="results"/);
  assert.match(back.xml, /outputElement="=\{aId: aId, item: item\}"/);
  assert.ok(!back.xml.includes(MI_RESULT_MARK) && !back.xml.includes(MI_COLLECT_MARK));
  assert.deepEqual(back.issues.filter(i => i.where === 'Listener'), [], back.issues.map(i => i.text).join(' / '));
  assert.equal(back.xml.match(/target="aId"/g)?.length, 1);
});

test('checks: a local nobody sets, outputs on a parallel multi-instance, a C7 worker without manual mapping', async () => {
  const { collectFindings } = await import('../src/findings');
  const messages = (s: ProcessSpec) => [...collectFindings(s, null, allSteps(s.steps)).values()].flatMap(f => [...f.errors, ...f.warnings]);
  const base = { ...importBpmn(c8(), 'items').spec, engine: 'c8' as const };
  // nobody sets aId
  assert.ok(messages(withResult(base)).some(m => m.includes('«aId» setzt kein Schritt')), messages(withResult(base)).join(' / '));
  // the step itself sets it as output: no more «setzt kein Schritt», but «überschreiben sich»
  const withOut = withResult({ ...base, steps: base.steps.map(x => (x.id === 'HandleItemsCall' ? { ...x, outputs: [{ name: 'aId', expression: '= aId' }] } : x)) });
  const m2 = messages(withOut);
  assert.ok(!m2.some(m => m.includes('setzt kein Schritt')), m2.join(' / '));
  assert.ok(m2.some(m => m.includes('überschreiben sich')), m2.join(' / '));
  // Camunda 7: a worker in the collecting multi-instance without manual mapping
  const worker: ProcessSpec = {
    ...withResult(base), engine: 'c7',
    steps: withResult(base).steps.map(x => (x.id === 'HandleItemsCall' ? { ...x, kind: 'service' as const, topic: 'acme-items-handle', outputVariables: ['aId'] } : x)),
  };
  assert.ok(messages(worker).some(m => m.includes('ohne manuelles Output-Mapping')), messages(worker).join(' / '));
});
