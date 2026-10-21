// Ein Typ-Alias mit Union-Typ (`type ReceivingSystems = Option[String] | Seq[ReceivingSystem]`)
// im Begleitobjekt: die App bildet ihn nicht ab — das Feld behält den Alias, wörtlich.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { importBpmn } from '../src/bpmn';
import { scanScala } from '../src/domainScan';
import { enrichSpec } from '../src/projectImport';
import { isScalaTypeExpression } from '../src/scala';
import { isCompoundType, typeShape } from '../src/scalaTypes';

(globalThis as unknown as { DOMParser: unknown }).DOMParser = DOMParser;

const PID = 'acme-demo-sendEventV1';
const PKG = 'acme.demo.domain.sendEvent.v1';

const bpmn = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="${PID}" name="${PID}" isExecutable="true">
    <bpmn:startEvent id="StartEvent"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:endEvent id="EndEvent"><bpmn:incoming>f1</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="f1" sourceRef="StartEvent" targetRef="EndEvent"/>
  </bpmn:process>
</bpmn:definitions>`;

const source = `package ${PKG}

import ${PKG}.SendEvent.In.ReceivingSystems

object SendEvent extends CompanyBpmnProcessDsl:
  val processName = "${PID}"
  val descr: String = ""

  case class In(
      receivingSystems: ReceivingSystems,
      tags: Option[Seq[String]]
  )
  object In:
    type ReceivingSystems = Option[String] | Seq[ReceivingSystem]
    lazy val example = In(receivingSystems = None, tags = None)

  enum ReceivingSystem:
    case GRAVITON, CAM

  lazy val example = process(In.example, NoOutput())
end SendEvent
`;

test('typeShape: a union is no wrapper - Option[…] only when its bracket closes at the end', () => {
  assert.deepEqual(typeShape('Option[String] | Seq[ReceivingSystem]'),
    { base: 'Option[String] | Seq[ReceivingSystem]', optional: false, collection: false, map: false });
  assert.deepEqual(typeShape('Option[Seq[String]]'), { base: 'String', optional: true, collection: true, map: false });
  assert.ok(isCompoundType('Option[String] | Seq[X]'));
  assert.ok(isCompoundType('A & B'));
  assert.ok(!isCompoundType('String :| ValidEmail'));
  assert.ok(!isCompoundType('Seq[A | B]'));
});

test('import: a field typed with a union alias keeps the alias - fully qualified, taken over as is', () => {
  const domain = scanScala(source, 'SendEvent.scala');
  const spec = importBpmn(bpmn, 'send-event').spec;
  const r = enrichSpec({ ...spec, project: 'acme-demo' }, domain, null);
  assert.ok(r);
  const field = (r.spec.types ?? []).flatMap(t => t.fields ?? []).find(f => f.name === 'receivingSystems')!;
  assert.equal(field.type, 'SendEvent.In.ReceivingSystems');
  assert.ok(!field.optional && !field.collection);
  assert.ok(isScalaTypeExpression(field.type));
  // die übrigen Felder wie bisher
  const tags = (r.spec.types ?? []).flatMap(t => t.fields ?? []).find(f => f.name === 'tags')!;
  assert.deepEqual([tags.type, tags.optional, tags.collection], ['String', true, true]);
});

