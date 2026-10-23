// A type alias with a union type (`type ReceivingSystems = Option[String] | Seq[ReceivingSystem]`)
// in the companion object: the app does not model it — the field keeps the alias, verbatim.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { DEFAULT_MERGE_STATUS, importBpmn } from '../src/bpmn';
import { scanScala } from '../src/domainScan';
import { enrichSpec } from '../src/projectImport';
import { mergeDomain } from '../src/domainMerge';
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

// the arguments of `lazy val exampleMinimal = example.copy(…)` after `marker` — up to its closing line
// fails when the marker or the `.copy(` block is missing — a `doesNotMatch` must not pass on nothing
const minimalAfter = (content: string, marker: string): string => {
  const at = content.indexOf(marker);
  assert.ok(at >= 0, `${marker} missing in\n${content}`);
  const m = /lazy val exampleMinimal = example\.copy\(\n([\s\S]*?)\n\s*\)\n/.exec(content.slice(at));
  assert.ok(m, `exampleMinimal = example.copy(…) missing after ${marker} in\n${content}`);
  return m[1];
};

test('export: exampleMinimal sets a union alias with an Option to None - other aliases not; no catalog needed', () => {
  const { spec } = imported();
  // the app exports with the catalog as model - it does not have the project's aliases
  const file = scalaFiles(spec, null).find(f => f.path.endsWith('/SendEvent.scala'))!;
  const minimal = minimalAfter(file.content, 'object In:');
  assert.match(minimal, /receivingSystems = None/, file.content);
  assert.match(minimal, /tags = None/);
  assert.doesNotMatch(minimal, /pid = None/);
});

test('export: a field whose type was changed since the import is no longer set to None', () => {
  const { spec } = imported();
  // a scalar, or another alias by name (not known as a type id) — the flag was for the old alias
  for (const type of ['String', 'SendEvent.In.Other']) {
    const changed = {
      ...spec,
      types: (spec.types ?? []).map(t => ({ ...t, fields: t.fields?.map(f => (f.name === 'receivingSystems' ? { ...f, type } : f)) })),
    };
    const file = scalaFiles(changed, null).find(f => f.path.endsWith('/SendEvent.scala'))!;
    const minimal = minimalAfter(file.content, 'object In:');
    assert.match(minimal, /tags = None/);
    assert.doesNotMatch(minimal, /receivingSystems/, file.content);
  }
});

test('sync: a spec from before gets noneAlias from the domain', () => {
  const { spec } = imported();
  const strip = (s: typeof spec) => ({
    ...s,
    types: (s.types ?? []).map(t => ({ ...t, fields: t.fields?.map(({ noneAlias: _, ...f }) => f) })),
  });
  const { spec: merged } = mergeDomain(strip(spec), spec, { status: DEFAULT_MERGE_STATUS });
  const field = (merged.types ?? []).flatMap(t => t.fields ?? []).find(f => f.name === 'receivingSystems')!;
  assert.equal(field.noneAlias, 'SendEvent.In.ReceivingSystems');
});

test('sync: noneAlias goes away when the domain alias no longer allows None', () => {
  const { spec } = imported();
  // the domain now: `type ReceivingSystems = String | Seq[ReceivingSystem]`
  const changed = source.replace('type ReceivingSystems = Option[String] | Seq[ReceivingSystem]', 'type ReceivingSystems = String | Seq[ReceivingSystem]');
  const fresh = enrichSpec({ ...importBpmn(bpmn, 'send-event').spec, project: 'acme-demo' }, scanScala(changed, 'SendEvent.scala'), null)!.spec;
  const { spec: merged } = mergeDomain(spec, fresh, { status: DEFAULT_MERGE_STATUS });
  const field = (merged.types ?? []).flatMap(t => t.fields ?? []).find(f => f.name === 'receivingSystems')!;
  assert.equal(field.type, 'SendEvent.In.ReceivingSystems');
  assert.equal(field.noneAlias, undefined);
  const file = scalaFiles(merged, null).find(f => f.path.endsWith('/SendEvent.scala'))!;
  assert.doesNotMatch(minimalAfter(file.content, 'object In:'), /receivingSystems/, file.content);
});

const noneSource = `package ${PKG}

object SendEvent extends CompanyBpmnProcessDsl:
  val processName = "${PID}"
  val descr: String = ""

  case class In(
      rs: In.Rs,
      maybe: In.Maybe,
      same: In.Same,
      noneOrInt: In.NoneOrInt,
      refined: In.Refined,
      inner: In.Inner,
      list: Seq[In.Rs],
      name: String
  )
  object In:
    type Rs = Option[String] | Seq[String]
    type Maybe = Rs | Long
    type Same = Rs
    type NoneOrInt = None.type | Int
    type Refined = Option[String] :| MinLength[1] | Long
    type Inner = Option[String :| MinLength[1]] | Long
  end In

  enum Out:
    case Done(
        rs: In.Rs,
        count: Int
    )
  end Out

  lazy val example = process(In.example, Out.example)
end SendEvent
`;

test('export: exampleMinimal - an alias of an alias, None.type, a refined Option, a Seq of such an alias, an ADT case', () => {
  const domain = scanScala(noneSource, 'SendEvent.scala');
  const r = enrichSpec({ ...importBpmn(bpmn, 'send-event').spec, project: 'acme-demo' }, domain, null)!;
  // `type Same = Rs` (no union): the import resolves it to `Rs` itself, with its noneAlias
  const same = (r.spec.types ?? []).flatMap(t => t.fields ?? []).find(f => f.name === 'same')!;
  assert.deepEqual([same.type, same.noneAlias], ['SendEvent.In.Rs', 'SendEvent.In.Rs']);
  const file = scalaFiles(r.spec, null).find(f => f.path.endsWith('/SendEvent.scala'))!;
  const inMinimal = minimalAfter(file.content, 'object In:');
  for (const name of ['rs', 'maybe', 'same', 'noneOrInt', 'inner']) assert.match(inMinimal, new RegExp(`\\b${name} = None`), file.content);
  // `Option[String] :| C` is no Option - None would not compile; a Seq is never None
  for (const name of ['refined', 'list', 'name']) assert.doesNotMatch(inMinimal, new RegExp(`\\b${name} = None`), file.content);
  const caseMinimal = minimalAfter(file.content, 'object Done:');
  assert.match(caseMinimal, /\brs = None/, file.content);
  assert.doesNotMatch(caseMinimal, /count/);
});

test('unionAllowsNone: a member naming another alias counts with its target - without a loop', () => {
  const targets: Record<string, string> = { Rs: 'Option[String] | Seq[X]', A: 'B | Int', B: 'A | Long' };
  const resolve = (n: string) => targets[n];
  assert.ok(unionAllowsNone('Rs | Long', resolve));
  assert.ok(!unionAllowsNone('A | String', resolve));
  assert.ok(!unionAllowsNone('Rs', resolve)); // no union - the import resolves it to Rs itself
  assert.ok(!unionAllowsNone('Option[String] :| MinLength[1] | Long'));
  assert.ok(unionAllowsNone('Option[String :| MinLength[1]] | Long'));
  assert.ok(!unionAllowsNone('`a|b` | Long'));
});

test('import: a union alias at the top of the file is reported as unresolved - its simple name is no Scala path', () => {
  const top = source
    .replace('object SendEvent extends', 'type TopUnion = String | Int\n\nobject SendEvent extends')
    .replace('      commented: In.Commented\n', '      commented: In.Commented,\n      top: TopUnion\n');
  const r = enrichSpec({ ...importBpmn(bpmn, 'send-event').spec, project: 'acme-demo' }, scanScala(top, 'SendEvent.scala'), null)!;
  assert.ok(r.unresolved.includes('TopUnion'));
});
