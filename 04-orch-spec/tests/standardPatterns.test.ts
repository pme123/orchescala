// The standard patterns come with Orchescala: every company has them, its own
// pattern with the same ID replaces one, and each can be inserted and is then
// recognised again — on C7 and C8.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { STANDARD_PATTERNS, allPatterns, applyPattern, detectPatterns, isStandardPattern, parseFragment, patternDefs, patternMappings, removePattern, setVariableOnly } from '../src/patterns';
import { allSteps, importBpmn, syncPatterns } from '../src/bpmn';
import { convertWithPatterns } from '../src/patternConvert';
import { installXmlNamespaces } from './xmlNamespaces';
import type { EngineId, PatternDef } from '../src/types';

const g = globalThis as unknown as Record<string, unknown>;
g.DOMParser ??= DOMParser;
g.XMLSerializer ??= class { serializeToString(doc: { toString(): string }) { return doc.toString(); } };
installXmlNamespaces();

const BPMN = 'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"';
const NS: Record<EngineId, string> = {
  c7: `${BPMN} xmlns:camunda="http://camunda.org/schema/1.0/bpmn"`,
  c8: `${BPMN} xmlns:zeebe="http://camunda.org/schema/zeebe/1.0" xmlns:modeler="http://camunda.org/schema/modeler/1.0" modeler:executionPlatform="Camunda Cloud"`,
};

/** start → the element the pattern fits → end; `startDef` goes into the start event (e.g. a
 * message or timer definition), `roots` before the process (e.g. the message it refers to) */
const diagram = (engine: EngineId, type: string, startDef = '', roots = '') => `<bpmn:definitions ${NS[engine]} id="d">
  ${roots}<bpmn:process id="acme-demoV1" isExecutable="true">
    <bpmn:startEvent id="Start"><bpmn:outgoing>f1</bpmn:outgoing>${startDef}</bpmn:startEvent>
    <bpmn:${type} id="Target" name="Target"><bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing></bpmn:${type}>
    <bpmn:endEvent id="End"><bpmn:incoming>f2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="f1" sourceRef="Start" targetRef="Target" />
    <bpmn:sequenceFlow id="f2" sourceRef="Target" targetRef="End" />
  </bpmn:process>
</bpmn:definitions>`;

// a pattern on the process (`appliesTo: ['process']`) goes to the process, not to an element:
// a plain task stands in for the element, and the hit has no target. The tests run for each
// type a pattern applies to - not only for the first.
const elementOf = (type: string) => {
  if (type === 'process') return 'task';
  // a flow node the test diagram can hold - anything else (a pool, a lane) needs its own test
  if (!/^(task|subProcess|callActivity|[a-z][A-Za-z]*(Task|Event|Gateway))$/.test(type)) throw new Error(`no test diagram for «${type}»`);
  return type;
};
const targetFor = (type: string) => (type === 'process' ? null : 'Target');

test('the standard patterns are there without a company pattern', () => {
  const ids = patternDefs(null).map(p => p.id);
  for (const id of ['init-process', 'identity-take-over', 'identity-reset', 'propagate-mocks', 'unique-execution', 'process-status']) assert.ok(ids.includes(id), id);
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
const elements = (scope: Document | Element, tag: string): Element[] => Array.from(scope.getElementsByTagName(tag));
const one = (scope: Document | Element, tag: string): Element => {
  const found = elements(scope, tag);
  assert.equal(found.length, 1, `exactly one ${tag}`);
  return found[0];
};
/** the start event of the process (not the one of the event subprocess), its message and all messages */
const startOf = (xml: string) => {
  const doc = parse(xml);
  const process = one(doc, 'bpmn:process');
  const starts = Array.from(process.children).filter(e => e.tagName === 'bpmn:startEvent');
  assert.equal(starts.length, 1, 'one start event of the process');
  const ref = one(starts[0], 'bpmn:messageEventDefinition').getAttribute('messageRef');
  assert.ok(ref, 'the start refers to a message');
  const messages = elements(doc, 'bpmn:message');
  const message = messages.find(m => m.getAttribute('id') === ref);
  assert.ok(message, `message ${ref} is in the diagram`);
  return { doc, message, messages };
};
const subscriptionOf = (message: Element) => elements(message, 'zeebe:subscription').map(s => s.getAttribute('correlationKey'));
/** what the end of the event subprocess sets: C7 an execution listener, C8 an output mapping */
const alreadyRunningSet = (end: Element, engine: EngineId) =>
  engine === 'c7'
    ? elements(end, 'camunda:executionListener').some(l => (l.getAttribute('expression') ?? '').includes('setVariable("alreadyRunning", true)'))
    : elements(end, 'zeebe:output').some(o => o.getAttribute('target') === 'alreadyRunning' && o.getAttribute('source') === '=true');

/** the test diagram with a message start `Msg` (name = process ID) - `ext` are its extensions */
const withMessageStart = (engine: EngineId, ext = '') =>
  diagram(engine, 'task', '<bpmn:messageEventDefinition id="StartDef" messageRef="Msg" />',
    `<bpmn:message id="Msg" name="acme-demoV1">${ext ? `<bpmn:extensionElements>${ext}</bpmn:extensionElements>` : ''}</bpmn:message>\n  `);

/** the event subprocess: starts not interrupting on the start message and sets alreadyRunning at its end */
const assertEventSubprocess = (doc: Document, message: Element, engine: EngineId) => {
  const esp = elements(doc, 'bpmn:subProcess').filter(e => e.getAttribute('triggeredByEvent') === 'true');
  assert.equal(esp.length, 1, 'one event subprocess');
  const espStart = one(esp[0], 'bpmn:startEvent');
  assert.equal(espStart.getAttribute('isInterrupting'), 'false');
  assert.equal(one(espStart, 'bpmn:messageEventDefinition').getAttribute('messageRef'), message.getAttribute('id'), 'the same message as the start');
  assert.ok(alreadyRunningSet(one(esp[0], 'bpmn:endEvent'), engine), 'alreadyRunning = true at the end');
};

for (const engine of ['c7', 'c8'] as const) {
  test(`«Einmalige Ausführung» on ${engine.toUpperCase()}: a plain start event becomes a message start - message = process ID`, () => {
    const res = applyPattern(diagram(engine, 'task'), unique, engine, null);
    assert.ok(res.changed, res.issues.join('; '));
    assert.ok(!res.xml.includes('{{'), 'no placeholder left');
    const { doc, message, messages } = startOf(res.xml);
    assert.equal(message.getAttribute('name'), 'acme-demoV1');
    assert.equal(messages.length, 1);
    assertEventSubprocess(doc, message, engine);
    assert.deepEqual(subscriptionOf(message), engine === 'c8' ? ['=businessKey'] : []);
  });

  test(`«Einmalige Ausführung» on ${engine.toUpperCase()}: an existing start message is taken - no second message`, () => {
    const before = startOf(withMessageStart(engine));
    assert.equal(before.message.getAttribute('id'), 'Msg');
    assert.deepEqual(subscriptionOf(before.message), []);
    const res = applyPattern(withMessageStart(engine), unique, engine, null);
    assert.ok(res.changed, res.issues.join('; '));
    const { doc, message, messages } = startOf(res.xml);
    assert.equal(message.getAttribute('id'), 'Msg');
    assert.equal(messages.length, 1);
    assertEventSubprocess(doc, message, engine);
    // C8: the correlation key comes onto the existing message (addRootExtensions)
    assert.deepEqual(subscriptionOf(message), engine === 'c8' ? ['=businessKey'] : []);
  });

  test(`«Einmalige Ausführung» on ${engine.toUpperCase()}: removed from the process again - the message start stays`, () => {
    const applied = applyPattern(diagram(engine, 'task'), unique, engine, null).xml;
    const res = removePattern(applied, unique, engine, null, STANDARD_PATTERNS);
    assert.ok(res.changed, res.issues.join('; '));
    assert.deepEqual(detectPatterns(res.xml, STANDARD_PATTERNS, engine).hits, []);
    assert.equal(elements(parse(res.xml), 'bpmn:subProcess').length, 0, 'event subprocess gone');
    // the start message is shared with the rest of the diagram (the start event refers to it):
    // it stays a message start, with its correlation key in C8
    const { message, messages } = startOf(res.xml);
    assert.equal(messages.length, 1);
    assert.equal(message.getAttribute('name'), 'acme-demoV1');
    assert.deepEqual(subscriptionOf(message), engine === 'c8' ? ['=businessKey'] : []);
    // and it can be inserted again
    const again = applyPattern(res.xml, unique, engine, null);
    assert.deepEqual(detectPatterns(again.xml, STANDARD_PATTERNS, engine).hits.map(h => [h.patternId, h.targetId]), [['unique-execution', null]]);
    assert.equal(startOf(again.xml).messages.length, 1, 'no second message');
  });

  test(`«Einmalige Ausführung» on ${engine.toUpperCase()}: applied twice - still one event subprocess and one message`, () => {
    const once = applyPattern(diagram(engine, 'task'), unique, engine, null).xml;
    const twice = applyPattern(once, unique, engine, null);
    const { doc, message, messages } = startOf(twice.xml);
    assert.equal(messages.length, 1);
    assertEventSubprocess(doc, message, engine);
    assert.deepEqual(subscriptionOf(message), engine === 'c8' ? ['=businessKey'] : []);
    assert.deepEqual(detectPatterns(twice.xml, STANDARD_PATTERNS, engine).hits.map(h => h.patternId), ['unique-execution']);
  });

  test(`«Einmalige Ausführung» on ${engine.toUpperCase()}: a timer start is not changed - the pattern says why`, () => {
    const timer = diagram(engine, 'task', '<bpmn:timerEventDefinition id="StartTimer"><bpmn:timeDuration>PT1H</bpmn:timeDuration></bpmn:timerEventDefinition>');
    const res = applyPattern(timer, unique, engine, null);
    assert.equal(res.changed, false);
    assert.equal(res.xml, timer);
    assert.ok(res.issues.some(i => i.includes('Nachrichten-Startereignis')), res.issues.join('; '));
  });
}

test('a limitation of a pattern on an engine is said when it is inserted there - not on the other engine', () => {
  // «Einmalige Ausführung» with a limitation on C8, as an own pattern
  const limited: PatternDef = { ...unique, id: 'acme-limited', limitations: { c8: 'greift hier noch nicht.' } };
  const c8 = applyPattern(diagram('c8', 'task'), limited, 'c8', null);
  assert.ok(c8.changed);
  assert.ok(c8.issues.includes(`«${limited.name}»: greift hier noch nicht.`), c8.issues.join('; '));
  const c7 = applyPattern(diagram('c7', 'task'), limited, 'c7', null);
  assert.ok(c7.changed);
  assert.ok(!c7.issues.some(i => i.startsWith(`«${limited.name}»:`)), c7.issues.join('; '));
});

test('«Einmalige Ausführung» has no limitation on C8 any more - the start through Orchescala sends the correlation key', () => {
  assert.equal(unique.limitations, undefined);
  assert.ok(!unique.description?.includes('noch nicht'), unique.description);
});

test('«Einmalige Ausführung» on C8: a start message with another correlation key keeps it - the pattern says so', () => {
  const own = withMessageStart('c8', '<zeebe:subscription correlationKey="=clientKey" />');
  assert.deepEqual(subscriptionOf(startOf(own).message), ['=clientKey']);
  const res = applyPattern(own, unique, 'c8', null);
  assert.ok(res.changed, res.issues.join('; '));
  const { doc, message, messages } = startOf(res.xml);
  assert.equal(messages.length, 1);
  assertEventSubprocess(doc, message, 'c8');
  // not overwritten, not added a second time
  assert.deepEqual(subscriptionOf(message), ['=clientKey']);
  assert.ok(res.issues.some(i => i.includes('=clientKey') && i.includes('=businessKey')), res.issues.join('; '));
});

// «Prozess-Status am Ende» - an end event sets processStatus; the end `output-mocked` of
// «Init Process» sets it too, but as part of that pattern
const status = STANDARD_PATTERNS.find(p => p.id === 'process-status')!;
const init = STANDARD_PATTERNS.find(p => p.id === 'init-process')!;
const hitsOf = (xml: string, engine: EngineId) =>
  detectPatterns(xml, STANDARD_PATTERNS, engine).hits.map(h => [h.patternId, h.targetId, h.params.processStatus ?? null]);

for (const engine of ['c7', 'c8'] as const) {
  test(`«Prozess-Status am Ende» on ${engine.toUpperCase()}: the status is set as text and read back`, () => {
    const res = applyPattern(diagram(engine, 'task'), status, engine, 'End', { processStatus: 'canceled' });
    assert.ok(res.changed, res.issues.join('; '));
    assert.ok(!res.xml.includes('{{'), 'no placeholder left');
    const end = one(parse(res.xml), 'bpmn:endEvent');
    if (engine === 'c7') {
      assert.equal(one(end, 'camunda:executionListener').getAttribute('expression'), '${execution.setVariable("processStatus", "canceled")}');
    } else {
      const out = one(end, 'zeebe:output');
      assert.deepEqual([out.getAttribute('source'), out.getAttribute('target')], ['="canceled"', 'processStatus']);
    }
    assert.deepEqual(hitsOf(res.xml, engine), [['process-status', 'End', 'canceled']]);
  });

  test(`«Prozess-Status am Ende» on ${engine.toUpperCase()}: with «Init Process» - its end output-mocked is not the pattern, the own end is`, () => {
    const withInit = applyPattern(diagram(engine, 'serviceTask'), init, engine, 'Target');
    assert.ok(withInit.changed, withInit.issues.join('; '));
    assert.ok(withInit.xml.includes('output-mocked'), 'the block of «Init Process» is there');
    // the end of the block sets processStatus = output-mocked - it belongs to «Init Process»
    assert.deepEqual(hitsOf(withInit.xml, engine), [['init-process', 'Target', null]]);
    const both = applyPattern(withInit.xml, status, engine, 'End', { processStatus: 'succeeded' });
    assert.ok(both.changed, both.issues.join('; '));
    assert.deepEqual(hitsOf(both.xml, engine).sort(), [['init-process', 'Target', null], ['process-status', 'End', 'succeeded']]);
  });

  test(`«Prozess-Status am Ende» on ${engine.toUpperCase()}: removed again - the end stays, without the status`, () => {
    const applied = applyPattern(diagram(engine, 'task'), status, engine, 'End', { processStatus: 'canceled' }).xml;
    const res = removePattern(applied, status, engine, 'End', STANDARD_PATTERNS);
    assert.ok(res.changed, res.issues.join('; '));
    assert.deepEqual(detectPatterns(res.xml, STANDARD_PATTERNS, engine).hits, []);
    assert.ok(!res.xml.includes('processStatus'), 'the status is gone');
    assert.equal(elements(parse(res.xml), 'bpmn:endEvent').length, 1, 'the end stays');
  });
}

for (const engine of ['c7', 'c8'] as const) {
  test(`«Prozess-Status am Ende» on ${engine.toUpperCase()}: a value with " or \\ is refused - it would end the string in the BPMN`, () => {
    for (const bad of ['can"celed', 'can\\celed']) {
      const res = applyPattern(diagram(engine, 'task'), status, engine, 'End', { processStatus: bad });
      assert.equal(res.changed, false, bad);
      assert.ok(res.issues.some(i => i.includes('«processStatus»')), res.issues.join('; '));
    }
  });

  test(`«Prozess-Status am Ende» on ${engine.toUpperCase()}: several ends - each with its own status`, () => {
    // a second end on the start: Start → Target → End, Start → End2
    const two = diagram(engine, 'task')
      .replace('<bpmn:outgoing>f1</bpmn:outgoing>', '<bpmn:outgoing>f1</bpmn:outgoing><bpmn:outgoing>f3</bpmn:outgoing>')
      .replace('</bpmn:process>', '<bpmn:endEvent id="End2"><bpmn:incoming>f3</bpmn:incoming></bpmn:endEvent><bpmn:sequenceFlow id="f3" sourceRef="Start" targetRef="End2" /></bpmn:process>');
    const a = applyPattern(two, status, engine, 'End', { processStatus: 'succeeded' });
    const b = applyPattern(a.xml, status, engine, 'End2', { processStatus: 'canceled' });
    assert.ok(a.changed && b.changed, [...a.issues, ...b.issues].join('; '));
    assert.deepEqual(hitsOf(b.xml, engine).sort(), [['process-status', 'End', 'succeeded'], ['process-status', 'End2', 'canceled']]);
  });

  test(`«Prozess-Status am Ende» on ${engine.toUpperCase()}: applied again with another status - one status, the new one`, () => {
    const once = applyPattern(diagram(engine, 'task'), status, engine, 'End', { processStatus: 'succeeded' }).xml;
    const same = applyPattern(once, status, engine, 'End', { processStatus: 'succeeded' });
    assert.equal(same.changed, false, 'the same status again changes nothing');
    const other = applyPattern(once, status, engine, 'End', { processStatus: 'canceled' });
    assert.ok(other.changed, other.issues.join('; '));
    const end = one(parse(other.xml), 'bpmn:endEvent');
    const set = engine === 'c7'
      ? elements(end, 'camunda:executionListener').map(l => l.getAttribute('expression'))
      : elements(end, 'zeebe:output').map(o => `${o.getAttribute('target')}=${o.getAttribute('source')}`);
    assert.deepEqual(set, engine === 'c7' ? ['${execution.setVariable("processStatus", "canceled")}'] : ['processStatus=="canceled"']);
    assert.deepEqual(hitsOf(other.xml, engine), [['process-status', 'End', 'canceled']]);
  });

  test(`a node of the block of «Init Process» still gets another pattern for what it carries beyond the block (${engine.toUpperCase()})`, () => {
    // an own pattern on end events that sets something else
    const audit: PatternDef = {
      ...status, id: 'acme-audit', name: 'Audit', params: [],
      bpmn: { [engine]: status.bpmn[engine]!.replace(/processStatus/g, 'audited').replace(/\{\{audited\}\}/g, 'yes') },
    };
    const withInit = applyPattern(diagram(engine, 'serviceTask'), init, engine, 'Target').xml;
    const blockEnd = elements(parse(withInit), 'bpmn:endEvent').find(e => e.getAttribute('name') === 'output-mocked')!.getAttribute('id')!;
    const res = applyPattern(withInit, audit, engine, blockEnd);
    assert.ok(res.changed, res.issues.join('; '));
    const hits = detectPatterns(res.xml, patternDefs({ patterns: [audit] }), engine).hits.map(h => [h.patternId, h.targetId]);
    assert.deepEqual(hits.sort(), [['acme-audit', blockEnd], ['init-process', 'Target']]);
  });
}

// the order of recognition follows the score of a pattern - the block must win whatever comes first
const SHAPE = (id: string, x: number, y: number, w = 36, h = 36) => `<bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}"><dc:Bounds x="${x}" y="${y}" width="${w}" height="${h}" /></bpmndi:BPMNShape>`;
const DI_NS = 'xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI"';
/** what an end sets as processStatus, in the form of the engine */
const statusExt = (engine: EngineId, value: string) => engine === 'c7'
  ? `<bpmn:extensionElements><camunda:executionListener expression="\${execution.setVariable(&#34;processStatus&#34;, &#34;${value}&#34;)}" event="start" /></bpmn:extensionElements>`
  : `<bpmn:extensionElements><zeebe:ioMapping><zeebe:output source="=&#34;${value}&#34;" target="processStatus" /></zeebe:ioMapping></bpmn:extensionElements>`;
const fragment = (engine: EngineId, body: string, shapes: string) =>
  `<bpmn:definitions ${NS[engine]} ${DI_NS} id="P"><bpmn:process id="PP">${body}</bpmn:process><bpmndi:BPMNDiagram id="D"><bpmndi:BPMNPlane id="PL" bpmnElement="PP">${shapes}</bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`;
/** a small pattern with a block: error boundary → link; link target → end with the status */
const blockPattern = (engine: EngineId, value: string): PatternDef => ({
  id: 'acme-mocked', name: 'Gemockt', appliesTo: ['serviceTask'],
  bpmn: { [engine]: fragment(engine, `
    <bpmn:serviceTask id="PatternTarget" />
    <bpmn:boundaryEvent id="B" attachedToRef="PatternTarget"><bpmn:outgoing>bf</bpmn:outgoing><bpmn:errorEventDefinition id="BE" /></bpmn:boundaryEvent>
    <bpmn:intermediateThrowEvent id="T" name="acme-mocked"><bpmn:incoming>bf</bpmn:incoming><bpmn:linkEventDefinition id="TL" name="acme-mocked" /></bpmn:intermediateThrowEvent>
    <bpmn:sequenceFlow id="bf" sourceRef="B" targetRef="T" />
    <bpmn:intermediateCatchEvent id="C" name="acme-mocked"><bpmn:outgoing>cf</bpmn:outgoing><bpmn:linkEventDefinition id="CL" name="acme-mocked" /></bpmn:intermediateCatchEvent>
    <bpmn:endEvent id="E" name="acme-mocked">${statusExt(engine, value)}<bpmn:incoming>cf</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="cf" sourceRef="C" targetRef="E" />`,
    `${SHAPE('PatternTarget', 200, 100, 100, 80)}${SHAPE('B', 262, 162)}${SHAPE('T', 262, 242)}${SHAPE('C', 422, 342)}${SHAPE('E', 522, 342)}`) },
});
/** an own status pattern with the status fixed in the BPMN */
const fixedStatus = (engine: EngineId, value: string): PatternDef => ({
  id: 'acme-fixed-status', name: 'Fester Status', appliesTo: ['endEvent'],
  bpmn: { [engine]: fragment(engine, `<bpmn:endEvent id="PatternTarget">${statusExt(engine, value)}</bpmn:endEvent>`, SHAPE('PatternTarget', 200, 100)) },
});
const scoreOf = (d: PatternDef, engine: EngineId) => { const fr = parseFragment(d.bpmn[engine]!); assert.ok(!('error' in fr)); return (fr as { score: number }).score; };

for (const engine of ['c7', 'c8'] as const) {
  test(`a status pattern that is recognised before a block pattern does not get the end of that block (${engine.toUpperCase()})`, () => {
    // a long status makes the status pattern score higher - it is recognised first
    const long = `output-mocked-${'x'.repeat(200)}`;
    const block = blockPattern(engine, long), status1 = fixedStatus(engine, long);
    assert.ok(scoreOf(status1, engine) > scoreOf(block, engine), `${scoreOf(status1, engine)} > ${scoreOf(block, engine)}`);
    const xml = applyPattern(diagram(engine, 'serviceTask'), block, engine, 'Target');
    assert.ok(xml.changed, xml.issues.join('; '));
    assert.deepEqual(detectPatterns(xml.xml, [block, status1], engine).hits.map(h => [h.patternId, h.targetId]), [['acme-mocked', 'Target']]);
    // and in the other order (the block first) the same
    const short = blockPattern(engine, 'x'), status2 = fixedStatus(engine, 'x');
    assert.ok(scoreOf(short, engine) > scoreOf(status2, engine));
    const xml2 = applyPattern(diagram(engine, 'serviceTask'), short, engine, 'Target').xml;
    assert.deepEqual(detectPatterns(xml2, [short, status2], engine).hits.map(h => [h.patternId, h.targetId]), [['acme-mocked', 'Target']]);
  });

  test(`a pattern with a path on two elements: both paths keep their end, the status pattern gets neither (${engine.toUpperCase()})`, () => {
    // error boundary → end with a status, on each service task
    const path: PatternDef = {
      id: 'acme-fail', name: 'Fehler-Ende', appliesTo: ['serviceTask'],
      bpmn: { [engine]: fragment(engine, `
        <bpmn:serviceTask id="PatternTarget" />
        <bpmn:boundaryEvent id="B" attachedToRef="PatternTarget"><bpmn:outgoing>bf</bpmn:outgoing><bpmn:errorEventDefinition id="BE" /></bpmn:boundaryEvent>
        <bpmn:endEvent id="E" name="failed">${statusExt(engine, 'failed')}<bpmn:incoming>bf</bpmn:incoming></bpmn:endEvent>
        <bpmn:sequenceFlow id="bf" sourceRef="B" targetRef="E" />`,
        `${SHAPE('PatternTarget', 200, 100, 100, 80)}${SHAPE('B', 262, 162)}${SHAPE('E', 262, 242)}`) },
    };
    const two = diagram(engine, 'serviceTask')
      .replace('<bpmn:outgoing>f2</bpmn:outgoing></bpmn:serviceTask>', '<bpmn:outgoing>f2</bpmn:outgoing></bpmn:serviceTask><bpmn:serviceTask id="Target2"><bpmn:incoming>f3</bpmn:incoming><bpmn:outgoing>f4</bpmn:outgoing></bpmn:serviceTask>')
      .replace('<bpmn:incoming>f2</bpmn:incoming></bpmn:endEvent>', '<bpmn:incoming>f4</bpmn:incoming></bpmn:endEvent>')
      .replace('targetRef="End" />', 'targetRef="Target2" /><bpmn:sequenceFlow id="f3" sourceRef="Target" targetRef="Target2" /><bpmn:sequenceFlow id="f4" sourceRef="Target2" targetRef="End" />')
      .replace('<bpmn:sequenceFlow id="f2" sourceRef="Target" targetRef="Target2" />', '');
    const a = applyPattern(two, path, engine, 'Target');
    const b = applyPattern(a.xml, path, engine, 'Target2');
    assert.ok(a.changed && b.changed, [...a.issues, ...b.issues].join('; '));
    const hits = detectPatterns(b.xml, patternDefs({ patterns: [path] }), engine).hits.map(h => [h.patternId, h.targetId]);
    assert.deepEqual(hits.sort(), [['acme-fail', 'Target'], ['acme-fail', 'Target2']]);
  });

  test(`a value with " or \\ is refused for any parameter inside a string - not only the status (${engine.toUpperCase()})`, () => {
    const note: PatternDef = {
      id: 'acme-note', name: 'Notiz', appliesTo: ['task'], params: [{ name: 'note' }],
      bpmn: { [engine]: fragment(engine, `<bpmn:task id="PatternTarget">${statusExt(engine, '{{note}}').replace(/processStatus/g, 'note')}</bpmn:task>`, SHAPE('PatternTarget', 200, 100, 100, 80)) },
    };
    const ok = applyPattern(diagram(engine, 'task'), note, engine, 'Target', { note: 'plain text' });
    assert.ok(ok.changed, ok.issues.join('; '));
    const bad = applyPattern(diagram(engine, 'task'), note, engine, 'Target', { note: 'say "hi"' });
    assert.equal(bad.changed, false);
    assert.ok(bad.issues.some(i => i.includes('«note»')), bad.issues.join('; '));
  });
}

test('C7: a listener that does more than set the variable is not replaced by the pattern', () => {
  const more = '${execution.setVariable("processStatus", "old") || execution.setVariable("other", 1)}';
  const xml = diagram('c7', 'task').replace('<bpmn:endEvent id="End">',
    `<bpmn:endEvent id="End"><bpmn:extensionElements><camunda:executionListener expression="${more.replace(/"/g, '&#34;')}" event="start" /></bpmn:extensionElements>`);
  const res = applyPattern(xml, status, 'c7', 'End', { processStatus: 'canceled' });
  assert.ok(res.changed, res.issues.join('; '));
  const expressions = elements(one(parse(res.xml), 'bpmn:endEvent'), 'camunda:executionListener').map(l => l.getAttribute('expression'));
  assert.deepEqual(expressions, [more, '${execution.setVariable("processStatus", "canceled")}']);
});

test('setVariableOnly: one setVariable call and nothing after it - brackets and quotes in strings do not count', () => {
  const cases: Array<[string, string | null]> = [
    ['${execution.setVariable("processStatus", "succeeded")}', 'processStatus'],
    ["#{execution.setVariable('processStatus', 'succeeded')}", 'processStatus'],
    ['${execution.setVariable("x", ")")}', 'x'],
    ['${execution.setVariable("x", "a \\" ) b")}', 'x'],
    ['${execution.setVariable("x", foo(")", bar(1)))}', 'x'],
    ['${execution.setVariable("x", foo(1)) + foo(b)}', null],
    ['${execution.setVariable("x", "a") || execution.setVariable("y", 1)}', null],
    ['${execution.setVariable("x", "unterminated)}', null],
    ['${execution.setVariable("x", foo(1)}', null],
    ['${execution.getVariable("x")}', null],
  ];
  for (const [expr, name] of cases) assert.equal(setVariableOnly(expr), name, expr);
});

// «Prozess mit Fehler stoppen» - the message as text or FEEL; C7 a Groovy exception after
// asyncBefore, C8 FEEL assert in an output mapping
const stop = STANDARD_PATTERNS.find(p => p.id === 'stop-with-error')!;
const STOP_FEEL = '"Kunde " + customerName + " ist gesperrt."';
/** the message the event carries: C7 the input parameter, C8 the first output */
const messageOf = (xml: string, id: string, engine: EngineId) => {
  const doc = parse(xml);
  const el = [...elements(doc, 'bpmn:endEvent'), ...elements(doc, 'bpmn:intermediateThrowEvent')].find(e => e.getAttribute('id') === id)!;
  if (engine === 'c7') return { message: elements(el, 'camunda:inputParameter').find(p => p.getAttribute('name') === '_errorMessage')?.textContent ?? '', async: el.getAttribute('camunda:asyncBefore'), script: elements(el, 'camunda:script')[0]?.textContent ?? '' };
  const outs = elements(el, 'zeebe:output');
  return { message: outs[0]?.getAttribute('source') ?? '', assert: outs[1]?.getAttribute('source') ?? '', targets: outs.map(o => o.getAttribute('target')) };
};
/** start → an intermediate throw event → end */
const withThrow = (engine: EngineId) => diagram(engine, 'intermediateThrowEvent');

for (const engine of ['c7', 'c8'] as const) {
  test(`«Prozess mit Fehler stoppen» on ${engine.toUpperCase()}: a text message - on an end event and on an intermediate throw event`, () => {
    for (const [xml, target] of [[diagram(engine, 'task'), 'End'], [withThrow(engine), 'Target']] as const) {
      const res = applyPattern(xml, stop, engine, target, { message: 'Kunde gesperrt.' });
      assert.ok(res.changed, res.issues.join('; '));
      const m = messageOf(res.xml, target, engine);
      if (engine === 'c7') {
        assert.equal(m.message, 'Kunde gesperrt.');
        assert.equal(m.async, 'true', 'the incident is on the event');
        assert.ok(m.script.includes('throw new IllegalArgumentException'), m.script);
      } else {
        assert.equal(m.message, '="Kunde gesperrt."');
        assert.equal(m.assert, '=assert(false, false, string(_errorMessage))');
        // two targets: Zeebe merges the outputs into one context - one name twice would be there once
        assert.deepEqual(m.targets, ['_errorMessage', '_stopped'], 'first the message, then the assert');
      }
      const hits = detectPatterns(res.xml, STANDARD_PATTERNS, engine).hits.filter(h => h.patternId === 'stop-with-error');
      assert.deepEqual(hits.map(h => [h.targetId, h.params.message]), [[target, 'Kunde gesperrt.']]);
    }
  });
}

test('«Prozess mit Fehler stoppen»: a FEEL message - JUEL on C7, the FEEL expression on C8, read back the same', () => {
  // as the step stores it: in the form of the engine (see patternParams)
  const c7Value = '${"Kunde ".concat(customerName).concat(" ist gesperrt.")}';
  const c8Value = `=${STOP_FEEL}`;
  const c7 = applyPattern(diagram('c7', 'task'), stop, 'c7', 'End', { message: c7Value }).xml;
  assert.equal(messageOf(c7, 'End', 'c7').message, c7Value);
  assert.deepEqual(detectPatterns(c7, STANDARD_PATTERNS, 'c7').hits.filter(h => h.patternId === 'stop-with-error').map(h => h.params.message), [c7Value]);
  const c8 = applyPattern(diagram('c8', 'task'), stop, 'c8', 'End', { message: c8Value }).xml;
  assert.equal(messageOf(c8, 'End', 'c8').message, c8Value);
  assert.deepEqual(detectPatterns(c8, STANDARD_PATTERNS, 'c8').hits.filter(h => h.patternId === 'stop-with-error').map(h => h.params.message), [c8Value]);
});

test('«Prozess mit Fehler stoppen»: switching engine translates the FEEL message - and back', () => {
  const c7Value = '${"Kunde ".concat(customerName).concat(" ist gesperrt.")}';
  const c7 = applyPattern(diagram('c7', 'task'), stop, 'c7', 'End', { message: c7Value }).xml;
  const c8 = convertWithPatterns(c7, 'c8', STANDARD_PATTERNS);
  assert.deepEqual(c8.issues, []);
  assert.equal(messageOf(c8.xml, 'End', 'c8').message, '="Kunde " + string(customerName) + " ist gesperrt."');
  assert.equal(messageOf(c8.xml, 'End', 'c8').assert, '=assert(false, false, string(_errorMessage))');
  const back = convertWithPatterns(c8.xml, 'c7', STANDARD_PATTERNS, { timeToLive: '5' });
  assert.deepEqual(back.issues, []);
  assert.equal(messageOf(back.xml, 'End', 'c7').message, c7Value);
  assert.equal(messageOf(back.xml, 'End', 'c7').async, 'true');
});

test('«Prozess mit Fehler stoppen»: fixed text goes over the engine switch as text - and back', () => {
  const c7 = applyPattern(diagram('c7', 'task'), stop, 'c7', 'End', { message: 'Kunde gesperrt.' }).xml;
  const c8 = convertWithPatterns(c7, 'c8', STANDARD_PATTERNS);
  assert.deepEqual(c8.issues, []);
  assert.equal(messageOf(c8.xml, 'End', 'c8').message, '="Kunde gesperrt."');
  const back = convertWithPatterns(c8.xml, 'c7', STANDARD_PATTERNS, { timeToLive: '5' });
  assert.deepEqual(back.issues, []);
  assert.equal(messageOf(back.xml, 'End', 'c7').message, 'Kunde gesperrt.');
});

test('«Prozess mit Fehler stoppen»: a FEEL message without JUEL counterpart is said on the way to C7', () => {
  const c8 = applyPattern(diagram('c8', 'task'), stop, 'c8', 'End', { message: '=string join(["a", "b"], ", ")' }).xml;
  const c7 = convertWithPatterns(c8, 'c7', STANDARD_PATTERNS, { timeToLive: '5' });
  assert.ok(c7.issues.some(i => i.stepId === 'End' && i.text.includes('«message»') && i.text.includes('nicht nach JUEL')), c7.issues.map(i => i.text).join('; '));
});

test('«Prozess mit Fehler stoppen» on C8: a text message with a quote is refused - it would end the FEEL string', () => {
  const res = applyPattern(diagram('c8', 'task'), stop, 'c8', 'End', { message: 'Kunde "X" gesperrt' });
  assert.equal(res.changed, false);
  assert.ok(res.issues.some(i => i.includes('«message»')), res.issues.join('; '));
  // as FEEL it works
  const feel = applyPattern(diagram('c8', 'task'), stop, 'c8', 'End', { message: '="Kunde \\"X\\" gesperrt"' });
  assert.ok(feel.changed, feel.issues.join('; '));
});
