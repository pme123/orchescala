// A field whose name is a reserved word, written in backticks (`` `type`: IdentityLinkType ``):
// the import keeps it (named without the backticks), the check accepts it,
// and the export writes it back in backticks.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { importBpmn } from '../src/bpmn';
import { scanScala } from '../src/domainScan';
import { enrichSpec } from '../src/projectImport';
import { checkTypes, scalaFiles, scalaName } from '../src/scala';

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

const identityLink = `package ${PKG}.schema

case class IdentityLink(
    @description(
      "The type of the identity link."
    )
    \`type\`: IdentityLinkType,
    groupId: Option[String],
    \`display name\`: Option[String]
)

object IdentityLink:
  lazy val example = IdentityLink(
    \`type\` = IdentityLinkType.candidate,
    groupId = Some("0949--Kundencenter"),
    \`display name\` = Some("Kundencenter")
  )
end IdentityLink

enum IdentityLinkType:
  case candidate, assignee, owner
`;

const process = `package ${PKG}

import ${PKG}.schema.*

object SendEvent extends CompanyBpmnProcessDsl:
  val processName = "${PID}"
  val descr: String = ""

  case class In(identityLinks: Option[Seq[IdentityLink]])
  object In:
    lazy val example = In(identityLinks = None)
  end In

  lazy val example = process(In.example, NoOutput())
end SendEvent
`;

const domain = () => [...scanScala(identityLink, 'IdentityLink.scala'), ...scanScala(process, 'SendEvent.scala')];

test('scan: a field in backticks is read - named without them, with its description and example', () => {
  const t = domain().find(x => x.name === 'IdentityLink')!;
  assert.deepEqual(t.fields?.map(f => [f.name, f.type]), [['type', 'IdentityLinkType'], ['groupId', 'Option[String]'], ['display name', 'Option[String]']]);
  const type = t.fields!.find(f => f.name === 'type')!;
  assert.equal(type.description, 'The type of the identity link.');
  assert.equal(type.example, 'IdentityLinkType.candidate');
});

test('a reserved word as field name is no error - and the export writes it in backticks', () => {
  const r = enrichSpec({ ...importBpmn(bpmn, 'send-event').spec, project: 'acme-demo' }, domain(), null)!;
  const link = (r.spec.types ?? []).find(t => t.name === 'IdentityLink')!;
  assert.ok(link.fields?.some(f => f.name === 'type'));
  assert.deepEqual(checkTypes(r.spec.types).filter(i => i.typeId === link.id).map(i => i.message), []);
  const code = scalaFiles(r.spec, { domainTypes: domain() } as never).map(f => f.content).join('\n');
  assert.match(code, /`type`: IdentityLinkType/);
  assert.match(code, /`display name`: Option\[String\]/);
  // the example and exampleMinimal name the fields the same way
  assert.match(code, /`type` = IdentityLinkType\.candidate/);
  assert.match(code, /`display name` = (Some\()?"Kundencenter"/);
  assert.match(code, /exampleMinimal = example\.copy\([\s\S]*`display name` = None/);
  assert.ok(!/[^`]type: IdentityLinkType/.test(code), 'no bare `type:` declaration');
});

test('scalaName: reserved words and odd names in backticks, plain names as they are', () => {
  assert.equal(scalaName('type'), '`type`');
  assert.equal(scalaName('QI-Deklaration'), '`QI-Deklaration`');
  assert.equal(scalaName('groupId'), 'groupId');
  assert.equal(scalaName('display name'), '`display name`');
});

test('field names: plain ones follow the convention, quoted ones only must be writable in backticks', () => {
  const issues = (name: string) => checkTypes([{ id: 't', name: 'X', kind: 'case', fields: [{ id: 'f', name, type: 'String' }] }] as never)
    .filter(i => i.field === 'f').map(i => i.message);
  assert.deepEqual(issues('display name'), []);
  assert.deepEqual(issues('QI-Deklaration'), []);
  assert.deepEqual(issues('type'), []);
  assert.equal(issues('GroupId').length, 1);
  assert.equal(issues(' name').length, 1);
  assert.equal(issues('a`b').length, 1);
  assert.equal(issues('').length, 1);
});

test('enum values with a space: read in backticks, no error, written back as they are', () => {
  const src = `package ${PKG}.schema\n\nenum Channel:\n  case Mail, \`Ohne Angabe\`\n  case \`Per Post\` // - letter\nend Channel\n`;
  const t = scanScala(src, 'Channel.scala').find(x => x.name === 'Channel')!;
  assert.deepEqual(t.values, ['Mail', '`Ohne Angabe`', '`Per Post`']);
  const typeDef = { id: 'e', name: 'Channel', kind: 'enum', values: t.values!.map(name => ({ name })) };
  assert.deepEqual(checkTypes([typeDef] as never).map(i => i.message), []);
});
