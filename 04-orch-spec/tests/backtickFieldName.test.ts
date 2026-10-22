// A field whose name is a reserved word, written in backticks (`` `type`: IdentityLinkType ``):
// the import keeps it (named without the backticks), the check accepts it,
// and the export writes it back in backticks.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { importBpmn } from '../src/bpmn';
import { scanScala } from '../src/domainScan';
import { enrichSpec } from '../src/projectImport';
import { checkTypes, indexTypes, nameSuggestion, renameEnumValue, scalaDefault, scalaFiles, scalaName } from '../src/scala';

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
  // valid — but a warning for each name that needs backticks, with a plain name where there is one
  const nameOf = (id?: string) => link.fields?.find(f => f.id === id)?.name;
  assert.deepEqual(issues.filter(i => i.warn).map(i => [nameOf(i.field), i.suggestion]), [['type', undefined], ['display name', 'displayName']]);
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

test('a case with fields in backticks (`QR-Rechnung`(…)) is read, valid with a warning, and written back in backticks', () => {
  const docs = `package ${PKG}.schema

enum DocContent:
  case \`QR-Rechnung\`(
      @description(
        "\`docContents.customDocContents.BetragFranken\` - \`rentalObject.totalAmount\`. Regel: wird nur befüllt, wenn es nur eine einzige Rate gibt (\`rentalObject.rateCount = 1\`)."
      )
      betragFranken: Option[BigDecimal]
  )
  case Brief(
      empfaenger: String
  )
end DocContent
`;
  const withDoc = process.replace('identityLinks: Option[Seq[IdentityLink]])', 'identityLinks: Option[Seq[IdentityLink]], doc: DocContent)');
  const dom = [...scanScala(identityLink, 'IdentityLink.scala'), ...scanScala(docs, 'DocContent.scala'), ...scanScala(withDoc, 'SendEvent.scala')];
  const scanned = dom.find(t => t.name === 'DocContent')!;
  assert.deepEqual(scanned.cases?.map(c => [c.name, c.fields?.map(f => f.name)]), [['`QR-Rechnung`', ['betragFranken']], ['Brief', ['empfaenger']]]);
  assert.match(scanned.cases![0].fields![0].description ?? '', /^`docContents\.customDocContents\.BetragFranken`/);

  const r = enrichSpec({ ...importBpmn(bpmn, 'send-event').spec, project: 'acme-demo' }, dom, null)!;
  const doc = (r.spec.types ?? []).find(t => t.name === 'DocContent')!;
  const issues = checkTypes(r.spec.types).filter(i => i.typeId === doc.id);
  assert.deepEqual(issues.filter(i => !i.warn).map(i => i.message), []);
  assert.deepEqual(issues.filter(i => i.warn).map(i => i.suggestion), ['QRRechnung']);

  const code = scalaFiles(r.spec, { domainTypes: dom } as never).map(f => f.content).join('\n');
  assert.match(code, /case `QR-Rechnung`\(/);
  assert.match(code, /object `QR-Rechnung`:/);
  assert.match(code, /end `QR-Rechnung`/);
  assert.match(code, /lazy val example: DocContent\.`QR-Rechnung` = DocContent\.`QR-Rechnung`\(/);
  assert.ok(!/``/.test(code), 'no doubled backticks');
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

test('names in backticks with brackets, colon, equals or comma are read whole', () => {
  const src = `package ${PKG}.schema

case class Odd(
    \`a:b\`: String,
    \`x=y\`: Int = 1,
    \`Brief (neu)\`: Option[String],
    last: Boolean
)

object Odd:
  lazy val example = Odd(
    \`a:b\` = "ab",
    \`x=y\` = 2,
    \`Brief (neu)\` = Some("neu"),
    last = true
  )
end Odd

enum Kind:
  case A, \`x, y\`, \`[z]\`
end Kind

enum Doc:
  case \`Brief (neu)\`(
      empfaenger: String
  )
  case Mail(to: String)
end Doc
`;
  const scanned = scanScala(src, 'Odd.scala');
  const odd = scanned.find(t => t.name === 'Odd')!;
  assert.deepEqual(odd.fields?.map(f => [f.name, f.type, f.default, f.example]), [
    ['a:b', 'String', undefined, '"ab"'],
    ['x=y', 'Int', '1', '2'],
    ['Brief (neu)', 'Option[String]', undefined, 'Some("neu")'],
    ['last', 'Boolean', undefined, 'true'],
  ]);
  assert.deepEqual(scanned.find(t => t.name === 'Kind')!.values, ['A', '`x, y`', '`[z]`']);
  const doc = scanned.find(t => t.name === 'Doc')!;
  assert.deepEqual(doc.cases?.map(c => [c.name, c.fields?.map(f => f.name)]), [['`Brief (neu)`', ['empfaenger']], ['Mail', ['to']]]);
});

test('duplicates: a name with and without backticks is the same', () => {
  const errors = (t: object) => checkTypes([t] as never).filter(i => !i.warn).map(i => i.message);
  assert.ok(errors({ id: 'e', name: 'Channel', kind: 'enum', values: [{ name: 'Foo' }, { name: '`Foo`' }] }).some(m => /Doppelte Werte/.test(m)));
  assert.ok(errors({ id: 'a', name: 'Doc', kind: 'enum', values: [{ name: 'Brief', fields: [{ id: 'x', name: 'a', type: 'String' }] }, { name: '`Brief`', fields: [{ id: 'y', name: 'b', type: 'String' }] }] }).some(m => /Doppelte Werte/.test(m)));
  assert.equal(errors({ id: 'e', name: 'Channel', kind: 'enum', values: [{ name: 'Foo' }, { name: '`Ohne Angabe`' }] }).length, 0);
});

test('no suggestion for a name that is already taken', () => {
  const issues = checkTypes([
    { id: 'c', name: 'meine Klasse', kind: 'case', fields: [{ id: 'f', name: 'display name', type: 'String' }, { id: 'g', name: 'displayName', type: 'String' }] },
    { id: 'k', name: 'MeineKlasse', kind: 'case', fields: [{ id: 'h', name: 'a', type: 'String' }] },
    { id: 'e', name: 'ReceivingSystem', kind: 'enum', values: [{ name: 'ONLY GAMIFICATION' }, { name: 'ONLY_GAMIFICATION' }] },
    { id: 'a', name: 'Doc', kind: 'enum', fields: [{ id: 'x', name: 'brief nr', type: 'String' }],
      values: [{ name: 'Brief', fields: [{ id: 'y', name: 'briefNr', type: 'String' }] }, { name: 'Mail', fields: [{ id: 'z', name: 'to', type: 'String' }] }] },
  ] as never);
  assert.equal(issues.find(i => i.typeId === 'c' && !i.field)?.suggestion, undefined);
  assert.equal(issues.find(i => i.field === 'f')?.suggestion, undefined);
  assert.equal(issues.find(i => i.value === 'ONLY GAMIFICATION')?.suggestion, undefined);
  // a common field stands in every case — its suggestion must be free there too
  assert.equal(issues.find(i => i.field === 'x')?.suggestion, undefined);
});

test('a suggestion taken over leaves no issue behind', () => {
  const before = [
    { id: 'c', name: 'meine Klasse', kind: 'case', fields: [{ id: 'f', name: 'Mein value', type: 'String' }] },
    { id: 'e', name: 'ReceivingSystem', kind: 'enum', values: [{ name: 'ONLY GAMIFICATION' }, { name: 'GRAVITON' }] },
  ];
  const issues = checkTypes(before as never);
  const typeName = issues.find(i => i.typeId === 'c' && !i.field)!.suggestion!;
  const fieldName = issues.find(i => i.field === 'f')!.suggestion!;
  const valueName = issues.find(i => i.value === 'ONLY GAMIFICATION')!.suggestion!;
  const after = [
    { ...before[0], name: typeName, fields: [{ id: 'f', name: fieldName, type: 'String' }] },
    { ...before[1], values: [{ name: valueName }, { name: 'GRAVITON' }] },
  ];
  assert.deepEqual(checkTypes(after as never), []);
});

test('renaming an enum value: the fields that use it as a fixed case follow', () => {
  const types = [
    { id: 'e', name: 'ReceivingSystem', kind: 'enum', values: [{ name: 'ONLY GAMIFICATION' }, { name: 'GRAVITON' }] },
    { id: 'c', name: 'Target', kind: 'case', fields: [
      { id: 'f', name: 'system', type: 'e', enumCase: '`ONLY GAMIFICATION`' },
      { id: 'g', name: 'other', type: 'e', enumCase: 'GRAVITON' },
    ] },
  ];
  const next = renameEnumValue(types as never, 'e', 0, 'ONLY_GAMIFICATION');
  assert.deepEqual(next[0].values?.map(v => v.name), ['ONLY_GAMIFICATION', 'GRAVITON']);
  assert.deepEqual(next[1].fields?.map(f => f.enumCase), ['ONLY_GAMIFICATION', 'GRAVITON']);
  assert.deepEqual(checkTypes(next).filter(i => !i.warn), []);
});

test('a FEEL default names an enum value without backticks - also one imported with them', () => {
  const types = [{ id: 'e', name: 'Channel', kind: 'enum', values: [{ name: 'Mail' }, { name: '`Ohne Angabe`' }, { name: 'type' }] }];
  const idx = indexTypes(types as never, null);
  const dflt = (d: string) => scalaDefault({ id: 'f', name: 'channel', type: 'e', default: d } as never, idx);
  assert.equal(dflt('= "Ohne Angabe"').scala, 'Channel.`Ohne Angabe`');
  assert.equal(dflt('= "`Ohne Angabe`"').scala, 'Channel.`Ohne Angabe`');
  assert.equal(dflt('= "type"').scala, 'Channel.`type`');
  assert.equal(dflt('= "Mail"').scala, 'Channel.Mail');
});

test('renaming an enum value: FEEL and Scala defaults and examples follow', () => {
  const types = [
    { id: 'e', name: 'ReceivingSystem', kind: 'enum', values: [{ name: 'ONLY GAMIFICATION' }, { name: 'ONLY GAMIFICATION X' }] },
    { id: 'In', name: 'In', kind: 'case', root: true, fields: [
      { id: 'f', name: 'system', type: 'e', optional: true, default: '= "ONLY GAMIFICATION"', example: 'ReceivingSystem.`ONLY GAMIFICATION`' },
      { id: 'g', name: 'all', type: 'e', collection: true, example: '= ["ONLY GAMIFICATION", "ONLY GAMIFICATION X"]' },
      { id: 'h', name: 'text', type: 'String', example: '= "ONLY GAMIFICATION"' },
    ] },
  ];
  const next = renameEnumValue(types as never, 'e', 0, 'ONLY_GAMIFICATION');
  assert.deepEqual(next[1].fields?.map(f => [f.default, f.example]), [
    ['= "ONLY_GAMIFICATION"', 'ReceivingSystem.ONLY_GAMIFICATION'],
    [undefined, '= ["ONLY_GAMIFICATION", "ONLY GAMIFICATION X"]'],
    // another type: untouched
    [undefined, '= "ONLY GAMIFICATION"'],
  ]);
  assert.ok(!('default' in next[1].fields![1]));
});

test('a line break or control character in a name is an error, not a warning', () => {
  const errors = (t: object) => checkTypes([t] as never).filter(i => !i.warn);
  assert.equal(errors({ id: 'c', name: 'X', kind: 'case', fields: [{ id: 'f', name: 'a\nb', type: 'String' }] }).filter(i => i.field === 'f').length, 1);
  assert.equal(errors({ id: 'c', name: 'X', kind: 'case', fields: [{ id: 'f', name: 'a\tb', type: 'String' }] }).filter(i => i.field === 'f').length, 1);
  assert.equal(errors({ id: 'e', name: 'E', kind: 'enum', values: [{ name: 'a\nb' }] }).length, 1);
  assert.equal(errors({ id: 'e', name: 'E', kind: 'enum', values: [{ name: 'a b' }] }).length, 0);
});

test('backticks inside comments do not open a name', () => {
  const src = `package ${PKG}.schema

case class Commented(
    /* use \`a (b\` or \`c */
    first: String, // see \`x (\`
    /** the \`)\` one */
    \`second (2)\`: Int
)

enum Doc:
  case Brief( // \`(\`
      empfaenger: String /* \`)\` */
  )
  case Mail(to: String)
end Doc
`;
  const scanned = scanScala(src, 'Commented.scala');
  assert.deepEqual(scanned.find(t => t.name === 'Commented')!.fields?.map(f => f.name), ['first', 'second (2)']);
  assert.deepEqual(scanned.find(t => t.name === 'Doc')!.cases?.map(c => [c.name, c.fields?.map(f => f.name)]), [['Brief', ['empfaenger']], ['Mail', ['to']]]);
});

test('an ADT with names in backticks: shared def, case, object, end and a field typed to a case', () => {
  const r = enrichSpec({ ...importBpmn(bpmn, 'send-event').spec, project: 'acme-demo' }, domain(), null)!;
  const spec = { ...r.spec, types: [
    ...(r.spec.types ?? []),
    { id: 't-doc', name: 'DocContent', kind: 'enum', fields: [{ id: 'c1', name: 'type', type: 'String' }],
      values: [{ name: 'QR-Rechnung', fields: [{ id: 'q1', name: 'betrag Franken', type: 'BigDecimal' }] }, { name: 'Brief', fields: [{ id: 'b1', name: 'empfaenger', type: 'String' }] }] },
    { id: 't-use', name: 'UsesDoc', kind: 'case', fields: [{ id: 'u1', name: 'qr', type: 't-doc', enumCase: 'QR-Rechnung' }] },
  ] } as never;
  const code = scalaFiles(spec, { domainTypes: domain() } as never).map(f => f.content).join('\n');
  assert.match(code, /def `type`: String/);
  assert.match(code, /case `QR-Rechnung`\(/);
  assert.match(code, /`betrag Franken`: BigDecimal/);
  assert.match(code, /object `QR-Rechnung`:/);
  assert.match(code, /end `QR-Rechnung`/);
  assert.match(code, /qr: DocContent\.`QR-Rechnung`/);
  assert.ok(!/``/.test(code), 'no doubled backticks');
});

test('renaming an enum value: not to an empty, unwritable or taken name', () => {
  const types = [{ id: 'e', name: 'E', kind: 'enum', values: [{ name: 'A B' }, { name: 'C' }] }];
  for (const name of ['', ' A', 'a`b', 'a\nb', 'C']) assert.equal(renameEnumValue(types as never, 'e', 0, name), types, JSON.stringify(name));
  assert.deepEqual(renameEnumValue(types as never, 'e', 0, 'AB')[0].values?.map(v => v.name), ['AB', 'C']);
});

test('a lone _ is no name - not even in backticks (Scala 3: wildcard invalid as backquoted identifier)', () => {
  const errors = (t: object) => checkTypes([t] as never).filter(i => !i.warn);
  assert.equal(errors({ id: 'e', name: 'E', kind: 'enum', values: [{ name: '_' }] }).length, 1);
  assert.equal(errors({ id: 'c', name: 'X', kind: 'case', fields: [{ id: 'f', name: '_', type: 'String' }] }).length, 1);
  assert.equal(errors({ id: 't', name: '_', kind: 'enum', values: [{ name: 'A' }] }).length, 1);
});

test('a stray backtick in a string or a comment does not swallow the parameters after it', () => {
  const src = `package ${PKG}.schema

case class Stray(
    @description("use \`x, " + "or y")
    first: String, // a \`stray one
    second: Option[Int] = Some(1),
    third: Boolean
)
`;
  const t = scanScala(src, 'Stray.scala').find(x => x.name === 'Stray')!;
  assert.deepEqual(t.fields?.map(f => [f.name, f.type, f.default]), [['first', 'String', undefined], ['second', 'Option[Int]', 'Some(1)'], ['third', 'Boolean', undefined]]);
  assert.equal(t.fields![0].description, 'use `x, or y');
});

test('round trip: an ADT with a dot and a colon in case and field names - exported, then read again', () => {
  const r = enrichSpec({ ...importBpmn(bpmn, 'send-event').spec, project: 'acme-demo' }, domain(), null)!;
  const spec = { ...r.spec, types: [
    ...(r.spec.types ?? []),
    { id: 't-doc', name: 'DocContent', kind: 'enum',
      values: [{ name: 'Nr.1:QR', fields: [{ id: 'q1', name: 'betrag (CHF)', type: 'BigDecimal' }] }, { name: 'Brief', fields: [{ id: 'b1', name: 'a:b', type: 'String' }] }] },
  ] } as never;
  const file = scalaFiles(spec, { domainTypes: domain() } as never).find(f => /enum DocContent/.test(f.content))!;
  const back = scanScala(file.content, 'DocContent.scala').find(t => t.name === 'DocContent')!;
  assert.deepEqual(back.cases?.map(c => [c.name, c.fields?.map(f => [f.name, f.type])]), [
    ['`Nr.1:QR`', [['betrag (CHF)', 'BigDecimal']]],
    ['Brief', [['a:b', 'String']]],
  ]);
});

test('an error of an enum value stands at the value, like its warning - also for an empty one', () => {
  const issues = checkTypes([{ id: 'e', name: 'E', kind: 'enum', values: [{ name: 'a`b' }, { name: '' }, { name: 'ONLY GAMIFICATION' }] }] as never);
  assert.deepEqual(issues.filter(i => i.value !== undefined).map(i => [i.value, !!i.warn]), [['a`b', false], ['', false], ['ONLY GAMIFICATION', true]]);
});

test('renaming an enum value: a longer path with the same ending stays', () => {
  const types = [
    { id: 'e', name: 'In', kind: 'enum', values: [{ name: 'Foo' }, { name: 'Bar' }] },
    { id: 'c', name: 'Uses', kind: 'case', fields: [
      { id: 'f', name: 'a', type: 'e', example: 'MyIn.Foo' },
      { id: 'g', name: 'b', type: 'e', example: 'In.Foo' },
      { id: 'h', name: 'c', type: 'e', example: 'X.In.Foo' },
    ] },
  ];
  const next = renameEnumValue(types as never, 'e', 0, 'Baz');
  assert.deepEqual(next[1].fields?.map(f => f.example), ['MyIn.Foo', 'In.Baz', 'X.In.Foo']);
});

test('suggestions: umlauts and accents are written out, no letter gets lost', () => {
  assert.equal(nameSuggestion('field', 'Größe'), 'groesse');
  assert.equal(nameSuggestion('type', 'Vermögens Verwaltung'), 'VermoegensVerwaltung');
  assert.equal(nameSuggestion('value', 'ÜBER ALLES'), 'UEBER_ALLES');
  assert.equal(nameSuggestion('field', 'Straße Nr'), 'strasseNr');
  assert.equal(nameSuggestion('type', 'Café Bar'), 'CafeBar');
  // nothing to write out — no suggestion rather than a mangled one
  assert.equal(nameSuggestion('field', '名前 x'), undefined);
});
