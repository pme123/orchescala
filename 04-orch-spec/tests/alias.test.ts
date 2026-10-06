// In bzw. Out als anderer Typ (`type In = OrderCardUT.In`) und abweichende
// Werte im Beispiel der Interaktion (`OrderCardUT.In.example.copy(…)`):
// der Import behält beides, der Export schreibt es wieder so.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { importBpmn } from '../src/bpmn';
import { scanScala } from '../src/domainScan';
import { enrichSpec } from '../src/projectImport';
import { scalaFiles, scalaKey } from '../src/scala';

(globalThis as unknown as { DOMParser: unknown }).DOMParser = DOMParser;

const PID = 'acme-demo-orderCard';
const PKG = 'acme.demo.domain.orderCard.v1';

const bpmn = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="${PID}" name="${PID}" isExecutable="true">
    <bpmn:startEvent id="StartEvent"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:userTask id="PostprocessKUBETask" name="Nachbearbeiten"><bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing></bpmn:userTask>
    <bpmn:userTask id="OrderCardTask" name="Karte bestellen"><bpmn:incoming>f2</bpmn:incoming><bpmn:outgoing>f3</bpmn:outgoing></bpmn:userTask>
    <bpmn:endEvent id="EndEvent"><bpmn:incoming>f3</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="f1" sourceRef="StartEvent" targetRef="PostprocessKUBETask"/>
    <bpmn:sequenceFlow id="f2" sourceRef="PostprocessKUBETask" targetRef="OrderCardTask"/>
    <bpmn:sequenceFlow id="f3" sourceRef="OrderCardTask" targetRef="EndEvent"/>
  </bpmn:process>
</bpmn:definitions>`;

const sources: Record<string, string> = {
  'OrderCard.scala': `package ${PKG}

object OrderCard extends CompanyBpmnProcessDsl:
  val processName = "${PID}"
  val descr: String = ""
  case class In(clientKey: Long)
  object In:
    lazy val example = In(clientKey = 1L)
  lazy val example = process(In.example, NoOutput())
end OrderCard
`,
  'OrderCardUT.scala': `package ${PKG}

object OrderCardUT extends CompanyBpmnUserTaskDsl:
  val name = "OrderCardTask"
  val descr: String = ""
  case class In(
      clientKey: Long,
      clientKeyIsIdentityOk: Boolean
  )
  object In:
    lazy val example = In(clientKey = 1L, clientKeyIsIdentityOk = true)
  case class Out(cardOrdered: Boolean)
  object Out:
    lazy val example = Out(cardOrdered = true)
  lazy val example = userTask(In.example, Out.example)
end OrderCardUT
`,
  'PostProcessOrderUT.scala': `package acme.demo.domain.other.v1

object PostProcessOrderUT extends CompanyBpmnUserTaskDsl:
  val name = "PostprocessOrderTask"
  val descr: String = ""
  case class In(clientKey: Long)
  case class Out(comment: String)
  object Out:
    lazy val example = Out(comment = "ok")
  lazy val example = userTask(In(1L), Out.example)
end PostProcessOrderUT
`,
  'PostProcessCardUT.scala': `package ${PKG}

import acme.demo.domain.other.v1.PostProcessOrderUT

object PostProcessCardUT extends CompanyBpmnUserTaskDsl:
  val name          = "PostprocessKUBETask"
  val descr: String = ""

  type In = OrderCardUT.In

  type Out = PostProcessOrderUT.Out

  lazy val example = userTask(
    OrderCardUT.In.example.copy(clientKeyIsIdentityOk = false),
    PostProcessOrderUT.Out.example
  )
end PostProcessCardUT
`,
};

const domain = Object.entries(sources).flatMap(([path, text]) => scanScala(text, path));

test('the scanner reads the deviating values of the example of a user task', () => {
  const ut = domain.find(t => t.owner === 'PostProcessCardUT' && t.name === 'PostProcessCardUT.In');
  assert.equal(ut?.kind, 'alias');
  assert.deepEqual(ut?.exampleCopies, { In: { clientKeyIsIdentityOk: 'false' } });
});

test('import keeps the alias and the deviating values - export writes them again', () => {
  const spec = importBpmn(bpmn, 'order-card').spec;
  const r = enrichSpec({ ...spec, project: 'acme-demo' }, domain, null);
  assert.ok(r);
  const ias = r.spec.interactions ?? [];
  const order = ias.find(i => i.name === 'OrderCardUT')!;
  const post = ias.find(i => i.name === 'PostProcessCardUT')!;
  // das In von OrderCardUT — dieselben Felder, keine Kopie
  assert.equal(post.inAlias, `${order.id}.In`);
  assert.equal(post.inTypeId, order.inTypeId);
  assert.deepEqual(post.inExample, { clientKeyIsIdentityOk: 'false' });
  // das Out liegt in einem anderen Projekt: ein Verweis auf die Domain
  assert.equal(post.outAlias, 'dom:acme.demo.domain.other.v1.PostProcessOrderUT.Out');

  const file = scalaFiles(r.spec, { domainTypes: domain } as never).find(f => f.path.endsWith('/PostProcessCardUT.scala'));
  assert.ok(file, 'PostProcessCardUT.scala');
  assert.match(file.content, /type In = OrderCardUT\.In/);
  assert.match(file.content, /type Out = PostProcessOrderUT\.Out/);
  assert.match(file.content, /import acme\.demo\.domain\.other\.v1\.PostProcessOrderUT/);
  assert.match(file.content, /userTask\(\s*OrderCardUT\.In\.example\.copy\(clientKeyIsIdentityOk = false\),\s*PostProcessOrderUT\.Out\.example\s*\)/);
  assert.doesNotMatch(file.content, /case class In/);
});

test('a key with a value from Scala is an interpolated string - JUEL stays text', () => {
  assert.equal(scalaKey('valiant-cancel-${SignalEvent.Dynamic_ProcessInstance}'), 's"valiant-cancel-${SignalEvent.Dynamic_ProcessInstance}"');
  assert.equal(scalaKey('Wert ${execution.processInstanceId}'), '"Wert ${execution.processInstanceId}"');
  assert.equal(scalaKey('${OrderCard.processName} kostet 5$'), 's"${OrderCard.processName} kostet 5$$"');
});
