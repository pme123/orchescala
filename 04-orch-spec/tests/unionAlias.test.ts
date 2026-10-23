// A type alias with a union type (`type ReceivingSystems = Option[String] | Seq[ReceivingSystem]`)
// in the companion object: the app does not model it — the field keeps the alias, verbatim.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { importBpmn } from '../src/bpmn';
import { scanScala } from '../src/domainScan';
import { enrichSpec } from '../src/projectImport';
import { isScalaTypeExpression, scalaFiles } from '../src/scala';
import { isCompoundType, typeShape, unionAllowsNone } from '../src/scalaTypes';

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
      range: In.Range,
      pid: In.ProcessInstanceId,
      commented: In.Commented
  )
  object In:
    type ReceivingSystems = Option[String] | Seq[ReceivingSystem]
    type Id = String :| MinLength[1]
    type Both = Named & Dated
    type Range = Int :| (Greater[0] & Less[10])
    type ProcessInstanceId = String :| ValidUUID | Long
    type Commented = String // C7: a | b - C8: c & d
    object Nested:
      type Deep = String
    end Nested
    trait Inside:
      type Local = Int
// a comment at column 0 does not end the companion
    type After = Long
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
  // `:|` binds tighter: without parentheses it is a union or an intersection type, with parentheses a refinement
  assert.ok(isCompoundType('String :| ValidUUID | Long'));
  assert.ok(isCompoundType('Int :| Greater[0] & Less[10]'));
  assert.ok(!isCompoundType('Int :| (Greater[0] & Less[10])'));
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
  // the other fields as before
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
  assert.ok(names.includes('SendEvent.Helper.Local'));
  assert.ok(!names.includes('SendEvent.In.Local'));
  // nested: the path through all scopes - and back in the outer one after the inner has ended
  assert.ok(names.includes('SendEvent.In.Nested.Deep'));
  assert.ok(names.includes('SendEvent.In.Inside.Local'));
  assert.ok(names.includes('SendEvent.In.After'));
});

test('import: other aliases in the companion still resolve to their target - an intersection is kept', () => {
  const { field } = imported();
  assert.deepEqual([field('id').type, field('id').constraint], ['String', 'MinLength[1]']);
  assert.deepEqual([field('range').type, field('range').constraint], ['Int', '(Greater[0] & Less[10])']);
  // String :| ValidUUID | Long — a union: the alias stays, without refinement (no .refineUnsafe in the example)
  assert.deepEqual([field('pid').type, field('pid').constraint], ['SendEvent.In.ProcessInstanceId', undefined]);
  // a comment after the alias does not count — `| b` in it does not make a union
  assert.equal(field('commented').type, 'String');
  assert.equal(field('both').type, 'SendEvent.In.Both');
});

test('export: the union alias is written as it was imported', () => {
  const { spec, domain } = imported();
  const file = scalaFiles(spec, { domainTypes: domain } as never).find(f => f.path.endsWith('/SendEvent.scala'))!;
  assert.match(file.content, /receivingSystems: SendEvent\.In\.ReceivingSystems,/);
});

test('unionAllowsNone: an Option[…] or None.type on the outside of a union member', () => {
  assert.ok(unionAllowsNone('Option[String] | Seq[ReceivingSystem]'));
  assert.ok(unionAllowsNone('Seq[X] | Option[Seq[X]]'));
  assert.ok(unionAllowsNone('None.type | String'));
  assert.ok(!unionAllowsNone('String :| ValidUUID | Long'));
  assert.ok(!unionAllowsNone('Seq[Option[String]] | Long'));
  assert.ok(!unionAllowsNone('Option[String]'));
  assert.ok(!unionAllowsNone('Option[A | B]'));
  assert.ok(!unionAllowsNone('String | "Option[x]"'));
});

test('export: exampleMinimal sets a union alias with an Option to None - other aliases not', () => {
  const { spec, domain } = imported();
  const file = scalaFiles(spec, { domainTypes: domain } as never).find(f => f.path.endsWith('/SendEvent.scala'))!;
  const minimal = /lazy val exampleMinimal = example\.copy\(([\s\S]*?)\)/.exec(file.content)?.[1] ?? '';
  assert.match(minimal, /receivingSystems = None/, file.content);
  assert.match(minimal, /tags = None/);
  assert.doesNotMatch(minimal, /pid = None/);
  // without the domain (no alias known) only the Option fields
  const bare = scalaFiles(spec, null).find(f => f.path.endsWith('/SendEvent.scala'))!;
  const bareMinimal = /lazy val exampleMinimal = example\.copy\(([\s\S]*?)\)/.exec(bare.content)?.[1] ?? '';
  assert.doesNotMatch(bareMinimal, /receivingSystems/);
});

test('import: a union alias at the top of the file is reported as unresolved - its simple name is no Scala path', () => {
  const top = source
    .replace('object SendEvent extends', 'type TopUnion = String | Int\n\nobject SendEvent extends')
    .replace('      commented: In.Commented\n', '      commented: In.Commented,\n      top: TopUnion\n');
  const r = enrichSpec({ ...importBpmn(bpmn, 'send-event').spec, project: 'acme-demo' }, scanScala(top, 'SendEvent.scala'), null)!;
  assert.ok(r.unresolved.includes('TopUnion'));
});
