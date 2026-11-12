// A Groovy script that is only a literal (`[fileIdLetter, docLink]`) reads the same
// in FEEL — the import takes it as `= […]` instead of a script to rewrite.
// The Camunda 7 export keeps the script as long as the row is unchanged.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { allSteps, importBpmn } from '../src/bpmn';
import { writeBpmn } from '../src/bpmnWrite';
import { groovyToFeel, outputSource } from '../src/juelFeel';
import { feelRef, isPlainFeelName } from '../src/feelNames';

(globalThis as unknown as { DOMParser: unknown }).DOMParser = DOMParser;
(globalThis as unknown as { XMLSerializer: unknown }).XMLSerializer = class { serializeToString(n: Node) { return String(n); } };

test('Groovy literals become FEEL', () => {
  assert.equal(groovyToFeel('[fileIdLetter, docLink]'), '[fileIdLetter, docLink]');
  assert.equal(groovyToFeel("['a', \"b\", 1, -2.5, true, null]"), '["a", "b", 1, -2.5, true, null]');
  assert.equal(groovyToFeel('[[a], []]'), '[[a], []]');
  assert.equal(groovyToFeel("[key: x, 'other-key': 'v']"), '{key: x, "other-key": "v"}');
  assert.equal(groovyToFeel('[:]'), '{}');
  assert.equal(groovyToFeel('return [a, b];'), '[a, b]');
  assert.equal(groovyToFeel("'it\\'s'"), '"it\'s"');
});

test('anything else stays a script', () => {
  for (const s of [
    '[a.b]', '[a()]', 'a + b', '"x ${a}"', '[a ? b : c]', '[1L]', 'def x = 1; [x]', '[a: 1, b]', '[a',
    // triple-quoted text, a unicode escape, a comment, a bare `return`
    "'''x'''", '"""x"""', "'\\u00e9'", '[a] // the letters', '/* x */ [a]', 'return', 'return ',
  ]) {
    assert.equal(groovyToFeel(s), null, s);
  }
});

test('what FEEL would read differently stays a script', () => {
  // octal in Groovy (8), decimal in FEEL (10)
  for (const s of ['010', '[010]', '-07', '[a: 00]']) assert.equal(groovyToFeel(s), null, s);
  assert.equal(groovyToFeel('[0, 0.5, -0, 10]'), '[0, 0.5, -0, 10]');
  // a reserved word or a Groovy-only name as a variable
  for (const s of ['[function]', '[for]', 'in', '[it]', '[this]', '[execution]']) assert.equal(groovyToFeel(s), null, s);
  // a map key given twice: Groovy keeps the last, FEEL has no such context
  assert.equal(groovyToFeel('[a: 1, a: 2]'), null);
  assert.equal(groovyToFeel("[a: 1, 'a': 2]"), null);
});

test('a reserved word as a map key is quoted', () => {
  assert.equal(groovyToFeel('[for: x, in: 1, ok: true]'), '{"for": x, "in": 1, ok: true}');
});

test('non-ASCII text stays as it is', () => {
  assert.equal(groovyToFeel("['Gebühr', 'Brief für Kunde']"), '["Gebühr", "Brief für Kunde"]');
});

test('choosing a service: the source of an output', () => {
  // what the row had stays
  assert.equal(outputSource('client', '= result.client', undefined), '= result.client');
  // the catalog expression, JUEL as FEEL
  assert.equal(outputSource('client', undefined, '${client}'), '= client');
  // otherwise the field of the same name, also for a row with an empty source
  assert.equal(outputSource('client', undefined, undefined), '= client');
  assert.equal(outputSource('client', '', undefined), '= client');
  assert.equal(outputSource('client', '  ', ''), '= client');
  // a name FEEL does not read as it is: in backticks
  assert.equal(outputSource('letter-id', undefined, undefined), '= `letter-id`');
  assert.equal(outputSource('for', undefined, undefined), '= `for`');
  // a catalog expression of only whitespace is none
  assert.equal(outputSource('client', undefined, '   '), '= client');
  // a source that is set stays exactly as it was
  assert.equal(outputSource('client', ' = result.client ', undefined), ' = result.client ');
});

test('feelRef: plain names as they are, the rest in backticks (also «+ aus Katalog»)', () => {
  assert.equal(feelRef('client'), 'client');
  assert.equal(feelRef('_x1'), '_x1');
  assert.equal(feelRef('Gebühr'), 'Gebühr');
  for (const n of ['letter-id', 'a.b', 'two words', '1st', 'for', 'null', 'item']) assert.equal(feelRef(n), `\`${n}\``, n);
  assert.ok(isPlainFeelName('Gebühr'));
  assert.ok(!isPlainFeelName('in'));
});

test('non-ASCII names convert like ASCII ones', () => {
  assert.equal(groovyToFeel('[Gebühr, Straße: 1]'), null); // a list entry and a map entry mixed
  assert.equal(groovyToFeel('[Gebühr, Straße]'), '[Gebühr, Straße]');
  assert.equal(groovyToFeel('[Straße: Gebühr]'), '{Straße: Gebühr}');
});

test('Spin and the script binding stay a script', () => {
  for (const s of ['[S]', '[JSON]', '[XML]']) assert.equal(groovyToFeel(s), null, s);
});

const bpmn = (script: string, name = 'lettersToSend', format = ' scriptFormat="groovy"') => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="d" targetNamespace="t">
  <bpmn:process id="letters" isExecutable="true">
    <bpmn:startEvent id="Start"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:serviceTask id="SendTask" name="Send" camunda:type="external" camunda:topic="send-letters">
      <bpmn:extensionElements>
        <camunda:inputOutput>
          <camunda:inputParameter name="${name}"><camunda:script${format}>${script}</camunda:script></camunda:inputParameter>
        </camunda:inputOutput>
      </bpmn:extensionElements>
      <bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing>
    </bpmn:serviceTask>
    <bpmn:endEvent id="End"><bpmn:incoming>f2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="f1" sourceRef="Start" targetRef="SendTask" />
    <bpmn:sequenceFlow id="f2" sourceRef="SendTask" targetRef="End" />
  </bpmn:process>
</bpmn:definitions>`;

const row = (xml: string) => {
  const spec = importBpmn(xml, 'letters').spec;
  return { spec, step: allSteps(spec.steps).find(s => s.id === 'SendTask')! };
};

test('import: a Groovy list is FEEL, a real script stays described', () => {
  assert.equal(row(bpmn('[fileIdLetter, docLink]')).step.inputs?.[0].expression, '= [fileIdLetter, docLink]');
  assert.equal(row(bpmn('[fileIdLetter, docLink].findAll { it }')).step.inputs?.[0].expression, '«groovy» [fileIdLetter, docLink].findAll { it }');
});

test('C7 export: the unchanged list stays the script it was', () => {
  const xml = bpmn('[fileIdLetter, docLink]');
  const { spec } = row(xml);
  const out = writeBpmn(xml, spec).xml;
  assert.ok(out.includes('<camunda:script scriptFormat="groovy">[fileIdLetter, docLink]</camunda:script>'), out);
});

test('import: the script format decides, and a FEEL line from the export wins', () => {
  const expr = (xml: string) => row(xml).step.inputs?.[0].expression;
  // the format in any case
  assert.equal(expr(bpmn('[a, b]', 'x', ' scriptFormat="Groovy"')), '= [a, b]');
  // without a format or another language: no Groovy, stays described
  assert.equal(expr(bpmn('[a, b]', 'x', '')), '«script» [a, b]');
  assert.equal(expr(bpmn('[a, b]', 'x', ' scriptFormat="javascript"')), '«javascript» [a, b]');
  // the script the export wrote from FEEL: its `// FEEL:` line, not the literal after it
  assert.equal(expr(bpmn('// FEEL: [a, b, c]\n[a, b]', 'x')), '= [a, b, c]');
});

test('import and C7 export of a Groovy map', () => {
  const xml = bpmn("[letter: fileIdLetter, 'doc-link': docLink]", 'letter');
  const { spec, step } = row(xml);
  assert.equal(step.inputs?.[0].expression, '= {letter: fileIdLetter, "doc-link": docLink}');
  const out = writeBpmn(xml, spec).xml;
  assert.ok(out.includes("<camunda:script scriptFormat=\"groovy\">[letter: fileIdLetter, 'doc-link': docLink]</camunda:script>"), out);
});

test('C7 export: an edited row replaces the script', () => {
  const xml = bpmn('[fileIdLetter, docLink]');
  const { spec, step } = row(xml);
  step.inputs = [{ name: 'lettersToSend', expression: '= [fileIdLetter]' }];
  const out = writeBpmn(xml, spec).xml;
  assert.ok(!out.includes('docLink'), out);
  assert.ok(out.includes('fileIdLetter'), out);
  // read back: the edited value, not the old script
  assert.equal(row(out).step.inputs?.[0].expression, '= [fileIdLetter]');
});
