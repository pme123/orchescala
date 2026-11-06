// A signal of the domain (`cancel-${SignalEvent.Dynamic_ProcessInstance}`) is matched to the step
// that catches it - also on C8, where the BPMN has the name as FEEL (`="cancel-" + string(…)`).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { importBpmn } from '../src/bpmn';
import { scanScala } from '../src/domainScan';
import { enrichSpec, fixedStart, isFixed } from '../src/projectImport';

(globalThis as unknown as { DOMParser: unknown }).DOMParser = DOMParser;

const PID = 'acme-demo-cancelV1';
const PKG = 'acme.demo.domain.cancel.v1';

const NS = {
  c7: 'xmlns:camunda="http://camunda.org/schema/1.0/bpmn"',
  c8: 'xmlns:zeebe="http://camunda.org/schema/zeebe/1.0" xmlns:modeler="http://camunda.org/schema/modeler/1.0" modeler:executionPlatform="Camunda Cloud"',
};
const SIGNAL = {
  c7: 'cancel-${execution.processInstanceId}',
  c8: '=&#34;cancel-&#34; + string(camunda.processInstance.key)',
};

const bpmn = (engine: 'c7' | 'c8') => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" ${NS[engine]} id="d" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="${PID}" name="${PID}" isExecutable="true">
    <bpmn:startEvent id="StartEvent"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:endEvent id="EndEvent"><bpmn:incoming>f1</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="f1" sourceRef="StartEvent" targetRef="EndEvent"/>
    <bpmn:subProcess id="CancelSubProcess" triggeredByEvent="true">
      <bpmn:startEvent id="CancelStartEvent" name="Abbruch-Signal"><bpmn:outgoing>c1</bpmn:outgoing><bpmn:signalEventDefinition signalRef="CancelSignal" /></bpmn:startEvent>
      <bpmn:endEvent id="CanceledEndEvent"><bpmn:incoming>c1</bpmn:incoming></bpmn:endEvent>
      <bpmn:sequenceFlow id="c1" sourceRef="CancelStartEvent" targetRef="CanceledEndEvent"/>
    </bpmn:subProcess>
  </bpmn:process>
  <bpmn:signal id="CancelSignal" name="${SIGNAL[engine]}" />
</bpmn:definitions>`;

const processSource = `package ${PKG}

object Cancel extends CompanyBpmnProcessDsl:
  val processName = "${PID}"
  val descr: String = ""
  lazy val example = process(NoInput(), NoOutput())
end Cancel
`;

const signalSource = `package ${PKG}

object CancelSE extends CompanyBpmnSignalEventDsl:
  val messageName   = s"cancel-\${SignalEvent.Dynamic_ProcessInstance}"
  val descr: String = "Bricht die Instanz ab."
  lazy val example = signalEvent()
end CancelSE
`;

test('fixedStart: the name up to its first dynamic part - JUEL, placeholder, FEEL literal', () => {
  assert.equal(fixedStart('cancel-${execution.processInstanceId}'), 'cancel-');
  assert.equal(fixedStart('cancel-{processInstanceId}'), 'cancel-');
  assert.equal(fixedStart('="cancel-" + string(camunda.processInstance.key)'), 'cancel-');
  assert.equal(fixedStart('= "orderCreated"'), 'orderCreated');
  assert.equal(fixedStart('="a\\"b" + x'), 'a"b');
  assert.equal(fixedStart('=someVariable'), '');
  assert.equal(fixedStart('orderCreated'), 'orderCreated');
});

for (const engine of ['c7', 'c8'] as const) {
  test(`${engine}: the signal of the domain is matched to the start of the event sub process that catches it`, () => {
    const domain = [...scanScala(processSource, 'Cancel.scala'), ...scanScala(signalSource, 'CancelSE.scala')];
    const r = enrichSpec({ ...importBpmn(bpmn(engine), 'cancel').spec, project: 'acme-demo' }, domain, null)!;
    assert.deepEqual(r.unmatched, []);
    assert.deepEqual(r.matched, ['CancelSE']);
    const ia = (r.spec.interactions ?? []).find(i => i.name === 'CancelSE');
    assert.equal(ia?.stepId, 'CancelStartEvent');
    assert.equal(ia?.kind, 'signal');
  });
}

test('a name without a dynamic part is compared whole - not by its start', () => {
  const source = (name: string) => `package ${PKG}

object OrderSE extends CompanyBpmnSignalEventDsl:
  val messageName   = "${name}"
  val descr: String = ""
  lazy val example = signalEvent()
end OrderSE
`;
  for (const engine of ['c7', 'c8'] as const) {
    for (const [domainName, matches] of [['cancel-', false], ['cancel-x', false]] as const) {
      const domain = [...scanScala(processSource, 'Cancel.scala'), ...scanScala(source(domainName), 'OrderSE.scala')];
      const r = enrichSpec({ ...importBpmn(bpmn(engine), 'cancel').spec, project: 'acme-demo' }, domain, null)!;
      assert.equal(r.matched.includes('OrderSE'), matches, `${engine}: ${domainName}`);
    }
  }
});

test('isFixed: only fixed text - a FEEL name as one string literal', () => {
  assert.equal(isFixed('orderCreated'), true);
  assert.equal(isFixed('="orderCreated"'), true);
  assert.equal(isFixed('cancel-${execution.processInstanceId}'), false);
  assert.equal(isFixed('cancel-{processInstanceId}'), false);
  assert.equal(isFixed('="cancel-" + string(camunda.processInstance.key)'), false);
});

test('a fixed name of the domain matches only the same fixed name - plain or FEEL', () => {
  const xml = (name: string) => bpmn('c8').replace(/name="=&#34;cancel-&#34; \+ string\(camunda.processInstance.key\)"/, `name="${name}"`);
  const source = `package ${PKG}

object StopSE extends CompanyBpmnSignalEventDsl:
  val messageName   = "stop"
  val descr: String = ""
  lazy val example = signalEvent()
end StopSE
`;
  for (const [name, matches] of [['stop', true], ['=&#34;stop&#34;', true], ['stopLater', false], ['=&#34;stopLater&#34;', false]] as const) {
    const domain = [...scanScala(processSource, 'Cancel.scala'), ...scanScala(source, 'StopSE.scala')];
    const r = enrichSpec({ ...importBpmn(xml(name), 'cancel').spec, project: 'acme-demo' }, domain, null)!;
    assert.equal(r.matched.includes('StopSE'), matches, name);
  }
});
