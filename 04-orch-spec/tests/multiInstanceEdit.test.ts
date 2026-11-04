// Multi-instance: the marker comes from the diagram, the collection and the
// variable for the current element are set at the step and written on export -
// Camunda 8 as `zeebe:loopCharacteristics`, Camunda 7 as `camunda:collection` /
// `camunda:elementVariable`. A change of the diagram does not lose them.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { allSteps, importBpmn, mergeSpec } from '../src/bpmn';
import { writeBpmn } from '../src/bpmnWrite';
import type { ProcessSpec, Step } from '../src/types';
import { installXmlNamespaces } from './xmlNamespaces';

const g = globalThis as unknown as Record<string, unknown>;
g.DOMParser ??= DOMParser;
g.XMLSerializer ??= class { serializeToString(doc: { toString(): string }) { return doc.toString(); } };
installXmlNamespaces();

const c8 = (mi = '<bpmn:multiInstanceLoopCharacteristics isSequential="true" />') => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:zeebe="http://camunda.org/schema/zeebe/1.0" xmlns:modeler="http://camunda.org/schema/modeler/1.0" modeler:executionPlatform="Camunda Cloud" id="d" targetNamespace="x">
  <bpmn:process id="acme-lettersV1" isExecutable="true">
    <bpmn:startEvent id="StartEvent"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:serviceTask id="SendLettersTask" name="Send Letters"><bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing>${mi}</bpmn:serviceTask>
    <bpmn:endEvent id="EndEvent"><bpmn:incoming>f2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="f1" sourceRef="StartEvent" targetRef="SendLettersTask"/>
    <bpmn:sequenceFlow id="f2" sourceRef="SendLettersTask" targetRef="EndEvent"/>
  </bpmn:process>
</bpmn:definitions>`;
const c7 = (mi = '<bpmn:multiInstanceLoopCharacteristics />') => c8(mi)
  .replace('xmlns:zeebe="http://camunda.org/schema/zeebe/1.0"', 'xmlns:camunda="http://camunda.org/schema/1.0/bpmn"')
  .replace('Camunda Cloud', 'Camunda Platform');

const stepOf = (s: ProcessSpec) => allSteps(s.steps).find(x => x.id === 'SendLettersTask')!;
const withMi = (s: ProcessSpec, mi: Step['multiInstance']): ProcessSpec => {
  const walk = (steps: Step[]): Step[] => steps.map(x => (x.id === 'SendLettersTask' ? { ...x, multiInstance: mi } : x));
  return { ...s, steps: walk(s.steps) };
};

test('Camunda 8: collection and element go into zeebe:loopCharacteristics - and come back', () => {
  const spec = { ...importBpmn(c8(), 'letters').spec, engine: 'c8' as const };
  assert.deepEqual(stepOf(spec).multiInstance, { sequential: true });
  const out = writeBpmn(c8(), withMi(spec, { collection: 'letters', element: 'letter', sequential: true }));
  assert.match(out.xml, /<zeebe:loopCharacteristics [^>]*inputCollection="=letters"/);
  assert.match(out.xml, /<zeebe:loopCharacteristics [^>]*inputElement="letter"/);
  assert.deepEqual(out.issues.filter(i => i.where === 'Mehrfachausführung'), []);
  assert.deepEqual(stepOf(importBpmn(out.xml, 'letters').spec).multiInstance, { collection: 'letters', element: 'letter', sequential: true });
});

test('Camunda 7: a variable by its name, a path into JSON as a Java list - and camunda:elementVariable', () => {
  const spec = { ...importBpmn(c7(), 'letters').spec, engine: 'c7' as const };
  const byName = writeBpmn(c7(), withMi(spec, { collection: 'letters', element: 'letter' }));
  assert.match(byName.xml, /camunda:collection="letters"/);
  assert.match(byName.xml, /camunda:elementVariable="letter"/);
  assert.deepEqual(stepOf(importBpmn(byName.xml, 'letters').spec).multiInstance, { collection: 'letters', element: 'letter' });
  const path = writeBpmn(c7(), withMi(spec, { collection: 'order.letters', element: 'letter' }));
  assert.match(path.xml, /camunda:collection="\$\{order\.prop\(&quot;letters&quot;\)\.elements\(\)\}"/);
  assert.deepEqual(path.issues.filter(i => i.where === 'Mehrfachausführung'), []);
});

test('Camunda 7: the same collection in its own notation stays; emptied at the step, out of the diagram', () => {
  const xml = c7('<bpmn:multiInstanceLoopCharacteristics camunda:collection="letters" camunda:elementVariable="letter" />');
  const spec = { ...importBpmn(xml, 'letters').spec, engine: 'c7' as const };
  const same = writeBpmn(xml, spec).xml;
  assert.match(same, /camunda:collection="letters"/);
  const cleared = writeBpmn(xml, withMi(spec, {})).xml;
  assert.doesNotMatch(cleared, /camunda:collection|camunda:elementVariable/);
});

test('merge: a change of the diagram keeps what was set at the step - the diagram keeps sequential', () => {
  const base = importBpmn(c8('<bpmn:multiInstanceLoopCharacteristics />'), 'letters').spec;
  const edited = withMi(base, { collection: 'letters', element: 'letter' });
  // in the diagram: now sequential, the collection still not set there
  const fresh = importBpmn(c8(), 'letters').spec;
  const merged = mergeSpec(fresh, edited, base).spec;
  assert.deepEqual(stepOf(merged).multiInstance, { collection: 'letters', element: 'letter', sequential: true });
  // the marker taken away in the diagram: no multi-instance any more
  const gone = mergeSpec(importBpmn(c8(''), 'letters').spec, edited, base).spec;
  assert.equal(stepOf(gone).multiInstance, undefined);
});

test('merge: a collection changed in the diagram wins', () => {
  const xml = c8('<bpmn:multiInstanceLoopCharacteristics><bpmn:extensionElements><zeebe:loopCharacteristics inputCollection="=a" inputElement="x" /></bpmn:extensionElements></bpmn:multiInstanceLoopCharacteristics>');
  const base = importBpmn(xml, 'letters').spec;
  const edited = withMi(base, { collection: 'b', element: 'y' });
  const fresh = importBpmn(xml.replace('=a', '=c'), 'letters').spec;
  assert.deepEqual(stepOf(mergeSpec(fresh, edited, base).spec).multiInstance, { collection: 'c', element: 'y' });
});

// ── review #115: the C7 collection, and writing twice changes nothing ────────

const c7Write = (collection: string, mi = '<bpmn:multiInstanceLoopCharacteristics />') => {
  const spec = { ...importBpmn(c7(mi), 'letters').spec, engine: 'c7' as const };
  return writeBpmn(c7(mi), withMi(spec, { collection, element: 'x' }));
};
const miIssues = (r: ReturnType<typeof writeBpmn>) => r.issues.filter(i => i.where === 'Mehrfachausführung').map(i => i.text);

test('Camunda 7 collection: a path gets .elements(), a filter stays a list, anything else is reported', () => {
  const nested = c7Write('a.b.c');
  assert.match(nested.xml, /camunda:collection="\$\{a\.prop\(&quot;b&quot;\)\.prop\(&quot;c&quot;\)\.elements\(\)\}"/);
  assert.deepEqual(miIssues(nested), []);
  const filter = c7Write('a[item.x > 1]');
  assert.match(filter.xml, /\.elementList\(\)\}"/);
  assert.doesNotMatch(filter.xml, /\.elements\(\)/);
  assert.deepEqual(miIssues(filter), []);
  // one entry of a list - no list itself
  const one = c7Write('items[1]');
  assert.match(one.xml, /camunda:collection="\$\{items\[0\]\}"/);
  assert.ok(miIssues(one).some(t => t.includes('muss eine Liste liefern')), miIssues(one).join(' / '));
  // no JUEL counterpart: the issue of the translation
  assert.ok(miIssues(c7Write('reverse(items)')).some(t => t.includes('nicht nach JUEL übersetzbar')));
});

test('written twice: the second export changes nothing - in the notation of the diagram', () => {
  const twice = (xml: string, engine: 'c7' | 'c8') => {
    const first = writeBpmn(xml, { ...importBpmn(xml, 'letters').spec, engine }).xml;
    const second = writeBpmn(first, { ...importBpmn(first, 'letters').spec, engine }).xml;
    return { first, second };
  };
  for (const [xml, engine, keep] of [
    [c7('<bpmn:multiInstanceLoopCharacteristics camunda:collection="${items}" camunda:elementVariable="item" />'), 'c7', 'camunda:collection="${items}"'],
    [c7('<bpmn:multiInstanceLoopCharacteristics camunda:collection="items" camunda:elementVariable="item" />'), 'c7', 'camunda:collection="items"'],
    [c8('<bpmn:multiInstanceLoopCharacteristics><bpmn:extensionElements><zeebe:loopCharacteristics inputCollection="=  items " inputElement="item" /></bpmn:extensionElements></bpmn:multiInstanceLoopCharacteristics>'), 'c8', 'inputCollection="=  items "'],
  ] as const) {
    const { first, second } = twice(xml, engine);
    assert.ok(first.includes(keep), `${keep}\n${first}`);
    assert.equal(second, first);
  }
});
