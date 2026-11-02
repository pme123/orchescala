// Switch engine with the patterns: what a pattern carries goes over in the form of its BPMN for
// the target engine, not as an expression translated piece by piece.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { convertBpmn } from '../src/engineConvert';
import { importBpmn } from '../src/bpmn';
import { juelOptions } from '../src/feel';
import { convertWithPatterns } from '../src/patternConvert';
import { STANDARD_PATTERNS, applyPattern, detectPatterns } from '../src/patterns';
import type { EngineId, PatternDef } from '../src/types';
import { installXmlNamespaces } from './xmlNamespaces';

const g = globalThis as unknown as Record<string, unknown>;
g.DOMParser ??= DOMParser;
g.XMLSerializer ??= class { serializeToString(doc: { toString(): string }) { return doc.toString(); } };
installXmlNamespaces();

const BPMN = 'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"';
const NS: Record<EngineId, string> = {
  c7: `${BPMN} xmlns:camunda="http://camunda.org/schema/1.0/bpmn" xmlns:modeler="http://camunda.org/schema/modeler/1.0" modeler:executionPlatform="Camunda Platform"`,
  c8: `${BPMN} xmlns:zeebe="http://camunda.org/schema/zeebe/1.0" xmlns:modeler="http://camunda.org/schema/modeler/1.0" modeler:executionPlatform="Camunda Cloud"`,
};
/** start → take over → reset → end */
const diagram = (engine: EngineId) => `<bpmn:definitions ${NS[engine]} id="d">
  <bpmn:process id="acme-demoV1" isExecutable="true">
    <bpmn:startEvent id="Start"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:intermediateThrowEvent id="TakeOver"><bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing></bpmn:intermediateThrowEvent>
    <bpmn:intermediateThrowEvent id="Reset"><bpmn:incoming>f2</bpmn:incoming><bpmn:outgoing>f3</bpmn:outgoing></bpmn:intermediateThrowEvent>
    <bpmn:endEvent id="End"><bpmn:incoming>f3</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="f1" sourceRef="Start" targetRef="TakeOver" />
    <bpmn:sequenceFlow id="f2" sourceRef="TakeOver" targetRef="Reset" />
    <bpmn:sequenceFlow id="f3" sourceRef="Reset" targetRef="End" />
  </bpmn:process>
</bpmn:definitions>`;
const std = (id: string) => STANDARD_PATTERNS.find(p => p.id === id)!;
/** the diagram with «Identität übernehmen», «Identität zurücksetzen» and the status, on the engine */
const withPatterns = (engine: EngineId) => {
  let xml = diagram(engine);
  for (const [id, target, params] of [['identity-take-over', 'TakeOver', {}], ['identity-reset', 'Reset', {}], ['process-status', 'End', { processStatus: 'succeeded' }]] as const) {
    const r = applyPattern(xml, std(id), engine, target, params);
    assert.ok(r.changed, r.issues.join('; '));
    xml = r.xml;
  }
  return xml;
};
const hitsOf = (xml: string, engine: EngineId) =>
  detectPatterns(xml, STANDARD_PATTERNS, engine).hits.map(h => [h.patternId, h.targetId]).sort();

test('C7 → C8: the identity patterns go over in their C8 form - nothing to adjust by hand', () => {
  const c7 = withPatterns('c7');
  // without the patterns the listeners with getVariableTyped have no FEEL translation
  const plain = convertBpmn(c7, 'c8');
  assert.ok(plain.issues.some(i => i.stepId === 'TakeOver' && i.text.includes('nicht nach FEEL')), plain.issues.map(i => i.text).join('; '));
  const res = convertWithPatterns(c7, 'c8', STANDARD_PATTERNS);
  assert.deepEqual(res.issues, []);
  assert.ok(!res.xml.includes('getVariableTyped'), 'no JUEL left');
  assert.deepEqual(hitsOf(res.xml, 'c8'), hitsOf(withPatterns('c8'), 'c8'));
  // the order of the outputs counts on C8: first save the identity, then take over
  const take = /<bpmn:intermediateThrowEvent id="TakeOver"[\s\S]*?<\/bpmn:intermediateThrowEvent>/.exec(res.xml)![0];
  assert.ok(take.indexOf('target="_identityCorrelationBefore"') < take.indexOf('target="_identityCorrelation"'), take);
  assert.equal((take.match(/<zeebe:output /g) ?? []).length, 2, 'no output twice');
});

test('C8 → C7: the identity patterns go over in their C7 form', () => {
  const res = convertWithPatterns(withPatterns('c8'), 'c7', STANDARD_PATTERNS, { timeToLive: '5' });
  assert.deepEqual(res.issues, []);
  assert.deepEqual(hitsOf(res.xml, 'c7'), hitsOf(withPatterns('c7'), 'c7'));
  assert.ok(res.xml.includes('execution.getVariableTyped(&quot;_identityCorrelationBefore&quot;)') || res.xml.includes('execution.getVariableTyped("_identityCorrelationBefore")'), 'the C7 listener of the reset');
});

test('without patterns the conversion is the same as before', () => {
  const xml = diagram('c7');
  assert.deepEqual(convertWithPatterns(xml, 'c8', STANDARD_PATTERNS), convertBpmn(xml, 'c8'));
  assert.deepEqual(convertWithPatterns(withPatterns('c7'), 'c8', []), convertBpmn(withPatterns('c7'), 'c8'));
  // already in the form of the target: unchanged
  const c8 = withPatterns('c8');
  assert.equal(convertWithPatterns(c8, 'c8', STANDARD_PATTERNS).changed, false);
});

test('a pattern without BPMN for the target engine is said - the rest is converted as before', () => {
  const take = std('identity-take-over');
  const onlyC7: PatternDef = { ...take, bpmn: { c7: take.bpmn.c7 } };
  const res = convertWithPatterns(withPatterns('c7'), 'c8', [onlyC7]);
  assert.ok(res.issues.some(i => i.stepId === 'TakeOver' && i.where === 'Pattern' && i.text.includes('kein BPMN')), res.issues.map(i => i.text).join('; '));
  // the untranslated listener stays reported
  assert.ok(res.issues.some(i => i.stepId === 'TakeOver' && i.text.includes('nicht nach FEEL')));
});

test('C7 → C8 → C7: the patterns come back in their C7 form only - no output parameters beside the listeners', () => {
  const c7 = withPatterns('c7');
  const c8 = convertWithPatterns(c7, 'c8', STANDARD_PATTERNS);
  const back = convertWithPatterns(c8.xml, 'c7', STANDARD_PATTERNS, { timeToLive: '5' });
  assert.deepEqual([...c8.issues, ...back.issues], []);
  assert.deepEqual(hitsOf(back.xml, 'c7'), hitsOf(c7, 'c7'));
  for (const id of ['TakeOver', 'Reset', 'End']) {
    const el = (x: string) => new RegExp(`<bpmn:\\w+ id="${id}"[\\s\\S]*?</bpmn:\\w+Event>`).exec(x)![0];
    const listeners = (x: string) => (el(x).match(/<camunda:executionListener /g) ?? []).length;
    assert.ok(!/outputParameter|inputOutput/.test(el(back.xml)), `${id}: ${el(back.xml)}`);
    assert.equal(listeners(back.xml), listeners(c7), id);
  }
});

test('C8 → C7 → C8: the identity outputs come back once each', () => {
  const c8 = withPatterns('c8');
  const back = convertWithPatterns(convertWithPatterns(c8, 'c7', STANDARD_PATTERNS, { timeToLive: '5' }).xml, 'c8', STANDARD_PATTERNS);
  assert.deepEqual(back.issues, []);
  const take = /<bpmn:intermediateThrowEvent id="TakeOver"[\s\S]*?<\/bpmn:intermediateThrowEvent>/.exec(back.xml)![0];
  assert.equal((take.match(/<zeebe:output /g) ?? []).length, 2, take);
  assert.ok(!take.includes('camunda:'), take);
});

test('C8 → C7 with the variables of the specification: a Spin path to a text ends with stringValue()', () => {
  // an input that reads the user name of the identity
  const c8 = diagram('c8').replace('<bpmn:endEvent id="End">',
    '<bpmn:endEvent id="End"><bpmn:extensionElements><zeebe:ioMapping><zeebe:output source="=_identityCorrelation.username" target="who" /></zeebe:ioMapping></bpmn:extensionElements>');
  const spec = { ...importBpmn(c8, 'x.bpmn').spec, engine: 'c8' as const };
  const plain = convertBpmn(c8, 'c7', { timeToLive: '5' }).xml;
  const typed = convertBpmn(c8, 'c7', { timeToLive: '5', juel: juelOptions(spec, null) }).xml;
  assert.ok(!plain.includes('stringValue()'), 'without the variables nobody knows the type');
  assert.ok(typed.includes('_identityCorrelation.prop("username").stringValue()') || typed.includes('_identityCorrelation.prop(&quot;username&quot;).stringValue()'), typed);
});
