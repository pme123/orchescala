// JUEL the import cannot translate: the UI says why — not just that.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from 'linkedom';
import { convertBpmn } from '../src/engineConvert.ts';
import { importExpression, juelImportReason } from '../src/juelFeel.ts';
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

test('getVariable with a computed name stays JUEL — with the reason', () => {
  const juel = '${execution.getVariable("fileLink".concat(loopCounter))}';
  assert.equal(importExpression(juel), juel);
  const reason = juelImportReason(juel);
  assert.ok(reason?.includes('berechnetem Namen'), reason ?? 'no reason');
  assert.ok(reason?.includes('"fileLink" + string(loopCounter)'), reason ?? 'no reason');
  assert.ok(reason?.includes('«= fileLinks[loopCounter]»'), reason ?? 'no reason');
});

test('no reason for translatable JUEL, FEEL or fixed text', () => {
  assert.equal(juelImportReason('${a.concat(b)}'), null);
  assert.equal(juelImportReason('= a + b'), null);
  assert.equal(juelImportReason('fest'), null);
});

test('reason points to «Ergebnisse sammeln» in Camunda 8', () => {
  const reason = juelImportReason('${execution.getVariable("fileLink".concat(loopCounter))}');
  assert.ok(reason?.includes('«Ergebnisse sammeln»'), reason ?? 'no reason');
});

test('C7 -> C8: the conversion reports the reason', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="d" targetNamespace="x">
  <bpmn:process id="acme-demo-filesV1" isExecutable="true">
    <bpmn:serviceTask id="Load" name="Load" camunda:type="external" camunda:topic="load">
      <bpmn:extensionElements><camunda:inputOutput>
        <camunda:inputParameter name="fileLink">\${execution.getVariable("fileLink".concat(loopCounter))}</camunda:inputParameter>
      </camunda:inputOutput></bpmn:extensionElements>
      <bpmn:multiInstanceLoopCharacteristics camunda:collection="\${files}" camunda:elementVariable="file" />
    </bpmn:serviceTask>
  </bpmn:process>
</bpmn:definitions>`;
  const conv = convertBpmn(xml, 'c8');
  const issue = conv.issues.find(i => i.text.includes('getVariable'));
  assert.ok(issue, JSON.stringify(conv.issues));
  assert.ok(issue.text.includes('«Ergebnisse sammeln»'), issue.text);
  assert.ok(issue.text.includes('Von Hand anpassen.'), issue.text);
});
