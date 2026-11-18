// A Groovy script that is only a literal (`[fileIdLetter, docLink]`) reads the same
// in FEEL — the import takes it as `= […]` instead of a script to rewrite.
// The Camunda 7 export keeps the script as long as the row is unchanged.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { allSteps, importBpmn } from '../src/bpmn';
import { writeBpmn } from '../src/bpmnWrite';
import { groovyToFeel, importExpression, jsonToFeel, outputSource } from '../src/juelFeel';
import { feelRef, isPlainFeelName } from '../src/feelNames';
import { checkFeel, type VarNode } from '../src/feel';
import { stepFindings } from '../src/findings';
import { feelToGroovy, feelToJuel } from '../src/feelJuel';

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
    // a list entry and a map entry mixed
    '[a, b: 1]', '[b: 1, a]',
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
  assert.equal(groovyToFeel('[gebühr, straße]'), '[gebühr, straße]');
  // a key is a text in Groovy — capitalised as well
  assert.equal(groovyToFeel('[Straße: gebühr]'), '{Straße: gebühr}');
});

test('line breaks and tabs in a text are escaped in FEEL', () => {
  assert.equal(groovyToFeel("['a\\nb', \"c\\td\", 'e\\\\f', 'say \"hi\"']"), '["a\\nb", "c\\td", "e\\\\f", "say \\"hi\\""]');
});

test('nesting deeper than 50 stays a script', () => {
  assert.equal(groovyToFeel(`${'['.repeat(50)}a${']'.repeat(50)}`), `${'['.repeat(50)}a${']'.repeat(50)}`);
  assert.equal(groovyToFeel(`${'['.repeat(51)}a${']'.repeat(51)}`), null);
  // no stack overflow on a hostile file
  assert.equal(groovyToFeel('['.repeat(100000)), null);
  // many empty siblings are not deep: the count goes back down after each one
  for (const empty of ['[]', '[:]']) {
    const many = `[${Array(200).fill(empty).join(', ')}]`;
    assert.equal(groovyToFeel(many), `[${Array(200).fill(empty === '[]' ? '[]' : '{}').join(', ')}]`, empty);
  }
});

test('the bindings of a Camunda 7 script stay a script', () => {
  for (const s of ['[externalTask]', '[caseExecution]', '[connector]', '[authenticatedUserId]', '[variableScope]', '[binding]', '[out]', '[log]']) assert.equal(groovyToFeel(s), null, s);
});

test('a capitalised name stays a script — it may be a class (Math, Random, S)', () => {
  for (const s of ['[Math]', 'System', '[Collections]', '[a: Integer]', '[UUID]', '[Random]', '[Expando]', '[S]', '[Gebühr]']) {
    assert.equal(groovyToFeel(s), null, s);
  }
});

test('the empty map with spaces', () => {
  for (const s of ['[ : ]', '[:\n]', '[\n:\n]']) assert.equal(groovyToFeel(s), '{}', JSON.stringify(s));
  assert.equal(groovyToFeel('[: a]'), null);
});

test('control characters other than line breaks and tabs stay raw — FEEL reads them, its \\u escape is greedy', () => {
  // Groovy `\b` / `\f` (backspace, form feed): the character itself in the FEEL text
  assert.equal(groovyToFeel("['a\\bb', 'c\\fd']"), '["a\bb", "c\fd"]');
});

test('a long flat list is read', () => {
  // tokens are matched at the cursor (sticky regexes), not on a copy of the rest
  const list = `[${Array.from({ length: 50000 }, (_, k) => `v${k}`).join(', ')}]`;
  assert.equal(groovyToFeel(list), list);
});

test('Groovy keywords as a variable stay a script', () => {
  for (const s of ['def', '[new]', '[class]', '[a: as]', '[instanceof]', '[while]', '[assert]', '[import]']) assert.equal(groovyToFeel(s), null, s);
});

test('JSON values: a line break in a text is escaped as well', () => {
  assert.equal(jsonToFeel({ text: 'a\nb', list: ['c\td'] }), '{text: "a\\nb", list: ["c\\td"]}');
});

test('backtick names: the FEEL check reads them as variables', () => {
  const vars = [{ name: 'letter-id', type: 'string' }, { name: 'for', type: 'string' }] as VarNode[];
  assert.deepEqual(checkFeel(`= ${feelRef('letter-id')}`, vars, null).issues, []);
  assert.deepEqual(checkFeel(`= ${feelRef('for')}`, vars, null).issues, []);
  // an unknown one is reported by its name, without the backticks
  assert.ok(checkFeel(`= ${feelRef('other-id')}`, vars, null).issues.some(i => i.text.includes('Variable «other-id» ist nicht bekannt')));
});

test('the Spin names stay a script', () => {
  for (const s of ['[S]', '[JSON]', '[XML]']) assert.equal(groovyToFeel(s), null, s);
});

const bpmn = (script: string, name = 'lettersToSend', format = ' scriptFormat="groovy"', param = 'inputParameter') => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="d" targetNamespace="t">
  <bpmn:process id="letters" isExecutable="true">
    <bpmn:startEvent id="Start"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:serviceTask id="SendTask" name="Send" camunda:type="external" camunda:topic="send-letters">
      <bpmn:extensionElements>
        <camunda:inputOutput>
          <camunda:${param} name="${name}"><camunda:script${format}>${script}</camunda:script></camunda:${param}>
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

test('C7 export: every unchanged literal stays the script it was', () => {
  for (const script of ['return [a];', "['x', \"y\"]", '[a: \'Gebühr\']', '// FEEL: [a, b, c]\n[a, b]']) {
    const xml = bpmn(script);
    const { spec } = row(xml);
    const out = writeBpmn(xml, spec).xml.replace(/&quot;/g, '"').replace(/&apos;/g, "'");
    assert.ok(out.includes(`<camunda:script scriptFormat="groovy">${script}</camunda:script>`), `${script}\n${out}`);
  }
});

test('an unknown variable in the list is a finding of the step (Groovy fails there, FEEL gives null)', () => {
  const { spec, step } = row(bpmn('[fileIdLetter, docLink]'));
  const errors = stepFindings(step, spec, null, [{ name: 'fileIdLetter', type: 'string' } as VarNode]).errors;
  assert.ok(errors.some(e => e.startsWith('«lettersToSend»') && e.includes('Variable «docLink» ist nicht bekannt')), errors.join('\n'));
  // the known one is fine
  assert.ok(!errors.some(e => e.includes('Variable «fileIdLetter» ist nicht bekannt')), errors.join('\n'));
});

test('an output row: the literal is FEEL too, and stays the script on C7 export', () => {
  const xml = bpmn('[fileIdLetter, docLink]', 'letters', ' scriptFormat="groovy"', 'outputParameter');
  const { spec, step } = row(xml);
  assert.equal(step.outputs?.[0].expression, '= [fileIdLetter, docLink]');
  assert.ok(writeBpmn(xml, spec).xml.includes('<camunda:outputParameter name="letters"><camunda:script scriptFormat="groovy">[fileIdLetter, docLink]</camunda:script></camunda:outputParameter>'));
});

test('backtick names on the way to Camunda 7', () => {
  // JUEL: read from the execution — `letter-id` is no JUEL name; as a bare `source` the name itself
  assert.deepEqual(feelToJuel('`letter-id`'), { ok: true, juel: 'execution.getVariable("letter-id")', plain: 'letter-id' });
  assert.equal((feelToJuel('`letter-id`.zip') as { juel: string }).juel, 'execution.getVariable("letter-id").prop("zip")');
  // comparison, condition, function, guarded path: all read from the execution
  assert.equal((feelToJuel('`letter-id` = null') as { juel: string }).juel, 'execution.getVariable("letter-id") == null');
  assert.equal((feelToJuel('if `letter-id` then 1 else 2') as { juel: string }).juel, '(execution.getVariable("letter-id") ? 1 : 2)');
  assert.equal((feelToJuel('count(`letter-id`)') as { juel: string }).juel, 'execution.getVariable("letter-id").size()');
  assert.ok(!JSON.stringify(feelToJuel('`letter-id`.a.b', { target: { type: 'string', optional: true } })).includes('__bq'));
  // an optional variable in backticks gets the same checks as a plain one
  const optional = (body: string, name: string) =>
    (feelToJuel(body, { optional: new Set([name]), target: { type: 'string', optional: true } }) as { juel: string }).juel;
  assert.equal(optional('`letter-id`.a', 'letter-id'), optional('letterId.a', 'letterId').replaceAll('letterId', 'letter-id'));
  assert.ok(optional('`letter-id`.a', 'letter-id').startsWith('(execution.getVariable("letter-id") != null && '));
  // a name with a space, in backticks
  assert.equal((feelToJuel('`a b` = "x"') as { juel: string }).juel, 'execution.getVariable("a b") == "x"');
  // a variable called like the placeholder does not collide
  assert.equal((feelToJuel('`letter-id` + __bqName0') as { juel: string }).juel, 'execution.getVariable("letter-id") + __bqName0');
  // a backtick inside a text stays text
  assert.equal((feelToJuel('"`x`"') as { juel: string }).juel, '"`x`"');
  // the JSON script reads it with `v`, its FEEL line keeps the backticks
  const g = feelToGroovy('[`letter-id`, a]') as { script: string };
  assert.ok(g.script.startsWith('// FEEL: [`letter-id`, a]'), g.script);
  assert.ok(g.script.endsWith("toJson([v('letter-id'), v('a')]))"), g.script);
});

test('import: execution.getVariable with a name FEEL does not read as it is', () => {
  assert.equal(importExpression('${execution.getVariable("letter-id")}'), '= `letter-id`');
  assert.equal(importExpression('${execution.getVariable("a b")}'), '= `a b`');
  // a computed name has no FEEL counterpart: stays JUEL
  assert.ok(importExpression('${execution.getVariable("file".concat(loopCounter))}').startsWith('${'));
});

test('C7 export: an output with a backtick name', () => {
  const xml = bpmn('[fileIdLetter, docLink]');
  const { spec, step } = row(xml);
  step.outputs = [{ name: 'letterId', expression: `= ${feelRef('letter-id')}` }];
  const out = writeBpmn(xml, spec).xml.replace(/&quot;/g, '"');
  assert.ok(out.includes('<camunda:outputParameter name="letterId">${execution.getVariable("letter-id")}</camunda:outputParameter>'), out);
  // and read back as written — also a name with a space
  assert.equal(row(writeBpmn(xml, spec).xml).step.outputs?.[0].expression, '= `letter-id`');
  step.outputs = [{ name: 'letterId', expression: '= `letter id`' }];
  assert.equal(row(writeBpmn(xml, spec).xml).step.outputs?.[0].expression, '= `letter id`');
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
