// A whole BPMN or DMN in one form (formatXml) - the merge from Orch Spec compares base, new and code
// with it: indentation, attribute order and `<a></a>` / `<a/>` are no change, the content is.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DOMParser } from 'linkedom';
import { formatXml } from '../src/xmlFormat';

const root = resolve(import.meta.dirname, '..');
const fixtures = ['tools/fixtures/engine-c7.bpmn', 'tools/fixtures/edge-cases.bpmn', 'tests/fixtures/spec-folder/processes/order.bpmn']
  .map(f => readFileSync(join(root, f), 'utf8'));

/** The content of a document: elements, attributes (sorted), texts without the blanks between elements. */
function content(xml: string): unknown {
  const doc = new DOMParser().parseFromString(xml, 'text/xml') as unknown as Document;
  const walk = (el: Element): unknown => ({
    name: el.tagName,
    attrs: Array.from(el.attributes).map(a => `${a.name}=${a.value}`).sort(),
    kids: Array.from(el.childNodes)
      .filter(n => n.nodeType === 1 || (n.nodeType !== 8 && (n.textContent ?? '').trim()))
      .map(n => (n.nodeType === 1 ? walk(n as Element) : n.textContent)),
  });
  return walk(doc.documentElement);
}

test('formatted once is formatted - and the content stays', () => {
  for (const xml of fixtures) {
    const once = formatXml(xml);
    assert.equal(formatXml(once), once);
    assert.deepEqual(content(once), content(xml));
  }
});

test('indentation, attribute order, empty elements and the declaration are one form', () => {
  const a = `<?xml version="1.0" encoding="utf-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d"><bpmn:process isExecutable="true" id="p" name="P">
<bpmn:startEvent id="s"></bpmn:startEvent>
      <bpmn:endEvent name="end" id="e"/></bpmn:process></bpmn:definitions>`;
  const b = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d">
  <bpmn:process id="p" name="P" isExecutable="true">
    <bpmn:startEvent id="s" />
    <bpmn:endEvent id="e" name="end" />
  </bpmn:process>
</bpmn:definitions>
`;
  assert.equal(formatXml(a), formatXml(b));
  assert.equal(formatXml(a), b);
});

test('texts, CDATA, comments and entities stay as they were', () => {
  const xml = `<definitions id="d"><decision id="x"><!-- a note -->
  <script scriptFormat="groovy"><![CDATA[if (a < b) {
    x = 1
  }]]></script>
  <text>  a &lt; b  </text><cond attr='say "hi"'>\${x &amp;&amp; y}</cond><blank> </blank></decision></definitions>`;
  assert.equal(formatXml(xml), `<definitions id="d">
  <decision id="x">
    <!-- a note -->
    <script scriptFormat="groovy"><![CDATA[if (a < b) {
    x = 1
  }]]></script>
    <text>  a &lt; b  </text>
    <cond attr="say &quot;hi&quot;">\${x &amp;&amp; y}</cond>
    <blank> </blank>
  </decision>
</definitions>
`);
});

test('what is not XML stays as it is', () => {
  for (const bad of ['', 'no xml', '<a><b></a>', '<a/><b/>']) assert.equal(formatXml(bad), bad);
});

test('the tool: one file, or many as JSON', () => {
  const file = join(root, 'tests/fixtures/spec-folder/processes/order.bpmn');
  const one = spawnSync(process.execPath, [join(root, 'tools/xmlformat.ts'), file], { encoding: 'utf8' });
  assert.equal(one.status, 0, one.stderr);
  assert.equal(one.stdout, formatXml(readFileSync(file, 'utf8')));
  const many = spawnSync(process.execPath, [join(root, 'tools/xmlformat.ts'), '--json'], { encoding: 'utf8', input: JSON.stringify({ a: '<a><b/></a>', b: 'x' }) });
  assert.equal(many.status, 0, many.stderr);
  assert.deepEqual(JSON.parse(many.stdout), { a: '<a>\n  <b />\n</a>\n', b: 'x' });
});
