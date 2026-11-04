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
import { MI_ADDED_MARK, MI_COLLECT_MARK, MI_RESULT_MARK, resultLocals } from '../src/miResult';
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
// the called process returns aId - set in the instance, so a local of the result
const withResult = (s: ProcessSpec, result = { collection: 'results', element: '{aId: aId, item: item}' }, sets: string[] = ['aId']): ProcessSpec => ({
  ...s, steps: s.steps.map(x => (x.id === 'HandleItemsCall' ? { ...x, multiInstance: { ...x.multiInstance, result }, ...(sets.length ? { outputVariables: sets } : {}) } : x)),
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
  const nobody = withResult(base, undefined, []);
  assert.ok(messages(nobody).some(m => m.includes('«aId» setzt kein Schritt')), messages(nobody).join(' / '));
  // the step itself sets it as output: no more «setzt kein Schritt», but «überschreiben sich»
  const withOut = withResult({ ...base, steps: base.steps.map(x => (x.id === 'HandleItemsCall' ? { ...x, outputs: [{ name: 'aId', expression: '= aId' }] } : x)) }, undefined, []);
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

// ── review #115: script text, names, flows, what the generator added ─────────

const c7Spec = () => ({ ...importBpmn(c7(), 'items').spec, engine: 'c7' as const });
const scriptsOf = (xml: string) => [...xml.matchAll(/<camunda:script[^>]*>([\s\S]*?)<\/camunda:script>/g)].map(m => m[1]
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'));
const withoutResult = (xml: string): ProcessSpec => {
  const s = importBpmn(xml, 'items').spec;
  return { ...s, engine: 'c7', steps: s.steps.map(x => ({ ...x, multiInstance: x.multiInstance ? { ...x.multiInstance, result: undefined } : undefined })) };
};

test('Camunda 7: the generated scripts, line by line', () => {
  const [end, take] = scriptsOf(writeBpmn(c7(), withResult(c7Spec())).xml);
  const endLines = end.trim().split('\n');
  assert.equal(endLines[0], `${MI_RESULT_MARK}results = {aId: aId, item: item}`);
  assert.equal(endLines[1], `${MI_ADDED_MARK}asyncAfter locals=aId`);
  assert.deepEqual(endLines.slice(-2), [
    "execution.getProcessInstance().setVariable('results_' + execution.getVariable('loopCounter'), org.camunda.spin.Spin.JSON(groovy.json.JsonOutput.toJson(['aId': v('aId'), 'item': v('item')])))",
    "execution.getProcessInstance().setVariable('results_n', execution.getVariable('nrOfInstances'))",
  ]);
  const takeLines = take.trim().split('\n');
  assert.equal(takeLines[0], `${MI_COLLECT_MARK}results`);
  // the count comes from the engine; without one: empty collection, or collected already
  assert.deepEqual(takeLines.slice(-10), [
    "def n = execution.getVariable('results_n')",
    'if (n == null) {',
    "  def items = v('items')",
    '  if (items != null && items.size() > 0) return',
    '  n = 0',
    '}',
    "def list = (0..<n).collect { v('results_' + it) }",
    "(0..<n).each { execution.removeVariable('results_' + it) }",
    "execution.removeVariable('results_n')",
    "execution.setVariable('results', org.camunda.spin.Spin.JSON(groovy.json.JsonOutput.toJson(list)))",
  ]);
});

test('a list name that is no identifier: nothing written, an error at the step', async () => {
  const { collectFindings } = await import('../src/findings');
  for (const bad of ["res'); System.exit(0); ('", 'res\nults', '1results', 'my results']) {
    const spec = withResult(c7Spec(), { collection: bad, element: '{item: item}' });
    const out = writeBpmn(c7(), spec);
    assert.ok(!out.xml.includes(MI_RESULT_MARK) && !out.xml.includes(MI_COLLECT_MARK), bad);
    assert.doesNotMatch(out.xml, /asyncAfter/);
    const msgs = [...collectFindings(spec, null, allSteps(spec.steps)).values()].flatMap(f => f.errors);
    assert.ok(msgs.some(m => m.includes('kein gültiger Variablenname')), `${bad}: ${msgs.join(' / ')}`);
  }
});

test('taking the result away removes asyncAfter and the locals the generator added - not those set by hand', () => {
  const plain = writeBpmn(writeBpmn(c7(), withResult(c7Spec())).xml, withoutResult(writeBpmn(c7(), withResult(c7Spec())).xml)).xml;
  assert.doesNotMatch(plain, /asyncAfter/);
  assert.doesNotMatch(plain, /inputParameter/);
  assert.doesNotMatch(plain, /executionListener/);
  // set by hand before: asyncAfter and an own aId parameter stay
  const own = c7().replace('<bpmn:callActivity id="HandleItemsCall" name="Handle Items">',
    '<bpmn:callActivity id="HandleItemsCall" name="Handle Items" camunda:asyncAfter="true"><bpmn:extensionElements><camunda:inputOutput><camunda:inputParameter name="aId" /></camunda:inputOutput></bpmn:extensionElements>');
  const ownSpec = { ...importBpmn(own, 'items').spec, engine: 'c7' as const };
  const withIt = writeBpmn(own, withResult(ownSpec)).xml;
  assert.ok(!withIt.includes(MI_ADDED_MARK), 'nothing added');
  const back = writeBpmn(withIt, withoutResult(withIt)).xml;
  assert.match(back, /camunda:asyncAfter="true"/);
  assert.match(back, /<camunda:inputParameter name="aId"\s*\/>/);
});

test('no outgoing flow: nothing written, not half of it', () => {
  const last = c7().replace('<bpmn:outgoing>f2</bpmn:outgoing>', '').replace(/<bpmn:endEvent[\s\S]*?<\/bpmn:endEvent>/, '').replace(/<bpmn:sequenceFlow id="f2"[^>]*\/>/, '');
  const out = writeBpmn(last, withResult({ ...importBpmn(last, 'items').spec, engine: 'c7' }));
  assert.ok(out.issues.some(i => i.where === 'Ergebnisse sammeln' && i.text.startsWith('Kein ausgehender Sequenzfluss')), out.issues.map(i => i.text).join(' / '));
  assert.ok(!out.xml.includes(MI_RESULT_MARK));
  assert.doesNotMatch(out.xml, /asyncAfter|inputParameter/);
});

test('several outgoing flows: each carries the collector, guarded so only the first one collects', () => {
  const two = c7()
    .replace('<bpmn:outgoing>f2</bpmn:outgoing>', '<bpmn:outgoing>f2</bpmn:outgoing><bpmn:outgoing>f3</bpmn:outgoing>')
    .replace('<bpmn:sequenceFlow id="f2"', '<bpmn:endEvent id="EndEvent2"><bpmn:incoming>f3</bpmn:incoming></bpmn:endEvent><bpmn:sequenceFlow id="f3" sourceRef="HandleItemsCall" targetRef="EndEvent2"/><bpmn:sequenceFlow id="f2"');
  const out = writeBpmn(two, withResult({ ...importBpmn(two, 'items').spec, engine: 'c7' })).xml;
  const takes = scriptsOf(out).filter(s => s.trim().startsWith(MI_COLLECT_MARK));
  assert.equal(takes.length, 2);
  for (const t of takes) assert.ok(t.includes('if (items != null && items.size() > 0) return'));
});

test('checks: the same list twice, inside a parallel outer multi-instance', async () => {
  const { stepFindings } = await import('../src/findings');
  const result = { collection: 'results', element: '{item: item}' };
  const inner: Step = { id: 'Inner', name: 'Inner', kind: 'subprocess', multiInstance: { collection: 'item.parts', element: 'part', result }, children: [] } as unknown as Step;
  const outer: Step = { id: 'Outer', name: 'Outer', kind: 'subprocess', multiInstance: { collection: 'items', element: 'item' }, children: [inner] } as unknown as Step;
  const other: Step = { id: 'Other', name: 'Other', kind: 'subprocess', multiInstance: { collection: 'items', element: 'item', result }, children: [] } as unknown as Step;
  const spec = { processId: 'p', engine: 'c7', steps: [outer, other] } as unknown as ProcessSpec;
  const w = (s: Step) => stepFindings(s, spec, null, []).warnings;
  assert.ok(w(inner).some(m => m.includes('sammelt auch «Other»')), w(inner).join(' / '));
  assert.ok(w(inner).some(m => m.includes('in einer parallelen Mehrfachausführung')), w(inner).join(' / '));
  assert.ok(!w(other).some(m => m.includes('in einer parallelen Mehrfachausführung')), 'not nested');
  // Camunda 8: native, no helpers - only the same list name counts
  const c8spec = { ...spec, engine: 'c8' } as ProcessSpec;
  const w8 = stepFindings(inner, c8spec, null, []).warnings;
  assert.ok(w8.some(m => m.includes('sammelt auch')) && !w8.some(m => m.includes('parallelen Mehrfachausführung')), w8.join(' / '));
});

test('locals: only what the instance sets - a variable from the process stays readable', async () => {
  const { collectFindings } = await import('../src/findings');
  const result = { collection: 'results', element: '{aId: aId, customerId: customerId}' };
  // C8: customerId is read from the process - no =null for it
  const c8spec = withResult({ ...importBpmn(c8(), 'items').spec, engine: 'c8' as const }, result);
  const xml8 = writeBpmn(c8(), c8spec).xml;
  assert.match(xml8, /target="aId"/);
  assert.doesNotMatch(xml8, /target="customerId"/);
  // C7 likewise
  const xml7 = writeBpmn(c7(), withResult(c7Spec(), result)).xml;
  assert.match(xml7, /<camunda:inputParameter name="aId"/);
  assert.doesNotMatch(xml7, /name="customerId"/);
  // the check: unknown in the process, it stays null in each entry
  const msgs = [...collectFindings(c8spec, null, allSteps(c8spec.steps)).values()].flatMap(f => f.warnings);
  assert.ok(msgs.some(m => m.includes('«customerId» setzt kein Schritt')), msgs.join(' / '));
  assert.ok(!msgs.some(m => m.includes('«aId»')), 'aId is set in the instance');
});

test('Camunda 8: taking the result away removes the =null locals too', () => {
  const spec8 = { ...importBpmn(c8(), 'items').spec, engine: 'c8' as const };
  const with8 = writeBpmn(c8(), withResult(spec8)).xml;
  assert.match(with8, /source="=null"/);
  const back = importBpmn(with8, 'items').spec;
  const without = writeBpmn(with8, { ...back, engine: 'c8', steps: back.steps.map(x => ({ ...x, multiInstance: x.multiInstance ? { ...x.multiInstance, result: undefined } : undefined })) }).xml;
  assert.doesNotMatch(without, /source="=null"|outputCollection/);
  // another entry: the old local goes, the new one comes
  const changed = writeBpmn(with8, withResult({ ...back, engine: 'c8' }, { collection: 'results', element: '{bId: bId}' }, ['bId'])).xml;
  assert.doesNotMatch(changed, /target="aId"/);
  assert.match(changed, /target="bId"/);
});

test('Camunda 7: a collector on a flow moved to another source is removed', () => {
  const xml = writeBpmn(c7(), withResult(c7Spec())).xml;
  // in the modeler: f2 now starts at the start event, f1 leaves the call activity
  const moved = xml.replace('<bpmn:sequenceFlow id="f2" sourceRef="HandleItemsCall"', '<bpmn:sequenceFlow id="f2" sourceRef="StartEvent"');
  assert.ok(moved !== xml && moved.includes(MI_COLLECT_MARK));
  const again = writeBpmn(moved, { ...withResult(importBpmn(moved, 'items').spec), engine: 'c7' });
  assert.ok(!again.xml.includes(MI_COLLECT_MARK), 'no flow leaves the step any more - no collector anywhere');
});

test('Camunda 8: an instance variable without a collection is reported, no half loop written', () => {
  const plain = c8('<bpmn:multiInstanceLoopCharacteristics />');
  const spec = importBpmn(plain, 'items').spec;
  const out = writeBpmn(plain, { ...spec, engine: 'c8', steps: spec.steps.map(x => (x.id === 'HandleItemsCall' ? { ...x, multiInstance: { element: 'item' } } : x)) });
  assert.ok(out.issues.some(i => i.where === 'Mehrfachausführung' && i.text.includes('inputCollection')), out.issues.map(i => i.text).join(' / '));
  assert.doesNotMatch(out.xml, /zeebe:loopCharacteristics/);
});

