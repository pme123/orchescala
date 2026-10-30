// The standard patterns come with Orchescala: every company has them, its own
// pattern with the same ID replaces one, and each can be inserted and is then
// recognised again — on C7 and C8.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { STANDARD_PATTERNS, allPatterns, applyPattern, detectPatterns, parseFragment, patternDefs } from '../src/patterns';
import type { EngineId, PatternDef } from '../src/types';

const g = globalThis as unknown as Record<string, unknown>;
g.DOMParser ??= DOMParser;
g.XMLSerializer ??= class { serializeToString(doc: { toString(): string }) { return doc.toString(); } };

const BPMN = 'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"';
const NS: Record<EngineId, string> = {
  c7: `${BPMN} xmlns:camunda="http://camunda.org/schema/1.0/bpmn"`,
  c8: `${BPMN} xmlns:zeebe="http://camunda.org/schema/zeebe/1.0" xmlns:modeler="http://camunda.org/schema/modeler/1.0" modeler:executionPlatform="Camunda Cloud"`,
};

/** start → the element the pattern fits → end */
const diagram = (engine: EngineId, type: string) => `<bpmn:definitions ${NS[engine]} id="d">
  <bpmn:process id="acme-demoV1" isExecutable="true">
    <bpmn:startEvent id="Start"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:${type} id="Target" name="Target"><bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing></bpmn:${type}>
    <bpmn:endEvent id="End"><bpmn:incoming>f2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="f1" sourceRef="Start" targetRef="Target" />
    <bpmn:sequenceFlow id="f2" sourceRef="Target" targetRef="End" />
  </bpmn:process>
</bpmn:definitions>`;

test('the standard patterns are there without a company pattern', () => {
  const ids = patternDefs(null).map(p => p.id);
  for (const id of ['init-process', 'identity-take-over', 'identity-reset', 'propagate-mocks']) assert.ok(ids.includes(id), id);
  assert.ok(STANDARD_PATTERNS.every(p => p.standard && !p.builtin));
  assert.ok(allPatterns(undefined).some(p => p.id === 'process-labels'));
});

test('an own pattern with the same ID replaces the standard one, others are added', () => {
  const own: PatternDef[] = [
    { id: 'init-process', name: 'Eigenes Init', appliesTo: ['serviceTask'], bpmn: {} },
    { id: 'acme-inform', name: 'Informieren', appliesTo: ['userTask'], bpmn: {} },
  ];
  const defs = patternDefs({ patterns: own });
  assert.deepEqual(defs.filter(p => p.id === 'init-process').map(p => p.name), ['Eigenes Init']);
  assert.ok(defs.some(p => p.id === 'acme-inform'));
  assert.equal(defs.length, STANDARD_PATTERNS.length + 1);
  // own first, then the standard ones
  assert.deepEqual(defs.slice(0, 2).map(p => p.id), ['init-process', 'acme-inform']);
  // stable per list — usable as a React dependency
  assert.equal(patternDefs({ patterns: own }), defs);
  // with the patterns of Orchescala: built in, own, standard
  const all = allPatterns(own).map(p => p.id);
  assert.equal(all[0], 'process-labels');
  assert.ok(all.includes('acme-inform') && all.includes('propagate-mocks'));
  assert.equal(all.filter(id => id === 'init-process').length, 1);
});

for (const std of STANDARD_PATTERNS) {
  test(`an own pattern with the BPMN of «${std.name}» under another ID gets the element, the standard one does not`, () => {
    const own: PatternDef = { ...std, id: `acme-${std.id}`, name: `Eigenes ${std.name}`, standard: undefined };
    for (const engine of ['c7', 'c8'] as const) {
      const xml = applyPattern(diagram(engine, std.appliesTo[0]), std, engine, 'Target').xml;
      const hits = detectPatterns(xml, patternDefs({ patterns: [own] }), engine).hits;
      assert.deepEqual(hits.map(h => [h.patternId, h.targetId]), [[own.id, 'Target']], engine);
    }
  });
}

test('the standard patterns cannot be changed by a caller', () => {
  assert.throws(() => (patternDefs(null) as PatternDef[]).push({ id: 'x', name: 'x', appliesTo: [], bpmn: {} }));
  assert.throws(() => { (STANDARD_PATTERNS[0] as { name: string }).name = 'x'; });
});

for (const def of STANDARD_PATTERNS) {
  for (const engine of ['c7', 'c8'] as const) {
    test(`«${def.name}» on ${engine.toUpperCase()}: readable, inserted and recognised again`, () => {
      const src = def.bpmn[engine];
      assert.ok(src, 'has BPMN');
      assert.ok(!('error' in parseFragment(src!)), 'readable fragment');
      const type = def.appliesTo[0];
      const res = applyPattern(diagram(engine, type), def, engine, 'Target');
      assert.ok(res.changed, `inserted: ${res.issues.join('; ')}`);
      // exactly this pattern — no other standard pattern claims the element too
      const hits = detectPatterns(res.xml, STANDARD_PATTERNS, engine).hits;
      assert.deepEqual(hits.map(h => [h.patternId, h.targetId]), [[def.id, 'Target']]);
    });
  }
}
