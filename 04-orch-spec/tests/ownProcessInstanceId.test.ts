// The own process instance in Camunda 8 (camunda.processInstance.key, 8.10) — and signal names with an ID in them.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { allSteps, importBpmn } from '../src/bpmn';
import { exportBpmn } from '../src/exporters';
import { convertBpmn } from '../src/engineConvert';
import { feelToJuel } from '../src/feelJuel';
import { juelToFeel } from '../src/juelFeel';
import { checkFeel, processVariables } from '../src/feel';
import type { ProcessSpec } from '../src/types';
import { installXmlNamespaces } from './xmlNamespaces';

const g = globalThis as unknown as Record<string, unknown>;
g.DOMParser ??= DOMParser;
g.XMLSerializer ??= class { serializeToString(doc: { toString(): string }) { return doc.toString(); } };
installXmlNamespaces();

const PID = 'acme-demo-escalationV1';
const c7 = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="d" targetNamespace="x">
  <bpmn:process id="${PID}" isExecutable="true">
    <bpmn:startEvent id="StartEvent"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:serviceTask id="InitProcessTask" name="Init Process" camunda:type="external" camunda:topic="${PID}">
      <bpmn:extensionElements><camunda:inputOutput>
        <camunda:inputParameter name="processInstanceId">\${execution.processInstanceId}</camunda:inputParameter>
      </camunda:inputOutput></bpmn:extensionElements>
      <bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing>
    </bpmn:serviceTask>
    <bpmn:intermediateThrowEvent id="CancelEvent" name="cancel"><bpmn:incoming>f2</bpmn:incoming><bpmn:outgoing>f3</bpmn:outgoing>
      <bpmn:signalEventDefinition id="sd" signalRef="Sig"/>
    </bpmn:intermediateThrowEvent>
    <bpmn:endEvent id="EndEvent"><bpmn:incoming>f3</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="f1" sourceRef="StartEvent" targetRef="InitProcessTask"/>
    <bpmn:sequenceFlow id="f2" sourceRef="InitProcessTask" targetRef="CancelEvent"/>
    <bpmn:sequenceFlow id="f3" sourceRef="CancelEvent" targetRef="EndEvent"/>
  </bpmn:process>
  <bpmn:signal id="Sig" name="acme-cancel-\${mainProcessInstanceId}" />
</bpmn:definitions>`;

const signalName = (xml: string) => /<bpmn:signal id="Sig" name="([^"]*)"/.exec(xml)?.[1]?.replace(/&quot;|&#34;/g, '"');

test('C7 -> C8 -> C7: a signal name with an expression becomes FEEL - and back JUEL', () => {
  const c8 = convertBpmn(c7, 'c8').xml;
  assert.equal(signalName(c8), '="acme-cancel-" + string(mainProcessInstanceId)');
  // back to JUEL — equivalent to the original
  assert.equal(signalName(convertBpmn(c8, 'c7').xml), '${"acme-cancel-".concat(mainProcessInstanceId)}');
});

test('C7 -> C8: execution.processInstanceId becomes camunda.processInstance.key - there already at the InitWorker', () => {
  const c8 = importBpmn(convertBpmn(c7, 'c8').xml, 'escalation').spec;
  assert.equal(c8.engine, 'c8');
  const init = allSteps(c8.steps).find(s => s.id === 'InitProcessTask');
  assert.equal(init?.inputs?.find(m => m.name === 'processInstanceId')?.expression.replace(/^=\s*/, ''), 'string(camunda.processInstance.key)');
});

test('JUEL <-> FEEL: the own instance - execution.processInstanceId and camunda.processInstance.key', () => {
  const feel = juelToFeel('"acme-cancel-".concat(execution.processInstanceId)');
  assert.ok(feel.ok && feel.feel.includes('string(camunda.processInstance.key)'), JSON.stringify(feel));
  for (const [body, juel] of [
    ['string(camunda.processInstance.key)', 'execution.processInstanceId'],
    ['"cancel-" + string(camunda.processInstance.key)', '"cancel-".concat(execution.processInstanceId)'],
    // in a text it stays text
    ['"camunda.processInstance.key"', '"camunda.processInstance.key"'],
  ]) {
    const r = feelToJuel(body);
    assert.ok(r.ok && r.juel.includes(juel), `${body}: ${JSON.stringify(r)}`);
  }
  // a path that only ends like it, or a longer name, is another variable - not the own instance
  for (const body of ['order.camunda.processInstance.key', 'camunda.processInstance.keys']) {
    const r = feelToJuel(body);
    assert.ok(r.ok && !r.juel.includes('execution.processInstanceId'), `${body}: ${JSON.stringify(r)}`);
  }
});

test('C7 and C8: the check knows camunda.processInstance - the import of C7 writes it for execution.processInstanceId', () => {
  for (const engine of ['c7', 'c8'] as const) {
    const spec = { processId: 'p', slug: 'p', name: 'p', title: 'p', version: 1, engine, steps: [{ id: 's1', kind: 'service', name: 'S' }], types: [] } as unknown as ProcessSpec;
    const vars = processVariables(spec, null);
    for (const body of ['string(camunda.processInstance.key)', 'camunda.processInstance.businessId']) {
      assert.deepEqual(checkFeel(`= ${body}`, vars).issues, [], `${engine}: ${body}`);
    }
  }
});

test('C7 -> import -> export C7: the own instance and the business key come back as execution.*', () => {
  const xml = c7.replace('<camunda:inputParameter name="processInstanceId">',
    '<camunda:inputParameter name="ref">${execution.processBusinessKey}</camunda:inputParameter>\n        <camunda:inputParameter name="processInstanceId">');
  const spec = importBpmn(xml, 'escalation').spec;
  const init = allSteps(spec.steps).find(s => s.id === 'InitProcessTask');
  const feel = (name: string) => init?.inputs?.find(m => m.name === name)?.expression.replace(/^=\s*/, '');
  assert.equal(feel('processInstanceId'), 'string(camunda.processInstance.key)');
  assert.equal(feel('ref'), 'camunda.processInstance.businessId');
  const out = exportBpmn(spec, xml).xml;
  const juel = (name: string) => new RegExp(`<camunda:inputParameter name="${name}">([^<]*)<`).exec(out)?.[1];
  assert.equal(juel('processInstanceId'), '${execution.processInstanceId}', out);
  assert.equal(juel('ref'), '${execution.processBusinessKey}', out);
});

test('export to C7: a reason names camunda.processInstance as written - not the placeholder', () => {
  for (const body of ['items[item.x = camunda.processInstance.key]', 'items[item.x = camunda.processInstance.businessId]']) {
    const r = feelToJuel(body);
    assert.ok(!r.ok && !r.reason.includes('__own') && r.reason.includes('camunda.processInstance.'), `${body}: ${JSON.stringify(r)}`);
  }
});
