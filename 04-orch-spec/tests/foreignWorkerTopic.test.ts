// A service whose topic belongs to a worker of another project
// (`valiant-graviton-person.GetConsultant`) is no own worker of the process —
// even if the catalog knows that worker. A worker of a neighbouring package of
// the same project still is.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { importBpmn } from '../src/bpmn';
import { scanScala } from '../src/domainScan';
import { enrichSpec } from '../src/projectImport';

(globalThis as unknown as { DOMParser: unknown }).DOMParser = DOMParser;

const PID = 'acme-demo-addressChange';
const PKG = 'acme.demo.domain.addressChange.v1';

const bpmn = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="d" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="${PID}" name="${PID}" isExecutable="true">
    <bpmn:startEvent id="StartEvent"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:serviceTask id="GetConsultantTask" name="Get Consultant" camunda:type="external" camunda:topic="acme-person.GetConsultant"><bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:serviceTask id="CheckAddressTask" name="Check Address" camunda:type="external" camunda:topic="acme-demo-shared.CheckAddress"><bpmn:incoming>f2</bpmn:incoming><bpmn:outgoing>f3</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:endEvent id="EndEvent"><bpmn:incoming>f3</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="f1" sourceRef="StartEvent" targetRef="GetConsultantTask"/>
    <bpmn:sequenceFlow id="f2" sourceRef="GetConsultantTask" targetRef="CheckAddressTask"/>
    <bpmn:sequenceFlow id="f3" sourceRef="CheckAddressTask" targetRef="EndEvent"/>
  </bpmn:process>
</bpmn:definitions>`;

const worker = (pkg: string, name: string, topic: string) => `package ${pkg}

object ${name} extends CompanyBpmnCustomTaskDsl:
  val topicName = "${topic}"
  val descr: String = ""
  case class Out(ok: Boolean)
  object Out:
    lazy val example = Out(ok = true)
  lazy val example = customTask(NoInput(), Out.example)
end ${name}
`;

const sources: Record<string, string> = {
  'AddressChange.scala': `package ${PKG}

object AddressChange extends CompanyBpmnProcessDsl:
  val processName = "${PID}"
  val descr: String = ""
  case class In(clientKey: Long)
  object In:
    lazy val example = In(clientKey = 1L)
  lazy val example = process(In.example, NoOutput())
end AddressChange
`,
  // another project — in the catalog, but not a worker of this process
  'GetConsultant.scala': worker('acme.person.domain.person.v1', 'GetConsultant', 'acme-person.GetConsultant'),
  // a neighbouring package of the same project
  'CheckAddress.scala': worker('acme.demo.domain.shared.v1', 'CheckAddress', 'acme-demo-shared.CheckAddress'),
};

const domain = Object.entries(sources).flatMap(([path, text]) => scanScala(text, path));

test('a worker of another project stays a service - a neighbouring package of the project is an own worker', () => {
  const spec = importBpmn(bpmn, 'address-change').spec;
  const r = enrichSpec({ ...spec, project: 'acme-demo' }, domain, null);
  assert.ok(r);
  const names = (r.spec.interactions ?? []).map(i => `${i.kind}:${i.name}`);
  assert.ok(!names.includes('customTask:GetConsultant'), `GetConsultant is a foreign service: ${names}`);
  assert.ok(names.includes('customTask:CheckAddress'), `CheckAddress is a worker of the project: ${names}`);
});
