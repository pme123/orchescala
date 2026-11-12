// The business key in Camunda 8 (from 8.10): the business id of the instance - inherited by a
// call activity, overridden with zeebe:calledElement businessId; there is no variable businessKey.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { allSteps, importBpmn } from '../src/bpmn';
import { writeBpmn } from '../src/bpmnWrite';
import { convertBpmn } from '../src/engineConvert';
import { checkFeel, processVariables } from '../src/feel';
import { feelToJuel } from '../src/feelJuel';
import { juelToFeel } from '../src/juelFeel';
import type { ProcessSpec, Step } from '../src/types';
import { installXmlNamespaces } from './xmlNamespaces';

const g = globalThis as unknown as Record<string, unknown>;
g.DOMParser ??= DOMParser;
g.XMLSerializer ??= class { serializeToString(doc: { toString(): string }) { return doc.toString(); } };
installXmlNamespaces();

const flow = (call: string, ns: string, extra = '') => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" ${ns} id="d" targetNamespace="x">
  <bpmn:process id="acme-demo-parentV1" isExecutable="true">
    <bpmn:startEvent id="StartEvent"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    ${call}
    <bpmn:endEvent id="EndEvent"><bpmn:incoming>f2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="f1" sourceRef="StartEvent" targetRef="CallTask"/>
    <bpmn:sequenceFlow id="f2" sourceRef="CallTask" targetRef="EndEvent"/>
    ${extra}
  </bpmn:process>
</bpmn:definitions>`;
const C8 = 'xmlns:zeebe="http://camunda.org/schema/zeebe/1.0" xmlns:modeler="http://camunda.org/schema/modeler/1.0" modeler:executionPlatform="Camunda Cloud"';
const C7 = 'xmlns:camunda="http://camunda.org/schema/1.0/bpmn"';
const c8Call = (ext: string, called = '<zeebe:calledElement processId="acme-demo-childV1" propagateAllChildVariables="false" propagateAllParentVariables="false" />') =>
  flow(`<bpmn:callActivity id="CallTask" name="Call"><bpmn:extensionElements>${called}${ext}</bpmn:extensionElements><bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing></bpmn:callActivity>`, C8);
const c7Call = (ext: string) =>
  flow(`<bpmn:callActivity id="CallTask" name="Call" calledElement="acme-demo-childV1"><bpmn:extensionElements>${ext}</bpmn:extensionElements><bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing></bpmn:callActivity>`, C7);
const call = (spec: ProcessSpec): Step => allSteps(spec.steps).find(s => s.id === 'CallTask')!;
const withInputs = (spec: ProcessSpec, inputs: Step['inputs']): ProcessSpec =>
  ({ ...spec, steps: spec.steps.map(s => (s.id === 'CallTask' ? { ...s, inputs } : s)) });
const businessIdOf = (xml: string) => /businessId="([^"]*)"/.exec(xml)?.[1];
const businessKeyInput = (xml: string) => /<zeebe:input[^>]*target="businessKey"/.test(xml);
/** source of the zeebe:input of that target - whatever the order of the attributes */
const inputSource = (xml: string, target: string) => {
  const el = new RegExp(`<zeebe:input[^>]*target="${target}"[^>]*>`).exec(xml.replace(/&quot;|&#34;/g, "'"))?.[0];
  return el ? /source="([^"]*)"/.exec(el)?.[1]?.replace(/'/g, '"') : undefined;
};

test('export C8: a call activity gets no input businessKey - the child inherits the business id', () => {
  const xml = c8Call('');
  const out = writeBpmn(xml, importBpmn(xml, 'parent').spec).xml;
  assert.ok(!businessKeyInput(out), out);
  assert.equal(businessIdOf(out), undefined);
});

test('export C8: a row businessKey on the call becomes the override zeebe:calledElement businessId - the other rows stay inputs', () => {
  const xml = c8Call('');
  const row = writeBpmn(xml, withInputs(importBpmn(xml, 'parent').spec, [
    { name: 'businessKey', expression: '= "order-" + orderId' },
    { name: 'clientKey', expression: '= clientKey' },
  ])).xml;
  assert.equal(businessIdOf(row)?.replace(/&quot;|&#34;/g, '"'), '="order-" + orderId');
  assert.ok(!businessKeyInput(row), row);
  assert.equal(inputSource(row, 'clientKey'), '=clientKey');
});

test('import C8: zeebe:calledElement businessId belongs to the call - no mapping row, and it stays on export', () => {
  const xml = c8Call('', '<zeebe:calledElement processId="acme-demo-childV1" businessId="=order.id" propagateAllChildVariables="false" propagateAllParentVariables="false" />');
  const spec = importBpmn(xml, 'parent').spec;
  assert.equal(call(spec).inputs, undefined);
  assert.equal(businessIdOf(writeBpmn(xml, spec).xml), '=order.id');
});

test('export C7: the call activity still passes camunda:in businessKey', () => {
  const xml = c7Call('');
  const out = writeBpmn(xml, importBpmn(xml, 'parent').spec).xml;
  assert.ok(out.includes('businessKey="#{execution.processBusinessKey}"'), out);
});

test('C7 -> C8: the default business key is inherited - no input, no businessId', () => {
  for (const expr of ['#{execution.processBusinessKey}', '${execution.processBusinessKey}']) {
    const conv = convertBpmn(c7Call(`<camunda:in businessKey="${expr}" /><camunda:in source="clientKey" target="clientKey" />`), 'c8');
    assert.ok(!businessKeyInput(conv.xml), conv.xml);
    assert.equal(businessIdOf(conv.xml), undefined, expr);
    assert.equal(inputSource(conv.xml, 'clientKey'), '=clientKey');
    assert.deepEqual(conv.issues.filter(i => i.where === 'Business Key'), []);
  }
  // without any camunda:in businessKey neither
  const none = convertBpmn(c7Call('<camunda:in source="clientKey" target="clientKey" />'), 'c8').xml;
  assert.ok(!businessKeyInput(none) && businessIdOf(none) === undefined, none);
});

test('C7 -> C8: another business key becomes zeebe:calledElement businessId - in FEEL', () => {
  const conv = convertBpmn(c7Call('<camunda:in businessKey="${execution.getVariable(&quot;orderId&quot;)}" />'), 'c8');
  assert.equal(businessIdOf(conv.xml), '=orderId');
  assert.ok(!businessKeyInput(conv.xml), conv.xml);
  // a fixed text stays a fixed text
  assert.equal(businessIdOf(convertBpmn(c7Call('<camunda:in businessKey="fixed-key" />'), 'c8').xml), 'fixed-key');
  // what cannot be translated is reported - and the child inherits instead of getting the JUEL as text
  const bad = convertBpmn(c7Call('<camunda:in businessKey="${someBean.compute(execution)}" />'), 'c8');
  assert.equal(businessIdOf(bad.xml), undefined);
  assert.ok(bad.issues.some(i => i.where === 'Business Key'), JSON.stringify(bad.issues));
});

test('C7 -> C8: execution.processBusinessKey becomes camunda.processInstance.businessId - not in text, not as a field', () => {
  const xml = flow(`<bpmn:serviceTask id="CallTask" name="Work" camunda:type="external" camunda:topic="acme-work"><bpmn:extensionElements><camunda:inputOutput>
    <camunda:inputParameter name="key">\${execution.processBusinessKey}</camunda:inputParameter>
    <camunda:inputParameter name="label">\${"businessKey: ".concat(execution.getBusinessKey())}</camunda:inputParameter>
    <camunda:inputParameter name="other">\${order.businessKey}</camunda:inputParameter>
  </camunda:inputOutput></bpmn:extensionElements><bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing></bpmn:serviceTask>`, C7);
  const out = convertBpmn(xml, 'c8').xml;
  assert.equal(inputSource(out, 'key'), '=camunda.processInstance.businessId');
  assert.equal(inputSource(out, 'label'), '="businessKey: " + string(camunda.processInstance.businessId)');
  assert.equal(inputSource(out, 'other'), '=order.businessKey');
});

test('C8 -> C7: zeebe:calledElement businessId becomes camunda:in businessKey - otherwise the default', () => {
  const own = convertBpmn(c8Call('', '<zeebe:calledElement processId="acme-demo-childV1" businessId="=orderId" propagateAllChildVariables="false" propagateAllParentVariables="false" />'), 'c7');
  assert.ok(own.xml.includes('businessKey="${orderId}"'), own.xml);
  assert.ok(!own.xml.includes('execution.processBusinessKey'), own.xml);
  // the business id of the instance itself, or nothing: the default
  for (const xml of [
    c8Call(''),
    c8Call('', '<zeebe:calledElement processId="acme-demo-childV1" businessId="=camunda.processInstance.businessId" propagateAllChildVariables="false" propagateAllParentVariables="false" />'),
  ]) {
    const out = convertBpmn(xml, 'c7').xml;
    assert.equal(out.match(/camunda:in businessKey="([^"]*)"/)?.[1].replace(/^[$#]\{(.*)\}$/, '$1'), 'execution.processBusinessKey', out);
    assert.equal(out.match(/businessKey=/g)?.length, 1, out);
  }
});

test('FEEL -> JUEL: camunda.processInstance.businessId is execution.processBusinessKey', () => {
  for (const [body, juel] of [
    ['camunda.processInstance.businessId', 'execution.processBusinessKey'],
    ['"order-" + camunda.processInstance.businessId', '"order-".concat(execution.processBusinessKey)'],
    // in a text it stays text
    ['"camunda.processInstance.businessId"', '"camunda.processInstance.businessId"'],
  ]) {
    const r = feelToJuel(body);
    assert.ok(r.ok && r.juel.includes(juel), `${body}: ${JSON.stringify(r)}`);
  }
  for (const body of ['order.camunda.processInstance.businessId', 'camunda.processInstance.businessIds']) {
    const r = feelToJuel(body);
    assert.ok(r.ok && !r.juel.includes('execution.processBusinessKey'), `${body}: ${JSON.stringify(r)}`);
  }
});

test('variables: C7 and C8 offer camunda.processInstance.businessId - no variable businessKey', () => {
  for (const engine of ['c7', 'c8'] as const) {
    const vars = processVariables({ processId: 'acme-demoV1', name: 'acme-demoV1', engine, steps: [] } as unknown as ProcessSpec, null);
    assert.equal(vars.find(v => v.name === 'businessKey'), undefined, engine);
    const instance = vars.find(v => v.name === 'camunda')?.children?.find(v => v.name === 'processInstance');
    assert.ok(instance?.children?.some(v => v.name === 'businessId'), `${engine}: ${JSON.stringify(instance)}`);
    assert.deepEqual(checkFeel('= camunda.processInstance.businessId', vars).issues, [], engine);
    // businessKey: reported with the context
    assert.ok(checkFeel('= businessKey', vars).issues.some(i => i.level === 'error' && i.text.includes('camunda.processInstance.businessId')), engine);
  }
});

test('import of C7: the business key is always the context camunda.processInstance.businessId', () => {
  for (const juel of ['execution.processBusinessKey', 'execution.businessKey', 'execution.getBusinessKey()', 'execution.getProcessBusinessKey()']) {
    const r = juelToFeel(juel);
    assert.ok(r.ok && r.feel === 'camunda.processInstance.businessId', `${juel}: ${JSON.stringify(r)}`);
  }
});

test('export to C7: a variable named businessKey stays a variable - only the context is execution.processBusinessKey', () => {
  for (const name of ['businessKey', 'processInstanceId']) {
    const r = feelToJuel(name);
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.juel, name);
  }
});
