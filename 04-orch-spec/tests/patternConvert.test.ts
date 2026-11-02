// Switch engine with the patterns: what a pattern carries goes over in the form of its BPMN for
// the target engine, not as an expression translated piece by piece.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { convertBpmn } from '../src/engineConvert';
import { importBpmn } from '../src/bpmn';
import { juelOptions } from '../src/feel';
import { convertWithPatterns } from '../src/patternConvert';
import { exportBpmnFor } from '../src/exporters';
import { STANDARD_PATTERNS, applyPattern, detectPatterns } from '../src/patterns';
import type { EngineId, Model, PatternDef } from '../src/types';
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

/** the element with the ID - read with the DOM, attribute values unescaped */
const below = (el: Element): Element[] => Array.from(el.children).flatMap(c => [c, ...below(c)]);
const elementOf = (xml: string, id: string): Element => {
  const doc = new DOMParser().parseFromString(xml, 'text/xml') as unknown as Document;
  const el = below(doc.documentElement).find(e => e.getAttribute('id') === id);
  assert.ok(el, `${id} in the diagram`);
  return el;
};
const named = (el: Element, tag: string): Element[] => below(el).filter(e => e.tagName === tag);
/** what an element sets: zeebe outputs (target=source), C7 listener expressions, C7 output parameters */
const setsOf = (xml: string, id: string) => {
  const el = elementOf(xml, id);
  return {
    outputs: named(el, 'zeebe:output').map(o => `${o.getAttribute('target')}=${o.getAttribute('source')}`),
    listeners: named(el, 'camunda:executionListener').map(l => l.getAttribute('expression') ?? ''),
    outputParameters: named(el, 'camunda:outputParameter').map(o => o.getAttribute('name') ?? ''),
  };
};

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
  assert.deepEqual(setsOf(res.xml, 'TakeOver').outputs, setsOf(withPatterns('c8'), 'TakeOver').outputs);
  assert.deepEqual(setsOf(res.xml, 'TakeOver').outputs.map(o => o.split('=')[0]), ['_identityCorrelationBefore', '_identityCorrelation']);
});

test('C8 → C7: the identity patterns go over in their C7 form', () => {
  const res = convertWithPatterns(withPatterns('c8'), 'c7', STANDARD_PATTERNS, { timeToLive: '5' });
  assert.deepEqual(res.issues, []);
  assert.deepEqual(hitsOf(res.xml, 'c7'), hitsOf(withPatterns('c7'), 'c7'));
  for (const id of ['TakeOver', 'Reset', 'End']) assert.deepEqual(setsOf(res.xml, id), setsOf(withPatterns('c7'), id), id);
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

test('a pattern whose target BPMN does not fit the element is said - it is missing there afterwards', () => {
  const take = std('identity-take-over');
  // its C8 form belongs to the process, not to an element: it cannot go back onto TakeOver
  const misfit: PatternDef = { ...take, id: 'acme-misfit', bpmn: { c7: take.bpmn.c7, c8: std('unique-execution').bpmn.c8 } };
  const res = convertWithPatterns(withPatterns('c7'), 'c8', [misfit]);
  assert.ok(res.issues.some(i => i.stepId === 'TakeOver' && i.where === 'Pattern' && i.text.includes('liess sich nicht')), res.issues.map(i => i.text).join('; '));
  // it is not lost: converted like the rest - its listeners became outputs, untranslated where needed
  assert.equal(setsOf(res.xml, 'TakeOver').outputs.length, 2, res.xml);
  assert.ok(res.issues.some(i => i.stepId === 'TakeOver' && i.text.includes('nicht nach FEEL')));
});

test('a parameter that comes back different is said', () => {
  // the C8 form names the parameter differently - the value of «processStatus» does not arrive
  const status = std('process-status');
  const renamed: PatternDef = { ...status, id: 'acme-status', bpmn: { c7: status.bpmn.c7, c8: status.bpmn.c8!.replace('{{processStatus}}', '{{state}}') } };
  const res = convertWithPatterns(withPatterns('c7'), 'c8', [renamed]);
  assert.ok(res.issues.some(i => i.stepId === 'End' && i.text.includes('«processStatus» war «succeeded», ist jetzt «»')), res.issues.map(i => i.text).join('; '));
});

test('two patterns on one element both come over', () => {
  const status = std('process-status');
  // an own pattern on end events that sets something else
  const audit = (engine: EngineId): PatternDef => ({
    ...status, id: 'acme-audit', name: 'Audit', params: [],
    bpmn: { c7: status.bpmn.c7!.replace(/processStatus/g, 'audited').replace(/\{\{audited\}\}/g, 'yes'), c8: status.bpmn.c8!.replace(/processStatus/g, 'audited').replace(/\{\{audited\}\}/g, 'yes') },
  });
  const defs = [...STANDARD_PATTERNS, audit('c7')];
  const c7 = applyPattern(withPatterns('c7'), audit('c7'), 'c7', 'End').xml;
  const at = (xml: string, engine: EngineId) => detectPatterns(xml, defs, engine).hits.filter(h => h.targetId === 'End').map(h => h.patternId).sort();
  assert.deepEqual(at(c7, 'c7'), ['acme-audit', 'process-status']);
  const res = convertWithPatterns(c7, 'c8', defs);
  assert.deepEqual(res.issues, []);
  assert.deepEqual(at(res.xml, 'c8'), ['acme-audit', 'process-status']);
  assert.deepEqual(setsOf(res.xml, 'End').outputs.sort(), ['audited=="yes"', 'processStatus=="succeeded"']);
});

test('a pattern on the process («Einmalige Ausführung») comes over too - with the correlation key on C8', () => {
  const c7 = applyPattern(withPatterns('c7'), std('unique-execution'), 'c7', null);
  assert.ok(c7.changed, c7.issues.join('; '));
  const res = convertWithPatterns(c7.xml, 'c8', STANDARD_PATTERNS);
  assert.deepEqual(detectPatterns(res.xml, STANDARD_PATTERNS, 'c8').hits.filter(h => h.targetId == null).map(h => h.patternId), ['unique-execution']);
  assert.ok(res.xml.includes('correlationKey="=businessKey"'), 'the start message correlates with the business key');
  assert.ok(!res.issues.some(i => i.where === 'Pattern'), res.issues.map(i => i.text).join('; '));
  const back = convertWithPatterns(res.xml, 'c7', STANDARD_PATTERNS, { timeToLive: '5' });
  assert.deepEqual(detectPatterns(back.xml, STANDARD_PATTERNS, 'c7').hits.filter(h => h.targetId == null).map(h => h.patternId), ['unique-execution']);
});

test('C7 → C8 → C7: the patterns come back in their C7 form only - no output parameters beside the listeners', () => {
  const c7 = withPatterns('c7');
  const c8 = convertWithPatterns(c7, 'c8', STANDARD_PATTERNS);
  const back = convertWithPatterns(c8.xml, 'c7', STANDARD_PATTERNS, { timeToLive: '5' });
  assert.deepEqual([...c8.issues, ...back.issues], []);
  assert.deepEqual(hitsOf(back.xml, 'c7'), hitsOf(c7, 'c7'));
  for (const id of ['TakeOver', 'Reset', 'End']) {
    assert.deepEqual(setsOf(back.xml, id).outputParameters, [], id);
    assert.deepEqual(setsOf(back.xml, id).listeners, setsOf(c7, id).listeners, id);
  }
});

test('C8 → C7 → C8: the identity outputs come back once each', () => {
  const c8 = withPatterns('c8');
  const back = convertWithPatterns(convertWithPatterns(c8, 'c7', STANDARD_PATTERNS, { timeToLive: '5' }).xml, 'c8', STANDARD_PATTERNS);
  assert.deepEqual(back.issues, []);
  assert.deepEqual(setsOf(back.xml, 'TakeOver'), setsOf(c8, 'TakeOver'));
});

test('C8 → C7 with the variables of the specification: a Spin path to a text ends with stringValue()', () => {
  // an output that reads the user name of the identity
  const c8 = diagram('c8').replace('<bpmn:endEvent id="End">',
    '<bpmn:endEvent id="End"><bpmn:extensionElements><zeebe:ioMapping><zeebe:output source="=_identityCorrelation.username" target="who" /></zeebe:ioMapping></bpmn:extensionElements>');
  const spec = { ...importBpmn(c8, 'x.bpmn').spec, engine: 'c8' as const };
  const value = (xml: string) => {
    const end = elementOf(xml, 'End');
    return [...setsOf(xml, 'End').listeners, ...named(end, 'camunda:outputParameter').map(o => o.textContent ?? '')].find(t => t.includes('username')) ?? '';
  };
  assert.ok(!value(convertBpmn(c8, 'c7', { timeToLive: '5' }).xml).includes('stringValue()'), 'without the variables nobody knows the type');
  assert.ok(value(convertBpmn(c8, 'c7', { timeToLive: '5', juel: juelOptions(spec, null) }).xml).includes('_identityCorrelation.prop("username").stringValue()'));
});

test('the export for the other engine takes the patterns over too', () => {
  const c7 = withPatterns('c7');
  const spec = { ...importBpmn(c7, 'x.bpmn', { patterns: STANDARD_PATTERNS }).spec, engine: 'c7' as const };
  const out = exportBpmnFor(spec, c7, 'c8', null);
  assert.ok(!out.issues.some(i => i.text.includes('nicht nach FEEL')), out.issues.map(i => i.text).join('; '));
  assert.deepEqual(setsOf(out.xml, 'TakeOver').outputs, setsOf(withPatterns('c8'), 'TakeOver').outputs);
});

test('one pattern fails to come back, the others still go over in their target form', () => {
  const take = std('identity-take-over');
  // «Identität übernehmen» with a C8 form that does not fit the element - the rest are standard
  const misfit: PatternDef = { ...take, bpmn: { c7: take.bpmn.c7, c8: std('unique-execution').bpmn.c8 } };
  const defs = [misfit, ...STANDARD_PATTERNS.filter(p => p.id !== 'identity-take-over')];
  const res = convertWithPatterns(withPatterns('c7'), 'c8', defs);
  // the failing one: said, converted like the rest (its outputs are there)
  assert.ok(res.issues.some(i => i.stepId === 'TakeOver' && i.text.includes('liess sich nicht')), res.issues.map(i => i.text).join('; '));
  assert.equal(setsOf(res.xml, 'TakeOver').outputs.length, 2);
  // the others: in their C8 form, recognised, nothing to do by hand for them
  assert.deepEqual(setsOf(res.xml, 'Reset').outputs, setsOf(withPatterns('c8'), 'Reset').outputs);
  assert.deepEqual(setsOf(res.xml, 'End').outputs, setsOf(withPatterns('c8'), 'End').outputs);
  assert.ok(!res.issues.some(i => i.stepId === 'Reset' || i.stepId === 'End'), res.issues.map(i => `${i.stepId}: ${i.text}`).join('; '));
});

test('the export for the other engine takes the patterns of the model', () => {
  const status = std('process-status');
  // an own pattern of the company with the ID of the standard one - its C8 form names the parameter differently
  const own: PatternDef = { ...status, bpmn: { c7: status.bpmn.c7, c8: status.bpmn.c8!.replace('{{processStatus}}', '{{state}}') } };
  const c7 = withPatterns('c7');
  const spec = { ...importBpmn(c7, 'x.bpmn', { patterns: STANDARD_PATTERNS }).spec, engine: 'c7' as const };
  const withModel = exportBpmnFor(spec, c7, 'c8', { patterns: [own] } as unknown as Model);
  assert.ok(withModel.issues.some(i => i.stepId === 'End' && i.text.includes('war «succeeded»')), withModel.issues.map(i => i.text).join('; '));
  const withoutModel = exportBpmnFor(spec, c7, 'c8', null);
  assert.ok(!withoutModel.issues.some(i => i.text.includes('war «succeeded»')));
});

test('two patterns fail, the third still goes over in its target form - both failures are said', () => {
  const misfitOf = (id: string): PatternDef => { const d = std(id); return { ...d, bpmn: { c7: d.bpmn.c7, c8: std('unique-execution').bpmn.c8 } }; };
  const defs = [misfitOf('identity-take-over'), misfitOf('identity-reset'), std('process-status')];
  const res = convertWithPatterns(withPatterns('c7'), 'c8', defs);
  for (const id of ['TakeOver', 'Reset']) {
    assert.ok(res.issues.some(i => i.stepId === id && i.text.includes('liess sich nicht')), `${id}: ${res.issues.map(i => i.text).join('; ')}`);
    assert.ok(setsOf(res.xml, id).outputs.length > 0, `${id}: converted like the rest`);
  }
  assert.deepEqual(setsOf(res.xml, 'End').outputs, setsOf(withPatterns('c8'), 'End').outputs);
  assert.ok(!res.issues.some(i => i.stepId === 'End'));
});

test('two definitions with the same ID: the first counts (own before standard, as in patternDefs)', () => {
  const status = std('process-status');
  const own: PatternDef = { ...status, bpmn: { c7: status.bpmn.c7, c8: status.bpmn.c8!.replace('{{processStatus}}', '{{state}}') } };
  const ownFirst = convertWithPatterns(withPatterns('c7'), 'c8', [own, ...STANDARD_PATTERNS]);
  assert.ok(ownFirst.issues.some(i => i.stepId === 'End' && i.text.includes('war «succeeded»')), ownFirst.issues.map(i => i.text).join('; '));
  const standardFirst = convertWithPatterns(withPatterns('c7'), 'c8', [...STANDARD_PATTERNS, own]);
  assert.deepEqual(standardFirst.issues, []);
});
