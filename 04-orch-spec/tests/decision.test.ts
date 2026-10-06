// Eine DMN Decision im Ablauf: sie liest ihr `In` direkt aus den Prozessvariablen
// und schreibt ihr Ergebnis in **eine** Variable (`resultVariable`) — ohne Mapping.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { allSteps, importBpmn } from '../src/bpmn';
import { collectFindings, missingRequiredInputs } from '../src/findings';
import { processVariables } from '../src/feel';
import type { DecisionResult, ProcessSpec, Step } from '../src/types';

(globalThis as unknown as { DOMParser: unknown }).DOMParser = DOMParser;

const PID = 'acme-demo-checkV1';

/** Start → Entscheidung (resultVariable `rules`) → «ok?» → Ende */
const bpmn = (condition: string) => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" id="d" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="${PID}" name="${PID}" isExecutable="true">
    <bpmn:startEvent id="StartEvent"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:businessRuleTask id="RulesTask" name="Regeln" camunda:decisionRef="${PID}-Rules" camunda:resultVariable="rules" camunda:mapDecisionResult="singleResult">
      <bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing>
    </bpmn:businessRuleTask>
    <bpmn:exclusiveGateway id="OkGateway" name="ok?" default="NoFlow">
      <bpmn:incoming>f2</bpmn:incoming><bpmn:outgoing>YesFlow</bpmn:outgoing><bpmn:outgoing>NoFlow</bpmn:outgoing>
    </bpmn:exclusiveGateway>
    <bpmn:endEvent id="YesEnd"><bpmn:incoming>YesFlow</bpmn:incoming></bpmn:endEvent>
    <bpmn:endEvent id="NoEnd"><bpmn:incoming>NoFlow</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="f1" sourceRef="StartEvent" targetRef="RulesTask" />
    <bpmn:sequenceFlow id="f2" sourceRef="RulesTask" targetRef="OkGateway" />
    <bpmn:sequenceFlow id="YesFlow" name="ja" sourceRef="OkGateway" targetRef="YesEnd">
      <bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">${condition}</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="NoFlow" name="nein" sourceRef="OkGateway" targetRef="NoEnd" />
  </bpmn:process>
</bpmn:definitions>`;

/** Die Spezifikation mit der Decision als Interaktion: In `topic`, Out `ok` (und `limit`). */
function spec(condition = '${rules.ok}', form: DecisionResult = 'singleResult', outFields = ['ok', 'limit']): ProcessSpec {
  const s = importBpmn(bpmn(condition), 'check.bpmn').spec;
  const types = [
    { id: 't-in', name: 'In', kind: 'case' as const, interactionId: 'ia-rules', fields: [{ id: 'f-topic', name: 'topic', type: 'String' }] },
    {
      id: 't-out', name: 'Out', kind: 'case' as const, interactionId: 'ia-rules',
      fields: outFields.map(n => ({ id: `f-${n}`, name: n, type: n === 'ok' ? 'Boolean' : 'Int' })),
    },
  ];
  const interactions = [{
    id: 'ia-rules', stepId: 'RulesTask', kind: 'decision' as const, name: 'RulesDmn', key: `${PID}-Rules`,
    inTypeId: 't-in', outTypeId: 't-out', decisionResult: form,
  }];
  return { ...s, types: [...(s.types ?? []), ...types], interactions };
}

const step = (s: ProcessSpec, id: string): Step => allSteps(s.steps).find(x => x.id === id)!;

const messages = (s: ProcessSpec): string[] =>
  [...collectFindings(s, null, allSteps(s.steps)).values()].flatMap(f => [...f.errors, ...f.warnings]);

test('a decision reads its In directly - no «Pflichtfeld fehlt» without input mapping', () => {
  const s = spec();
  assert.deepEqual(missingRequiredInputs(step(s, 'RulesTask'), s, null), []);
  assert.deepEqual(messages(s).filter(m => m.includes('Pflichtfeld')), []);
});

test('a gateway after the decision knows its resultVariable', () => {
  assert.deepEqual(messages(spec('${rules.ok}')), []);
});

test('a wrong field of the resultVariable is reported', () => {
  const found = messages(spec('${rules.okk}'));
  assert.ok(found.some(m => m.includes('okk')), found.join(' / '));
});

test('the resultVariable has the shape of the result form', () => {
  const rules = (form: DecisionResult, outFields?: string[]) =>
    processVariables(spec('${rules.ok}', form, outFields), null).find(v => v.name === 'rules');
  // ein Objekt mit den Feldern des Out
  assert.deepEqual(rules('singleResult')?.children?.map(c => c.name), ['ok', 'limit']);
  // eine Liste davon
  const list = rules('resultList');
  assert.equal(list?.type, 'list');
  assert.deepEqual(list?.children?.map(c => c.name), ['ok', 'limit']);
  // ein einfacher Wert: das eine Feld des Out
  const entry = rules('singleEntry', ['ok']);
  assert.ok(entry && !['any', 'list', 'context'].includes(entry.type), `singleEntry: ${entry?.type}`);
  assert.equal(entry?.children, undefined);
  // eine Liste einfacher Werte
  assert.equal(rules('collectEntries', ['ok'])?.type, 'list');
});

test('Camunda 8 with output mappings: the resultVariable stays local to the task', () => {
  const s = spec();
  const c8 = (outputs: Step['outputs']): ProcessSpec => ({
    ...s,
    engine: 'c8',
    steps: s.steps.map(x => (x.id === 'RulesTask' ? { ...x, outputs } : x)),
  });
  const names = (p: ProcessSpec) => processVariables(p, null).map(v => v.name);
  assert.ok(names(c8([])).includes('rules'), 'without output mappings Zeebe keeps the resultVariable');
  const mapped = names(c8([{ name: 'ok', expression: '= rules.ok' }]));
  assert.ok(!mapped.includes('rules'), 'with output mappings only the mapped variables are propagated');
  assert.ok(mapped.includes('ok'));
});
