// The standard patterns come with Orchescala: every company has them, its own
// pattern with the same ID replaces one, and each can be inserted and is then
// recognised again — on C7 and C8.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { STANDARD_PATTERNS, allPatterns, applyPattern, detectPatterns, isStandardPattern, parseFragment, patternDefs, patternMappings, removePattern } from '../src/patterns';
import { allSteps, importBpmn, syncPatterns } from '../src/bpmn';
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

// a pattern on the process (`appliesTo: ['process']`) goes to the process, not to an element:
// a plain task stands in for the element, and the hit has no target. The tests run for each
// type a pattern applies to - not only for the first.
const elementOf = (type: string) => (type === 'process' ? 'task' : type);
const targetFor = (type: string) => (type === 'process' ? null : 'Target');

test('the standard patterns are there without a company pattern', () => {
  const ids = patternDefs(null).map(p => p.id);
  for (const id of ['init-process', 'identity-take-over', 'identity-reset', 'propagate-mocks', 'unique-execution']) assert.ok(ids.includes(id), id);
  assert.ok(STANDARD_PATTERNS.every(p => isStandardPattern(p) && !p.builtin));
  // a copy (an own pattern from a file) is not a standard pattern, whatever it carries
  assert.ok(!isStandardPattern({ ...STANDARD_PATTERNS[0], standard: true }));
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
  test(`an own pattern with the BPMN of «${std.name}» under another ID gets the element (or the process), the standard one does not`, () => {
    const own: PatternDef = { ...std, id: `acme-${std.id}`, name: `Eigenes ${std.name}` };
    for (const engine of ['c7', 'c8'] as const) {
      for (const type of std.appliesTo) {
        const xml = applyPattern(diagram(engine, elementOf(type)), std, engine, targetFor(type)).xml;
        const hits = detectPatterns(xml, patternDefs({ patterns: [own] }), engine).hits;
        assert.deepEqual(hits.map(h => [h.patternId, h.targetId]), [[own.id, targetFor(type)]], `${engine} ${type}`);
      }
    }
  });
}

test('an own pattern with the same ID and other BPMN: only the own one is recognised', () => {
  const std = STANDARD_PATTERNS.find(p => p.id === 'propagate-mocks')!;
  // the own one passes only the mocks on, not the identity
  const own: PatternDef = { ...std, name: 'Nur Mocks', bpmn: { c8: std.bpmn.c8!.replace(/\s*<zeebe:input source="=_identityCorrelation"[^>]*\/>/, '') } };
  assert.notEqual(own.bpmn.c8, std.bpmn.c8);
  const defs = patternDefs({ patterns: [own] });
  const withStd = applyPattern(diagram('c8', 'callActivity'), std, 'c8', 'Target').xml;
  // the full standard BPMN contains the own one — it is the own one that is found
  assert.deepEqual(detectPatterns(withStd, defs, 'c8').hits.map(h => h.patternId), ['propagate-mocks']);
  assert.equal(defs.find(p => p.id === 'propagate-mocks'), own);
  // and with only the own BPMN in the diagram, the standard one finds nothing
  const withOwn = applyPattern(diagram('c8', 'callActivity'), own, 'c8', 'Target').xml;
  assert.deepEqual(detectPatterns(withOwn, STANDARD_PATTERNS, 'c8').hits, []);
  assert.deepEqual(detectPatterns(withOwn, defs, 'c8').hits.map(h => h.targetId), ['Target']);
});

test('Init Process: the topic is the process ID - another topic is not the pattern', () => {
  const init = STANDARD_PATTERNS.find(p => p.id === 'init-process')!;
  for (const engine of ['c7', 'c8'] as const) {
    const xml = applyPattern(diagram(engine, 'serviceTask'), init, engine, 'Target').xml;
    assert.ok(xml.includes('acme-demoV1'), `${engine}: topic filled with the process ID`);
    assert.ok(!xml.includes('{{processId}}'), engine);
    assert.deepEqual(detectPatterns(xml, STANDARD_PATTERNS, engine).hits.map(h => h.patternId), ['init-process'], engine);
    const other = xml.replace(/(topic|type)="acme-demoV1"/, '$1="acme-otherV1"');
    assert.notEqual(other, xml, engine);
    assert.deepEqual(detectPatterns(other, STANDARD_PATTERNS, engine).hits.filter(h => h.patternId === 'init-process'), [], engine);
  }
});

// ESM runs in strict mode — changing a frozen object throws instead of failing silently
test('the standard patterns cannot be changed by a caller', () => {
  assert.throws(() => (patternDefs(null) as PatternDef[]).push({ id: 'x', name: 'x', appliesTo: [], bpmn: {} }));
  assert.throws(() => { (STANDARD_PATTERNS[0] as { name: string }).name = 'x'; });
  // also deep down: the BPMN and the element types
  assert.throws(() => { (STANDARD_PATTERNS[0].bpmn as Record<string, string>).c7 = 'x'; });
  assert.throws(() => { STANDARD_PATTERNS[0].appliesTo.push('userTask'); });
});

test('an existing process without own patterns: import and sync find the standard pattern, once', () => {
  const std = STANDARD_PATTERNS.find(p => p.id === 'propagate-mocks')!;
  for (const engine of ['c7', 'c8'] as const) {
    const xml = applyPattern(diagram(engine, 'callActivity'), std, engine, 'Target').xml;
    const target = (s: { steps?: Parameters<typeof allSteps>[0] }) => allSteps(s.steps).find(x => x.id === 'Target');
    // before: nothing recognised; now: the chip on the call activity
    const before = importBpmn(xml, 'demo.bpmn', { patterns: undefined }).spec;
    assert.equal(target(before)?.patterns, undefined, engine);
    const fresh = importBpmn(xml, 'demo.bpmn', { patterns: patternDefs(null) }).spec;
    assert.deepEqual(target(fresh)?.patterns?.map(a => a.id), ['propagate-mocks'], engine);
    // on load, the spec from before gets it once — the next sync changes nothing more
    const synced = syncPatterns(before, fresh);
    assert.ok(synced, engine);
    assert.deepEqual(target(synced!)?.patterns?.map(a => a.id), ['propagate-mocks'], engine);
    assert.equal(syncPatterns(synced!, fresh), null, engine);
  }
});

test('the findings leave out the inputs a standard pattern brings', () => {
  const m = patternMappings(patternDefs(null), [{ id: 'propagate-mocks', params: {} }], 'c8');
  assert.deepEqual([...m.inputs.keys()].sort(), ['_identityCorrelation', '_mockedWorkers', '_servicesMocked']);
  // without the standard patterns there was nothing to leave out
  assert.equal(patternMappings([], [{ id: 'propagate-mocks', params: {} }], 'c8').inputs.size, 0);
});

for (const def of STANDARD_PATTERNS) {
  for (const engine of ['c7', 'c8'] as const) {
    test(`«${def.name}» on ${engine.toUpperCase()}: readable, inserted and recognised again`, () => {
      const src = def.bpmn[engine];
      assert.ok(src, 'has BPMN');
      assert.ok(!('error' in parseFragment(src!)), 'readable fragment');
      for (const type of def.appliesTo) {
        const res = applyPattern(diagram(engine, elementOf(type)), def, engine, targetFor(type));
        assert.ok(res.changed, `inserted on ${type}: ${res.issues.join('; ')}`);
        // exactly this pattern — no other standard pattern claims the element too
        const hits = detectPatterns(res.xml, STANDARD_PATTERNS, engine).hits;
        assert.deepEqual(hits.map(h => [h.patternId, h.targetId]), [[def.id, targetFor(type)]], type);
      }
    });
  }
}

// «Einmalige Ausführung» - the pattern on the process: it needs a message start, and in C8 the
// start message carries the correlation key the event subprocess catches it with
const unique = STANDARD_PATTERNS.find(p => p.id === 'unique-execution')!;
const parse = (xml: string) => new DOMParser().parseFromString(xml, 'text/xml') as unknown as Document;
const elements = (doc: Document, tag: string) => Array.from(doc.getElementsByTagName(tag));
/** the start event `Start`, the message it starts with, and all messages of the diagram */
const startOf = (xml: string) => {
  const doc = parse(xml);
  const start = elements(doc, 'bpmn:startEvent').find(e => e.getAttribute('id') === 'Start')!;
  const ref = elements(start as unknown as Document, 'bpmn:messageEventDefinition')[0]?.getAttribute('messageRef');
  const messages = elements(doc, 'bpmn:message');
  return { doc, message: messages.find(m => m.getAttribute('id') === ref), messages };
};
const subscriptionOf = (message: Element | undefined) =>
  message ? elements(message as unknown as Document, 'zeebe:subscription').map(s => s.getAttribute('correlationKey')) : [];

for (const engine of ['c7', 'c8'] as const) {
  test(`«Einmalige Ausführung» on ${engine.toUpperCase()}: a plain start event becomes a message start - message = process ID`, () => {
    const res = applyPattern(diagram(engine, 'task'), unique, engine, null);
    assert.ok(res.changed, res.issues.join('; '));
    const { doc, message, messages } = startOf(res.xml);
    assert.equal(message?.getAttribute('name'), 'acme-demoV1');
    assert.equal(messages.length, 1);
    // the event subprocess catches the same message, not interrupting
    const esp = elements(doc, 'bpmn:subProcess').find(e => e.getAttribute('triggeredByEvent') === 'true');
    assert.ok(esp, 'event subprocess');
    const espStart = elements(esp as unknown as Document, 'bpmn:startEvent')[0];
    assert.equal(espStart.getAttribute('isInterrupting'), 'false');
    assert.equal(elements(espStart as unknown as Document, 'bpmn:messageEventDefinition')[0].getAttribute('messageRef'), message?.getAttribute('id'));
    assert.deepEqual(subscriptionOf(message), engine === 'c8' ? ['=businessKey'] : []);
  });

  test(`«Einmalige Ausführung» on ${engine.toUpperCase()}: removed from the process again`, () => {
    const applied = applyPattern(diagram(engine, 'task'), unique, engine, null).xml;
    const res = removePattern(applied, unique, engine, null, STANDARD_PATTERNS);
    assert.ok(res.changed, res.issues.join('; '));
    assert.deepEqual(detectPatterns(res.xml, STANDARD_PATTERNS, engine).hits, []);
    assert.ok(!elements(parse(res.xml), 'bpmn:subProcess').length, 'event subprocess gone');
    // and it can be inserted again
    const again = applyPattern(res.xml, unique, engine, null);
    assert.deepEqual(detectPatterns(again.xml, STANDARD_PATTERNS, engine).hits.map(h => [h.patternId, h.targetId]), [['unique-execution', null]]);
  });
}

test('«Einmalige Ausführung» on C8: an existing start message gets the correlation key - no second message', () => {
  const withMessageStart = diagram('c8', 'task')
    .replace('<bpmn:startEvent id="Start"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>',
      '<bpmn:startEvent id="Start"><bpmn:outgoing>f1</bpmn:outgoing><bpmn:messageEventDefinition id="StartDef" messageRef="Msg" /></bpmn:startEvent>')
    .replace('<bpmn:process ', '<bpmn:message id="Msg" name="acme-demoV1" />\n  <bpmn:process ');
  assert.deepEqual(subscriptionOf(startOf(withMessageStart).message), []);
  const res = applyPattern(withMessageStart, unique, 'c8', null);
  assert.ok(res.changed, res.issues.join('; '));
  const { message, messages } = startOf(res.xml);
  assert.equal(message?.getAttribute('id'), 'Msg');
  assert.equal(messages.length, 1);
  assert.deepEqual(subscriptionOf(message), ['=businessKey']);
});
