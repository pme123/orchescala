// A field whose name is a reserved word, written in backticks (`` `type`: IdentityLinkType ``):
// the import keeps it (named without the backticks), the check accepts it,
// and the export writes it back in backticks.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { importBpmn } from '../src/bpmn';
import { scanScala } from '../src/domainScan';
import { enrichSpec } from '../src/projectImport';
import { checkTypes, nameSuggestion, scalaFiles, scalaName } from '../src/scala';

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
  const issues = checkTypes(r.spec.types).filter(i => i.typeId === link.id);
  assert.deepEqual(issues.filter(i => !i.warn).map(i => i.message), []);
  // valid — but a warning for each name that needs backticks
  assert.deepEqual(issues.filter(i => i.warn).map(i => i.message), [
    '«type» steht in Scala in Backticks (`type`) — ein Scala-Schlüsselwort. Wenn möglich einen einfachen Namen wählen.',
    '«display name» steht in Scala in Backticks (`display name`) — mit Leer- oder Sonderzeichen. Wenn möglich einen einfachen Namen wählen.',
  ]);
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
  const all = (name: string) => checkTypes([{ id: 't', name: 'X', kind: 'case', fields: [{ id: 'f', name, type: 'String' }] }] as never)
    .filter(i => i.field === 'f');
  const issues = (name: string) => all(name).filter(i => !i.warn).map(i => i.message);
  const warns = (name: string) => all(name).filter(i => i.warn).length;
  assert.deepEqual(issues('display name'), []);
  assert.deepEqual(issues('QI-Deklaration'), []);
  assert.deepEqual(issues('type'), []);
  // a warning only where backticks are needed
  assert.deepEqual([warns('display name'), warns('QI-Deklaration'), warns('type'), warns('groupId')], [1, 1, 1, 0]);
  assert.equal(warns(' name'), 0);
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
  const issues = checkTypes([typeDef] as never);
  assert.deepEqual(issues.filter(i => !i.warn).map(i => i.message), []);
  assert.equal(issues.filter(i => i.warn).length, 2);
});

/** a process In with one field of an own type — enough to export the type */
const withType = (t: object) => {
  const r = enrichSpec({ ...importBpmn(bpmn, 'send-event').spec, project: 'acme-demo' }, domain(), null)!;
  return { ...r.spec, types: [...(r.spec.types ?? []), t] } as never;
};

test('enum values typed without backticks (ONLY GAMIFICATION) are written in backticks - also in the example', () => {
  const spec = withType({ id: 't-rs', name: 'ReceivingSystem', kind: 'enum', values: [{ name: 'ONLY GAMIFICATION' }, { name: 'GRAVITON' }] });
  const code = scalaFiles(spec, { domainTypes: domain() } as never).map(f => f.content).join('\n');
  assert.match(code, /case `ONLY GAMIFICATION`, GRAVITON/);
  assert.match(code, /lazy val example = ReceivingSystem\.`ONLY GAMIFICATION`/);
  const issues = checkTypes([{ id: 't-rs', name: 'ReceivingSystem', kind: 'enum', values: [{ name: 'ONLY GAMIFICATION' }] }] as never);
  assert.deepEqual([issues.filter(i => !i.warn).length, issues.filter(i => i.warn).length], [0, 1]);
});

test('type names: spaces stay an error, a deviation from the convention is a warning', () => {
  const kinds = (name: string) => checkTypes([{ id: 't', name, kind: 'enum', values: [{ name: 'A' }] }] as never)
    .filter(i => !i.field && /Typname/.test(i.message)).map(i => (i.warn ? 'warn' : 'error'));
  assert.deepEqual(kinds('ReceivingSystem'), []);
  assert.deepEqual(kinds('receiving_system'), ['warn']);
  assert.deepEqual(kinds('Receiving System'), ['error']);
  assert.deepEqual(kinds('type'), ['error']);
});

test('a case with fields needs a plain name - it becomes a class and an object', () => {
  const issues = checkTypes([{ id: 't', name: 'Out', kind: 'enum', values: [{ name: 'Per Post', fields: [{ id: 'f', name: 'street', type: 'String' }] }] }] as never);
  assert.ok(issues.some(i => !i.warn && i.message.includes('braucht einen einfachen Namen')));
});

test('suggestions: a plain name from what was typed', () => {
  assert.equal(nameSuggestion('field', 'Mein value'), 'meinValue');
  assert.equal(nameSuggestion('field', 'display name'), 'displayName');
  assert.equal(nameSuggestion('field', 'GroupId'), 'groupId');
  assert.equal(nameSuggestion('type', 'meine Klasse'), 'MeineKlasse');
  assert.equal(nameSuggestion('type', 'IdentityLink Type'), 'IdentityLinkType');
  assert.equal(nameSuggestion('type', 'receiving_system'), 'ReceivingSystem');
  assert.equal(nameSuggestion('value', 'ONLY GAMIFICATION'), 'ONLY_GAMIFICATION');
  assert.equal(nameSuggestion('value', '`Ohne Angabe`'), 'OhneAngabe');
  // nothing better: a reserved word, or already plain
  assert.equal(nameSuggestion('field', 'type'), undefined);
  assert.equal(nameSuggestion('field', 'groupId'), undefined);
});

test('the issues carry the suggestion - for the field, the type and the enum value', () => {
  const issues = checkTypes([
    { id: 'c', name: 'meine Klasse', kind: 'case', fields: [{ id: 'f', name: 'Mein value', type: 'String' }] },
    { id: 'e', name: 'ReceivingSystem', kind: 'enum', values: [{ name: 'ONLY GAMIFICATION' }] },
  ] as never);
  const of = (pred: (i: { typeId: string; field?: string; value?: string }) => boolean) => issues.find(pred)?.suggestion;
  assert.equal(of(i => i.typeId === 'c' && !i.field), 'MeineKlasse');
  assert.equal(of(i => i.field === 'f'), 'meinValue');
  assert.equal(of(i => i.value === 'ONLY GAMIFICATION'), 'ONLY_GAMIFICATION');
});
