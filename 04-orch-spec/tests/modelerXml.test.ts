// BPMN and DMN written as the Camunda Modeler writes them (modelerXml) - the form the merge from
// Orch Spec compares in and writes: a file the Modeler saved stays as it is.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { modelerXml } from '../src/modelerXml';
import { formatXml } from '../src/xmlFormat';

const root = resolve(import.meta.dirname, '..');
const read = (f: string) => readFileSync(join(root, f), 'utf8');

const c7 = (task: string) => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="d" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="p" isExecutable="true">
    ${task}
  </bpmn:process>
</bpmn:definitions>
`;

test('the form of the Modeler: attribute order, quotes, indentation - however it was written', async () => {
  const a = c7('<bpmn:serviceTask id="t" name="T" camunda:type="external" camunda:topic="x"><bpmn:extensionElements><camunda:executionListener event="start" expression="#{f(&#34;a&#34;)}" /></bpmn:extensionElements></bpmn:serviceTask>');
  const b = c7(`<bpmn:serviceTask camunda:topic="x" name="T" id="t" camunda:type="external">
          <bpmn:extensionElements>
                <camunda:executionListener expression="#{f(&quot;a&quot;)}" event="start"></camunda:executionListener>
          </bpmn:extensionElements>
    </bpmn:serviceTask>`);
  const out = await modelerXml(a);
  assert.equal(await modelerXml(b), out);
  assert.equal(await modelerXml(out), out);
  assert.match(out, /\n {4}<bpmn:serviceTask id="t" name="T" camunda:type="external" camunda:topic="x">\n/);
  assert.match(out, /expression="#\{f\(&#34;a&#34;\)\}"/);
});

test('the fixtures: formatted once is formatted, no id lost', async () => {
  for (const f of ['tools/fixtures/engine-c7.bpmn', 'tools/fixtures/edge-cases.bpmn', 'tests/fixtures/spec-folder/processes/order.bpmn']) {
    const once = await modelerXml(read(f));
    assert.equal(await modelerXml(once), once, f);
    const ids = (x: string) => [...x.matchAll(/\sid="([^"]*)"/g)].map(m => m[1]).sort();
    assert.deepEqual(ids(once), ids(read(f)), f);
  }
});

test('Camunda 8: the zeebe extensions stay', async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:zeebe="http://camunda.org/schema/zeebe/1.0" id="d" targetNamespace="x">
  <bpmn:process id="p" isExecutable="true"><bpmn:serviceTask id="t"><bpmn:extensionElements><zeebe:ioMapping><zeebe:input source="=a" target="b"/></zeebe:ioMapping><zeebe:taskDefinition type="p-t"/></bpmn:extensionElements></bpmn:serviceTask></bpmn:process>
</bpmn:definitions>`;
  const out = await modelerXml(xml);
  assert.match(out, /<zeebe:taskDefinition type="p-t" \/>/);
  assert.match(out, /<zeebe:input source="=a" target="b" \/>/);
});

test('a DMN of the Modeler', async () => {
  const dmn = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" id="defs" name="D" namespace="http://camunda.org/schema/1.0/dmn"><decision id="rules" name="Rules"><decisionTable id="t"><output id="o" name="r" typeRef="string" /><rule id="r1"><outputEntry id="e1"><text>"a"</text></outputEntry></rule></decisionTable></decision></definitions>`;
  const out = await modelerXml(dmn);
  assert.equal(await modelerXml(out), out);
  assert.match(out, /\n {10}<text>"a"<\/text>\n/);
});

test('what moddle does not know is not lost: formatXml instead', async () => {
  // camunda: and zeebe: in one diagram - no moddle knows both
  const mixed = c7('<bpmn:serviceTask id="t" camunda:topic="x"><bpmn:extensionElements><zeebe:taskDefinition xmlns:zeebe="http://camunda.org/schema/zeebe/1.0" type="y" /></bpmn:extensionElements></bpmn:serviceTask>');
  assert.equal(await modelerXml(mixed), formatXml(mixed));
  assert.equal(await modelerXml('<a><b/></a>'), formatXml('<a><b/></a>'));
  assert.equal(await modelerXml('not xml'), 'not xml');
});

test('the tool: one file, or many as JSON - as the Modeler writes them', async () => {
  const file = join(root, 'tests/fixtures/spec-folder/processes/order.bpmn');
  const one = spawnSync(process.execPath, [join(root, 'tools/xmlformat.ts'), file], { encoding: 'utf8' });
  assert.equal(one.status, 0, one.stderr);
  assert.equal(one.stdout, await modelerXml(read('tests/fixtures/spec-folder/processes/order.bpmn')));
  const many = spawnSync(process.execPath, [join(root, 'tools/xmlformat.ts'), '--json'], { encoding: 'utf8', input: JSON.stringify({ a: '<a><b/></a>', b: 'x' }) });
  assert.equal(many.status, 0, many.stderr);
  assert.deepEqual(JSON.parse(many.stdout), { a: '<a>\n  <b />\n</a>\n', b: 'x' });
});
