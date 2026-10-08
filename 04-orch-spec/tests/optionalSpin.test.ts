// Camunda 7: ein Pfad in JSON (Spin) wirft bei `prop("x")`, wenn das Feld fehlt
// («SPIN/JACKSON-JSON-01004 Unable to find 'x'»). Ein optionales Feld wird darum
// erst geprüft (`hasProp`, `isNull`) — wie `execution.getVariable` bei einer
// optionalen Variable. Und das Element einer Mehrfachausführung kennt beim Export
// die Felder seiner Sammlung — sonst endete der Pfad ohne `boolValue()`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { allSteps, importBpmn } from '../src/bpmn';
import { writeBpmn } from '../src/bpmnWrite';
import { feelToJuel } from '../src/feelJuel';
import { importExpression } from '../src/juelFeel';
import type { VarNode } from '../src/feel';

(globalThis as unknown as { DOMParser: unknown }).DOMParser = DOMParser;
// linkedom hat keinen XMLSerializer — `toString()` liefert das XML
(globalThis as unknown as { XMLSerializer: unknown }).XMLSerializer = class { serializeToString(n: Node) { return String(n); } };

const card: VarNode = {
  name: 'card', type: 'context', label: 'DebitMastercard', source: 'In',
  children: [
    { name: 'newModuleDebitInsurance', type: 'boolean', label: 'Option[Boolean]', source: 'In', optional: true },
    { name: 'clientKey', type: 'number', label: 'Long', source: 'In' },
  ],
};

test('an optional field is checked before it is read', () => {
  assert.deepEqual(feelToJuel('card.newModuleDebitInsurance', { vars: [card] }), {
    ok: true,
    juel: '(card.hasProp("newModuleDebitInsurance") && !card.prop("newModuleDebitInsurance").isNull() ? card.prop("newModuleDebitInsurance").boolValue() : null)',
    plain: '(card.hasProp("newModuleDebitInsurance") && !card.prop("newModuleDebitInsurance").isNull() ? card.prop("newModuleDebitInsurance").boolValue() : null)',
  });
  // ein Pflichtfeld wird gelesen wie bisher
  assert.equal((feelToJuel('card.clientKey', { vars: [card] }) as { juel: string }).juel, 'card.prop("clientKey").numberValue()');
  // eine optionale Variable am Anfang: erst `execution.getVariable`
  assert.equal((feelToJuel('card.clientKey', { vars: [{ ...card, optional: true }], optional: new Set(['card']) }) as { juel: string }).juel,
    '(execution.getVariable("card") != null ? execution.getVariable("card").prop("clientKey").numberValue() : null)');
});

const bpmn = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="d" targetNamespace="x">
  <bpmn:process id="acme-demo-cardsV1" isExecutable="true">
    <bpmn:startEvent id="StartEvent"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:callActivity id="OrderCardCallActivity" name="Order Card" calledElement="acme-demo-orderCard">
      <bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing>
      <bpmn:multiInstanceLoopCharacteristics camunda:collection="\${newDebitMastercards.elements()}" camunda:elementVariable="newDebitMastercard" />
    </bpmn:callActivity>
    <bpmn:endEvent id="EndEvent"><bpmn:incoming>f2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="f1" sourceRef="StartEvent" targetRef="OrderCardCallActivity"/>
    <bpmn:sequenceFlow id="f2" sourceRef="OrderCardCallActivity" targetRef="EndEvent"/>
  </bpmn:process>
</bpmn:definitions>`;

test('export: the element of a multi-instance knows the fields of its collection', () => {
  const spec = importBpmn(bpmn, 'cards').spec;
  spec.types = [
    { id: 't-in', name: 'In', kind: 'case', root: true, fields: [{ id: 'f1', name: 'newDebitMastercards', type: 't-card', collection: true }] },
    { id: 't-card', name: 'DebitMastercard', kind: 'case', fields: [{ id: 'f2', name: 'newModuleDebitInsurance', type: 'Boolean', optional: true }] },
  ] as typeof spec.types;
  const step = allSteps(spec.steps).find(s => s.id === 'OrderCardCallActivity')!;
  assert.equal(step.multiInstance?.element, 'newDebitMastercard');
  step.inputs = [{ name: 'newModuleDebitInsurance', expression: '= newDebitMastercard.newModuleDebitInsurance' }];
  const xml = writeBpmn(bpmn, spec).xml;
  assert.ok(xml.includes('newDebitMastercard.prop(&quot;newModuleDebitInsurance&quot;).boolValue()') || xml.includes('newDebitMastercard.prop("newModuleDebitInsurance").boolValue()'), xml);
  assert.ok(xml.includes('newDebitMastercard.hasProp('), xml);
});

test('import: the guard reads back as an explicit if — like a hand-written one', () => {
  assert.equal(importExpression('${(card.hasProp("newModuleDebitInsurance") && !card.prop("newModuleDebitInsurance").isNull() ? card.prop("newModuleDebitInsurance").boolValue() : null)}'),
    '= if card.newModuleDebitInsurance != null then card.newModuleDebitInsurance else null');
});
