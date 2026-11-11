// Mappings on a gateway between Camunda 7 and 8. Camunda 7 rejects an inputOutput
// on a gateway (ENGINE-09005), Zeebe ignores an ioMapping there. C8 -> C7: an output
// becomes a listener, an input a comment (with issues). And a counter stays
// null-safe in both directions: JUEL counts null as 0 in arithmetic, FEEL keeps null.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { convertBpmn } from '../src/engineConvert';
import { importExpression } from '../src/juelFeel';
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
  });
}

test('C8 -> C7: a merging exclusive gateway keeps the start listener - each branch passes on its own', () => {
  const r = convertBpmn(c8(gateway('exclusiveGateway', ioMapping(COUNT), true), { join: true }), 'c7');
  assert.deepEqual(listeners(r.xml).map(l => l.split(':')[0]), ['start']);
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
  // `limits` or `a.limit` is another variable
  const other = convertBpmn(c8(gateway('exclusiveGateway', ioMapping(LIMIT, '<zeebe:output source="=limits + a.limit" target="retry" />'))), 'c7');
  assert.ok(!mappingIssues(other).some(t => t.startsWith('Ausgabe liest')), JSON.stringify(other.issues));
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
  assert.ok(params.some(p => p.includes('execution.getVariable("count") == null')), back.xml);
  assert.ok(!back.issues.some(i => i.text.includes('nicht nach JUEL')), JSON.stringify(back.issues));
});
