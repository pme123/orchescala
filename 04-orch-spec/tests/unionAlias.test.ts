// Ein Typ-Alias mit Union-Typ (`type ReceivingSystems = Option[String] | Seq[ReceivingSystem]`)
// im Begleitobjekt: die App bildet ihn nicht ab — das Feld behält den Alias, wörtlich.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { importBpmn } from '../src/bpmn';
import { scanScala } from '../src/domainScan';
import { enrichSpec } from '../src/projectImport';
import { isScalaTypeExpression, scalaFiles } from '../src/scala';
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
      tags: Option[Seq[String]],
      id: In.Id,
      both: In.Both,
      range: In.Range
  )
  object In:
    type ReceivingSystems = Option[String] | Seq[ReceivingSystem]
    type Id = String :| MinLength[1]
    type Both = Named & Dated
    type Range = Int :| Greater[0] & Less[10]
    lazy val example = In(receivingSystems = None, tags = None, id = "1", both = ???, range = 1)
  end In

  trait Helper:
    type Local = String

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
  // `&` im Iron-Refinement verbindet Einschränkungen — kein Schnitt-Typ
  assert.ok(!isCompoundType('Int :| Greater[0] & Less[10]'));
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


const imported = () => {
  const domain = scanScala(source, 'SendEvent.scala');
  const r = enrichSpec({ ...importBpmn(bpmn, 'send-event').spec, project: 'acme-demo' }, domain, null)!;
  const field = (name: string) => (r.spec.types ?? []).flatMap(t => t.fields ?? []).find(f => f.name === name)!;
  return { domain, spec: r.spec, field };
};

test('scan: a type after the companion object has ended is not named after it', () => {
  const names = imported().domain.map(t => t.name);
  assert.ok(names.includes('SendEvent.In.ReceivingSystems'));
  assert.ok(names.includes('SendEvent.Local'));
  assert.ok(!names.includes('SendEvent.In.Local'));
});

test('import: other aliases in the companion still resolve to their target - an intersection is kept', () => {
  const { field } = imported();
  assert.deepEqual([field('id').type, field('id').constraint], ['String', 'MinLength[1]']);
  assert.deepEqual([field('range').type, field('range').constraint], ['Int', 'Greater[0] & Less[10]']);
  assert.equal(field('both').type, 'SendEvent.In.Both');
});

test('export: the union alias is written as it was imported', () => {
  const { spec, domain } = imported();
  const file = scalaFiles(spec, { domainTypes: domain } as never).find(f => f.path.endsWith('/SendEvent.scala'))!;
  assert.match(file.content, /receivingSystems: SendEvent\.In\.ReceivingSystems,/);
});

test('import: a union alias at the top of the file is reported as unresolved - its simple name is no Scala path', () => {
  const top = source
    .replace('object SendEvent extends', 'type TopUnion = String | Int\n\nobject SendEvent extends')
    .replace('      range: In.Range\n', '      range: In.Range,\n      top: TopUnion\n');
  const r = enrichSpec({ ...importBpmn(bpmn, 'send-event').spec, project: 'acme-demo' }, scanScala(top, 'SendEvent.scala'), null)!;
  assert.ok(r.unresolved.includes('TopUnion'));
});
