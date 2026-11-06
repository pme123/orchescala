// JUEL the import cannot translate: the UI says why — not just that.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from 'linkedom';
import { convertBpmn } from '../src/engineConvert.ts';
import { importExpression, juelImportReason, untranslatableText } from '../src/juelFeel.ts';
import { installXmlNamespaces } from './xmlNamespaces';

const g = globalThis as unknown as Record<string, unknown>;
g.DOMParser ??= DOMParser;
g.XMLSerializer ??= class { serializeToString(doc: { toString(): string }) { return doc.toString(); } };
installXmlNamespaces();

test('concat is string concatenation', () => {
  assert.equal(importExpression('${"fileLink".concat(loopCounter)}'), '= "fileLink" + string(loopCounter)');
});

test('getVariable with a fixed name is the variable', () => {
  assert.equal(importExpression('${execution.getVariable("fileLink")}'), '= fileLink');
});

const COMPUTED = '${execution.getVariable("fileLink".concat(loopCounter))}';
const COMPUTED_REASON = 'getVariable mit berechnetem Namen ("fileLink" + string(loopCounter)) — FEEL kennt keine Variable, deren Name erst zur Laufzeit entsteht. '
  + 'Falls das eine Mehrfachausführung ist: in Camunda 8 braucht es die Variable je Durchlauf nicht, «Ergebnisse sammeln» legt die Ergebnisse in eine Liste, dann z. B. «= fileLinks[loopCounter]»';

test('getVariable with a computed name stays JUEL — with the reason and a list example', () => {
  assert.equal(importExpression(COMPUTED), COMPUTED);
  assert.equal(juelImportReason(COMPUTED), COMPUTED_REASON);
});

test('getVariable with another computed name: the general example', () => {
  const reason = juelImportReason('${execution.getVariable("file".concat(i + 1))}');
  assert.ok(reason?.endsWith('«= liste[index]»'), reason ?? 'no reason');
  // an index other than loopCounter: no guessed list either
  const other = juelImportReason('${execution.getVariable("file".concat(nr))}');
  assert.ok(other?.endsWith('«= liste[index]»'), other ?? 'no reason');
});

test('unclosed ${ and a later part that fails have a reason', () => {
  assert.equal(juelImportReason('Hallo ${name'), '«${» nicht geschlossen');
  assert.equal(juelImportReason('${a} und ${foo.bar()}'), 'Methode «bar()» hat kein FEEL-Gegenstück');
});

test('no reason for translatable JUEL, FEEL or fixed text', () => {
  assert.equal(juelImportReason('${a.concat(b)}'), null);
  assert.equal(juelImportReason('= a + b'), null);
  assert.equal(juelImportReason('fest'), null);
});

test('message: the reason as its own sentence, without double punctuation', () => {
  assert.equal(untranslatableText(COMPUTED, 'JUEL,', 'als «= …» schreiben.'),
    `JUEL, nicht nach FEEL übersetzbar: ${COMPUTED_REASON}. Als «= …» schreiben.`);
  assert.equal(untranslatableText('${foo.bar()}', 'JUEL,', 'als «= …» schreiben.'),
    'JUEL, nicht nach FEEL übersetzbar: Methode «bar()» hat kein FEEL-Gegenstück. Als «= …» schreiben.');
  assert.ok(!untranslatableText(COMPUTED, 'JUEL,', 'x').includes('..'));
  // no reason (fixed text): the short form
  assert.equal(untranslatableText('fest', 'JUEL,', 'als «= …» schreiben.'), 'JUEL, nicht nach FEEL übersetzbar — als «= …» schreiben.');
});

test('C7 -> C8: the conversion reports the reason', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="d" targetNamespace="x">
  <bpmn:process id="acme-demo-filesV1" isExecutable="true">
    <bpmn:serviceTask id="Load" name="Load" camunda:type="external" camunda:topic="load">
      <bpmn:extensionElements><camunda:inputOutput>
        <camunda:inputParameter name="fileLink">${COMPUTED}</camunda:inputParameter>
      </camunda:inputOutput></bpmn:extensionElements>
      <bpmn:multiInstanceLoopCharacteristics camunda:collection="\${files}" camunda:elementVariable="file" />
    </bpmn:serviceTask>
  </bpmn:process>
</bpmn:definitions>`;
  const conv = convertBpmn(xml, 'c8');
  const issue = conv.issues.find(i => i.text.includes('getVariable'));
  assert.ok(issue, JSON.stringify(conv.issues));
  assert.equal(issue.text, `«${COMPUTED}» ist nicht nach FEEL übersetzbar: ${COMPUTED_REASON}. Von Hand anpassen.`);
});
