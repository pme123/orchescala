// Mappings on a gateway between Camunda 7 and 8. Camunda 7 rejects an inputOutput
// on a gateway (ENGINE-09005), Zeebe ignores an ioMapping there. C8 -> C7: an output
// becomes a listener, an input a comment (with issues). And a counter stays
// null-safe in both directions: JUEL counts null as 0 in arithmetic, FEEL keeps null.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { convertBpmn } from '../src/engineConvert';
import { feelToJuel } from '../src/feelJuel';
import { importExpression, juelToFeel } from '../src/juelFeel';
import { installXmlNamespaces } from './xmlNamespaces';

const g = globalThis as unknown as Record<string, unknown>;
g.DOMParser ??= DOMParser;
g.XMLSerializer ??= class { serializeToString(doc: { toString(): string }) { return doc.toString(); } };
installXmlNamespaces();

/** start → gateway `gw` → task → end; `join`: a second start also flows into the gateway */
const c8 = (gateway: string, opts: { task?: string; join?: boolean } = {}) => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:zeebe="http://camunda.org/schema/zeebe/1.0" xmlns:modeler="http://camunda.org/schema/modeler/1.0" modeler:executionPlatform="Camunda Cloud" id="d" targetNamespace="x">
  <bpmn:process id="p" isExecutable="true">
    <bpmn:startEvent id="s"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    ${opts.join ? '<bpmn:startEvent id="s2"><bpmn:outgoing>f0</bpmn:outgoing></bpmn:startEvent><bpmn:sequenceFlow id="f0" sourceRef="s2" targetRef="gw" />' : ''}
    ${gateway}
    <bpmn:serviceTask id="t" name="Check"><bpmn:extensionElements><zeebe:taskDefinition type="check" />${opts.task ?? ''}</bpmn:extensionElements><bpmn:incoming>f2</bpmn:incoming><bpmn:outgoing>f3</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:endEvent id="e"><bpmn:incoming>f3</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="gw" />
    <bpmn:sequenceFlow id="f2" sourceRef="gw" targetRef="t" />
    <bpmn:sequenceFlow id="f3" sourceRef="t" targetRef="e" />
  </bpmn:process>
</bpmn:definitions>`;

/** a gateway with these extension elements */
const gateway = (kind: string, ext: string, join = false) =>
  `<bpmn:${kind} id="gw"><bpmn:extensionElements>${ext}</bpmn:extensionElements><bpmn:incoming>f1</bpmn:incoming>${join ? '<bpmn:incoming>f0</bpmn:incoming>' : ''}<bpmn:outgoing>f2</bpmn:outgoing></bpmn:${kind}>`;
const ioMapping = (...rows: string[]) => `<zeebe:ioMapping>${rows.join('')}</zeebe:ioMapping>`;
const COUNT = '<zeebe:output source="=count + 1" target="count" />';
const LIMIT = '<zeebe:input source="=1" target="limit" />';

const parse = (xml: string) => new DOMParser().parseFromString(xml, 'text/xml') as unknown as Document;
const byId = (doc: Document, id: string) => Array.from(doc.querySelectorAll('*')).find(e => e.getAttribute('id') === id);
const childrenOf = (el: Element | undefined, tag: string) => Array.from(el?.querySelectorAll('*') ?? []).filter(e => e.tagName === tag);
/** the listeners on the gateway, as the engine reads them: event and expression (entities decoded) */
const listeners = (xml: string) => childrenOf(byId(parse(xml), 'gw'), 'camunda:executionListener')
  .map(l => `${l.getAttribute('event')}: ${l.getAttribute('expression')}`);
const comments = (xml: string) => [...xml.matchAll(/<!--([\s\S]*?)-->/g)].map(m => m[1]);
const mappingIssues = (r: { issues: { stepId: string; where: string; text: string }[] }) =>
  r.issues.filter(i => i.stepId === 'gw' && i.where === 'Mapping').map(i => i.text);

for (const kind of ['exclusiveGateway', 'parallelGateway', 'inclusiveGateway', 'eventBasedGateway']) {
  test(`C8 -> C7: an ioMapping on a ${kind} - the output a start listener, the input a comment`, () => {
    const r = convertBpmn(c8(gateway(kind, ioMapping(LIMIT, COUNT))), 'c7');
    const gw = byId(parse(r.xml), 'gw');
    assert.deepEqual(childrenOf(gw, 'camunda:inputOutput'), [], r.xml);
    // start: the conditions of the gateway already see the new value; null-safe: `${count}` would throw on the first pass
    assert.deepEqual(listeners(r.xml), ['start: ${execution.setVariable("count", execution.getVariable("count") + 1)}']);
    assert.deepEqual(comments(r.xml).map(c => c.trim()), ['Camunda 8, nicht übernommen: zeebe:input source="=1" target="limit"']);
    const issues = mappingIssues(r);
    assert.equal(issues.length, 2, JSON.stringify(r.issues));
    assert.ok(issues[0].includes(`«count» als Start-Listener am ${kind}`), issues[0]);
    assert.ok(issues[1].includes('«limit» NICHT übernommen'), issues[1]);
  });
}

for (const kind of ['parallelGateway', 'inclusiveGateway']) {
  test(`C8 -> C7: a join of a ${kind} - an end listener, once and not per arriving branch`, () => {
    const r = convertBpmn(c8(gateway(kind, ioMapping(COUNT), true), { join: true }), 'c7');
    assert.deepEqual(listeners(r.xml), ['end: ${execution.setVariable("count", execution.getVariable("count") + 1)}']);
    assert.ok(mappingIssues(r)[0].includes('als End-Listener'), JSON.stringify(r.issues));
    // the conditions at a join are evaluated before the end listener - the issue says so
    assert.ok(mappingIssues(r)[0].includes('Bedingungen am Gateway sehen noch den alten Wert'), JSON.stringify(r.issues));
  });
}

for (const kind of ['exclusiveGateway', 'eventBasedGateway']) {
  test(`C8 -> C7: a merging ${kind} keeps the start listener - each branch passes on its own`, () => {
    const r = convertBpmn(c8(gateway(kind, ioMapping(COUNT), true), { join: true }), 'c7');
    assert.deepEqual(listeners(r.xml).map(l => l.split(':')[0]), ['start']);
  });
}

test('C8 -> C7: a parallel gateway that joins and forks - the end listener, once', () => {
  const both = gateway('parallelGateway', ioMapping(COUNT), true).replace('<bpmn:outgoing>f2</bpmn:outgoing>', '<bpmn:outgoing>f2</bpmn:outgoing><bpmn:outgoing>f4</bpmn:outgoing>');
  const xml = c8(both, { join: true }).replace('</bpmn:process>', '<bpmn:endEvent id="e2"><bpmn:incoming>f4</bpmn:incoming></bpmn:endEvent><bpmn:sequenceFlow id="f4" sourceRef="gw" targetRef="e2" /></bpmn:process>');
  const r = convertBpmn(xml, 'c7');
  assert.deepEqual(listeners(r.xml).map(l => l.split(':')[0]), ['end']);
});

// not a gateway, but the same setVariableListener: events changed with it
test('C8 -> C7 (event, not gateway): an untranslatable output on an end event - a comment, not the FEEL as a text', () => {
  const xml = c8('<bpmn:exclusiveGateway id="gw"><bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing></bpmn:exclusiveGateway>')
    .replace('<bpmn:endEvent id="e"><bpmn:incoming>f3</bpmn:incoming></bpmn:endEvent>',
      `<bpmn:endEvent id="e"><bpmn:extensionElements>${ioMapping('<zeebe:output source="=some x in xs satisfies x &gt; 1" target="any" />')}</bpmn:extensionElements><bpmn:incoming>f3</bpmn:incoming></bpmn:endEvent>`);
  const r = convertBpmn(xml, 'c7');
  const end = byId(parse(r.xml), 'e');
  assert.deepEqual(childrenOf(end, 'camunda:executionListener'), [], r.xml);
  assert.ok(comments(r.xml).some(c => c.includes('target="any"')), r.xml);
  assert.ok(r.issues.some(i => i.stepId === 'e' && i.text.includes('nicht nach JUEL übersetzbar')), JSON.stringify(r.issues));
});

test('C8 -> C7: one output translatable, one not - the issue names only the listener', () => {
  const bad = '<zeebe:output source="=some x in xs satisfies x &gt; 1" target="any" />';
  const r = convertBpmn(c8(gateway('exclusiveGateway', ioMapping(COUNT, bad))), 'c7');
  assert.equal(listeners(r.xml).length, 1, r.xml);
  assert.deepEqual(mappingIssues(r).map(t => t.split(' — ')[0]), ['Ausgabe «count» als Start-Listener am exclusiveGateway']);
  // none translatable: no «als Start-Listener» issue at all
  const none = convertBpmn(c8(gateway('exclusiveGateway', ioMapping(bad))), 'c7');
  assert.deepEqual(listeners(none.xml), []);
  assert.deepEqual(mappingIssues(none), []);
  assert.ok(none.issues.some(i => i.text.includes('nicht nach JUEL übersetzbar')), JSON.stringify(none.issues));
});

test('C8 -> C7: inputs on a join - the end listener and the input as a comment', () => {
  const r = convertBpmn(c8(gateway('parallelGateway', ioMapping(LIMIT, COUNT), true), { join: true }), 'c7');
  assert.deepEqual(listeners(r.xml).map(l => l.split(':')[0]), ['end']);
  assert.equal(comments(r.xml).length, 1, r.xml);
  assert.equal(mappingIssues(r).length, 2, JSON.stringify(r.issues));
});

test('C8 -> C7: an output on a gateway that is not translatable - no listener, a comment and the issue', () => {
  const r = convertBpmn(c8(gateway('exclusiveGateway', ioMapping('<zeebe:output source="=some x in xs satisfies x &gt; 1" target="any" />'))), 'c7');
  // not `setVariable("any", "=some x …")` - the FEEL as a text
  assert.deepEqual(listeners(r.xml), []);
  // (linkedom writes `>` in a comment as `&gt;`, the browser does not)
  assert.deepEqual(comments(r.xml).map(c => c.trim().replace(/&gt;/g, '>')), ['Camunda 8, nicht übernommen: zeebe:output source="=some x in xs satisfies x > 1" target="any"']);
  assert.ok(r.issues.some(i => i.stepId === 'gw' && i.text.includes('nicht nach JUEL übersetzbar')), JSON.stringify(r.issues));
});

test('C8 -> C7: several outputs - one listener each, one issue', () => {
  const r = convertBpmn(c8(gateway('exclusiveGateway', ioMapping(COUNT, '<zeebe:output source="=true" target="checked" />'))), 'c7');
  assert.deepEqual(listeners(r.xml), [
    'start: ${execution.setVariable("count", execution.getVariable("count") + 1)}',
    'start: ${execution.setVariable("checked", true)}',
  ]);
  assert.equal(mappingIssues(r).length, 1, JSON.stringify(r.issues));
  assert.ok(mappingIssues(r)[0].includes('«count», «checked»'));
  assert.deepEqual(comments(r.xml), []);
});

test('C8 -> C7: only inputs - no listener, a comment and one issue', () => {
  const r = convertBpmn(c8(gateway('exclusiveGateway', ioMapping(LIMIT))), 'c7');
  assert.deepEqual(listeners(r.xml), []);
  assert.equal(comments(r.xml).length, 1, r.xml);
  assert.deepEqual(mappingIssues(r).map(t => t.split(' — ')[0]), ['Eingabe «limit» NICHT übernommen']);
  assert.deepEqual(childrenOf(byId(parse(r.xml), 'gw'), 'bpmn:extensionElements'), [], 'no empty extensionElements');
});

test('C8 -> C7: an output that reads a dropped input - flagged', () => {
  const r = convertBpmn(c8(gateway('exclusiveGateway', ioMapping(LIMIT, '<zeebe:output source="=count &lt; limit" target="retry" />'))), 'c7');
  assert.ok(mappingIssues(r).some(t => t.startsWith('Ausgabe liest die Eingabe «limit»')), JSON.stringify(r.issues));
  // `limits` or `a.limit` is another variable, `"limit"` a text
  const other = convertBpmn(c8(gateway('exclusiveGateway', ioMapping(LIMIT, '<zeebe:output source="=string(limits + a.limit) + &quot;limit&quot;" target="retry" />'))), 'c7');
  assert.ok(!mappingIssues(other).some(t => t.startsWith('Ausgabe liest')), JSON.stringify(other.issues));
  // FEEL names may hold any letter
  const umlaut = convertBpmn(c8(gateway('exclusiveGateway', ioMapping('<zeebe:input source="=1" target="zähler" />', '<zeebe:output source="=zähler + 1" target="n" />'))), 'c7');
  assert.ok(mappingIssues(umlaut).some(t => t.startsWith('Ausgabe liest die Eingabe «zähler»')), JSON.stringify(umlaut.issues));
  const umlautOther = convertBpmn(c8(gateway('exclusiveGateway', ioMapping('<zeebe:input source="=1" target="zähler" />', '<zeebe:output source="=zählerß + 1" target="n" />'))), 'c7');
  assert.ok(!mappingIssues(umlautOther).some(t => t.startsWith('Ausgabe liest')), JSON.stringify(umlautOther.issues));
});

test('C8 -> C7: an output that is not FEEL - a fixed text', () => {
  const r = convertBpmn(c8(gateway('exclusiveGateway', ioMapping('<zeebe:output source="done" target="state" />'))), 'c7');
  assert.deepEqual(listeners(r.xml), ['start: ${execution.setVariable("state", "done")}']);
});

test('C8 -> C7: other extensions on the gateway stay - next to the listener', () => {
  const r = convertBpmn(c8(gateway('exclusiveGateway', `${ioMapping(COUNT)}<zeebe:properties><zeebe:property name="k" value="v" /></zeebe:properties>`)), 'c7');
  const gw = byId(parse(r.xml), 'gw');
  assert.equal(childrenOf(gw, 'camunda:property')[0]?.getAttribute('name'), 'k', r.xml);
  assert.equal(listeners(r.xml).length, 1, r.xml);
});

test('C8 -> C7: no `--` in the comment - not even from `---`', () => {
  const r = convertBpmn(c8(gateway('exclusiveGateway', ioMapping('<zeebe:input source="=a---b - -1" target="limit" />'))), 'c7');
  const [c] = comments(r.xml);
  assert.ok(c && !c.includes('--') && !c.endsWith('-'), c);
  assert.ok(c.includes('a- - -b'), c);
});

test('C8 -> C7: an ioMapping on a task still becomes an inputOutput', () => {
  const r = convertBpmn(c8('<bpmn:exclusiveGateway id="gw"><bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing></bpmn:exclusiveGateway>',
    { task: ioMapping('<zeebe:input source="=1" target="limit" />', COUNT) }), 'c7');
  const t = byId(parse(r.xml), 't');
  assert.deepEqual(childrenOf(t, 'camunda:inputParameter').map(p => `${p.getAttribute('name')}=${p.textContent}`), ['limit=${1}']);
  assert.deepEqual(childrenOf(t, 'camunda:outputParameter').map(p => `${p.getAttribute('name')}=${p.textContent}`), ['count=${count + 1}']);
  assert.ok(!r.issues.some(i => i.where === 'Mapping'), JSON.stringify(r.issues));
});

// ── null in arithmetic: JUEL counts it as 0, FEEL keeps null ─────────────────

test('C7 -> C8: execution.getVariable in arithmetic is null-safe - a missing counter starts at 0', () => {
  const safe = '(if count = null then 0 else count)';
  assert.equal(importExpression('${execution.getVariable("count") + 1}'), `= ${safe} + 1`);
  assert.equal(importExpression('${2 * execution.getVariable("count")}'), `= 2 * ${safe}`);
  assert.equal(importExpression('${execution.getVariable("count") - 1}'), `= ${safe} - 1`);
  assert.equal(importExpression('${execution.getVariable("count") / 2}'), `= ${safe} / 2`);
  assert.equal(importExpression('${execution.getVariable("count") mod 2}'), `= modulo(${safe}, 2)`);
  assert.equal(importExpression('${-execution.getVariable("count")}'), `= -${safe}`);
  // a variable read directly must be set in Camunda 7 anyway - it stays as it is
  assert.equal(importExpression('${count + 1}'), '= count + 1');
  // not in arithmetic: the variable as it is
  assert.equal(importExpression('${execution.getVariable("count")}'), '= count');
  assert.equal(importExpression('${execution.getVariable("count") > 3}'), '= count > 3');
  // only this read is null-safe - not a direct read of the same name elsewhere
  assert.equal(importExpression('${execution.getVariable("c") > 0 && c + 1 > 0}'), '= c > 0 and c + 1 > 0');
  assert.equal(importExpression('${(execution.getVariable("c")) + 1}'), '= (if c = null then 0 else c) + 1');
  assert.equal(importExpression('${execution.getVariable("c") + execution.getVariable("d")}'), '= (if c = null then 0 else c) + (if d = null then 0 else d)');
  // a path from it is no longer the variable itself
  assert.equal(importExpression('${execution.getVariable("a").prop("b") + 1}'), '= a.b + 1');
  // unary minus without getVariable stays
  assert.equal(importExpression('${-(a + b)}'), '= -(a + b)');
});

test('C7 -> C8: a marker does not leak through a method call', () => {
  const r = juelToFeel('execution.getVariable("a").concat("x")');
  assert.ok(r.ok && !r.feel.includes('\u0001'), JSON.stringify(r));
  assert.equal(importExpression('${execution.getVariable("a").concat("x")}'), '= string(a) + "x"');
});

test('C8 -> C7: allOptional never rewrites a name bound in the expression', () => {
  // `item` of a filter is `@` in JSONPath; for/some have no JUEL counterpart (rejected); a context key stays JSON
  assert.deepEqual(feelToJuel('xs[item.x = 1]', { allOptional: true }), { ok: true, juel: 'S(execution.getVariable("xs")).jsonPath("$[?(@.x == 1)]").elementList()' });
  for (const f of ['for x in xs return x + n', 'some x in xs satisfies x > n']) assert.equal(feelToJuel(f, { allOptional: true }).ok, false, f);
  const ctx = feelToJuel('{a: 1}.a', { allOptional: true });
  assert.ok(ctx.ok && !ctx.juel.includes('getVariable'), JSON.stringify(ctx));
});

test('C8 -> C7: allOptional with a path or a function - only the variable is read with getVariable, the Spin path stays', () => {
  assert.deepEqual(feelToJuel('count.x + 1', { allOptional: true }), { ok: true, juel: 'execution.getVariable("count").prop("x").value() + 1' });
  assert.deepEqual(feelToJuel('string(x)', { allOptional: true }), { ok: true, juel: '"".concat(execution.getVariable("x"))' });
});

test('C7 -> C8: a U+0001 in the input is rejected - it is the marker of a read', () => {
  const r = juelToFeel('execution.getVariable("a") + "\u00010\u0001"');
  assert.ok(!r.ok && r.reason.includes('U+0001'), JSON.stringify(r));
});

test('C7 -> C8: a nested getVariable is a computed name - rejected, no marker leaks', () => {
  for (const body of ['execution.getVariable(execution.getVariable("k")) + 1', 'execution.getVariable("a".concat(execution.getVariable("k")))']) {
    const r = juelToFeel(body);
    assert.equal(r.ok, false, body);
    assert.ok(!r.ok && r.reason.startsWith('getVariable mit berechnetem Namen') && !r.reason.includes('\u0001'), JSON.stringify(r));
  }
});

test('C8 -> C7: the null-safe FEEL counter on a gateway becomes a JUEL listener again', () => {
  const r = convertBpmn(c8(gateway('exclusiveGateway', ioMapping('<zeebe:output source="=(if count = null then 0 else count) + 1" target="count" />'))), 'c7');
  assert.deepEqual(listeners(r.xml), ['start: ${execution.setVariable("count", ((execution.getVariable("count") == null ? 0 : execution.getVariable("count"))) + 1)}']);
  assert.ok(!r.issues.some(i => i.text.includes('nicht nach JUEL')), JSON.stringify(r.issues));
});

test('round trip C7 -> C8 -> C7: a counter on a gateway stays null-safe', () => {
  const c7 = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="d" targetNamespace="x"><bpmn:process id="p" isExecutable="true">
  <bpmn:startEvent id="s"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
  <bpmn:exclusiveGateway id="gw"><bpmn:extensionElements><camunda:executionListener expression="\${execution.setVariable(&#34;count&#34;, execution.getVariable(&#34;count&#34;) + 1)}" event="start" /></bpmn:extensionElements><bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing></bpmn:exclusiveGateway>
  <bpmn:endEvent id="e"><bpmn:incoming>f2</bpmn:incoming></bpmn:endEvent>
  <bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="gw" /><bpmn:sequenceFlow id="f2" sourceRef="gw" targetRef="e" />
</bpmn:process></bpmn:definitions>`;
  const toC8 = convertBpmn(c7, 'c8');
  const out = childrenOf(parse(toC8.xml).documentElement as unknown as Element, 'zeebe:output');
  assert.deepEqual(out.map(o => o.getAttribute('source')), ['=(if count = null then 0 else count) + 1'], toC8.xml);
  const back = convertBpmn(toC8.xml, 'c7');
  assert.ok(!back.xml.includes('zeebe:'), back.xml);
  const params = childrenOf(parse(back.xml).documentElement as unknown as Element, 'camunda:outputParameter').map(p => p.textContent ?? '');
  // `count` in the else branch is read only once it is set
  assert.deepEqual(params, ['${((execution.getVariable("count") == null ? 0 : count)) + 1}'], back.xml);
  assert.ok(!back.issues.some(i => i.text.includes('nicht nach JUEL')), JSON.stringify(back.issues));
});
