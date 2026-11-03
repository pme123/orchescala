// The process variables come from where they are created: In, InitIn, InConfig,
// outputs and results of the steps, the engine. The list `spec.variables` only adds
// the Bedeutung - a type stored there from an older state must not hide the real one.
// Two sources with different types are a conflict; an entry no source knows is
// reported, but stays (a script or listener may set it).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scanScala } from '../src/domainScan';
import { collectionNode, processVariables, variableOverview, variablesByStep } from '../src/feel';
import { collectFindings, PROCESS_FINDINGS, variableConflictRule } from '../src/findings';
import { allSteps } from '../src/bpmn';
import type { Model, ProcessSpec, Step, TypeDef } from '../src/types';

const source = `package acme.print.domain.print.v1

object GetPrintContent extends CompanyBpmnServiceTaskDsl:
  val topicName = "acme-print-get"
  val descr: String = ""
  case class In(clientKey: Long)
  case class PrintContent(docId: String, pages: Int)
  case class Out(contentForPrinting: Seq[PrintContent], total: Int)
end GetPrintContent
`;
const model = { domainTypes: scanScala(source, 'GetPrintContent.scala') } as unknown as Model;
const printContent = model.domainTypes!.find(t => t.name === 'GetPrintContent.PrintContent')!;

const get: Step = {
  id: 'GetTask', name: 'Get Print Content', kind: 'service', topic: 'acme-print-get',
  outputs: [{ name: 'contentForPrinting', expression: '= contentForPrinting' }],
} as Step;

const spec = (extra: Partial<ProcessSpec> = {}, rootFields: TypeDef['fields'] = []): ProcessSpec => ({
  processId: 'acme-printV1', name: 'acme-printV1', engine: 'c8', steps: [get],
  types: [{ id: 't-in', name: 'In', kind: 'case', root: true, fields: rootFields }],
  ...extra,
} as unknown as ProcessSpec);

test('priority: a stored type of spec.variables does not hide the type of the source - the Bedeutung stays', () => {
  const s = spec({ variables: [{ name: 'contentForPrinting', type: 'Seq[OldContent]', description: 'Die Dokumente zum Drucken' }] });
  const v = processVariables(s, model).find(x => x.name === 'contentForPrinting')!;
  assert.equal(v.source, 'Ausgabe von Get Print Content');
  assert.equal(v.label, 'Seq[PrintContent]');
  assert.deepEqual(v.children?.map(c => c.name), ['docId', 'pages']);
  assert.equal(v.description, 'Die Dokumente zum Drucken');
  assert.deepEqual(variableOverview(s, model).orphans, []);
});

test('priority: a changed type of the worker is what the variable has - nothing hand-kept in between', () => {
  const changed = { domainTypes: scanScala(source.replace('Seq[PrintContent]', 'Seq[String]'), 'GetPrintContent.scala') } as unknown as Model;
  const s = spec({ variables: [{ name: 'contentForPrinting', type: 'Seq[PrintContent]' }] });
  assert.equal(processVariables(s, changed).find(x => x.name === 'contentForPrinting')?.label, 'Seq[String]');
});

test('priority: the own data model of the process wins over the catalog', () => {
  const ownWorker = { domainTypes: scanScala(source.replaceAll('acme-print-get', 'acme-printV1-get'), 'GetPrintContent.scala') } as unknown as Model;
  const own = (outTypeId?: string): ProcessSpec => ({
    processId: 'acme-printV1', name: 'acme-printV1', engine: 'c8',
    steps: [{ id: 'GetTask', name: 'Get Print Content', kind: 'service', topic: 'acme-printV1-get' } as Step],
    interactions: outTypeId ? [{ id: 'ia', stepId: 'GetTask', kind: 'customTask', name: 'GetPrintContent', key: 'acme-printV1-get', outTypeId }] : [],
    types: [{ id: 't-out', name: 'Out', kind: 'case', interactionId: 'ia', fields: [{ id: 'f1', name: 'total', type: 'Long' }] }],
  } as unknown as ProcessSpec);
  // without its own interaction: the Out of the catalog
  assert.equal(processVariables(own(), ownWorker).find(x => x.name === 'total')?.label, 'Int');
  const v = processVariables(own('t-out'), ownWorker).find(x => x.name === 'total')!;
  assert.equal(v.label, 'Long');
  assert.equal(v.source, 'Ergebnis von Get Print Content');
});

test('priority: an untyped source does not hide a typed one', () => {
  const s = spec({ steps: [{ ...get, outputs: [{ name: 'total', expression: '= total + 1' }, { name: 'contentForPrinting', expression: '= contentForPrinting' }] } as Step] },
    [{ id: 'f', name: 'total', type: 'Int' }]);
  const v = processVariables(s, model).find(x => x.name === 'total')!;
  assert.equal(v.source, 'In');
  assert.equal(v.label, 'Int');
  assert.deepEqual(variableOverview(s, model).conflicts, []);
});

test('conflict: In and the output of a worker give the same name different types', () => {
  const s = spec({}, [{ id: 'f', name: 'contentForPrinting', type: 'String', collection: true }]);
  const { conflicts, variables } = variableOverview(s, model);
  assert.deepEqual(conflicts.map(c => c.name), ['contentForPrinting']);
  assert.deepEqual(conflicts[0].sources.map(x => `${x.source}: ${x.label}`), ['In: Seq[String]', 'Ausgabe von Get Print Content: Seq[PrintContent]']);
  // the first source stays effective - the conflict is reported, not decided silently
  assert.equal(variables.find(v => v.name === 'contentForPrinting')?.node.source, 'In');
});

test('no conflict: the same class, once with its object and once without, and Option of it', () => {
  const s = spec({}, [{ id: 'f', name: 'contentForPrinting', type: `domain:${printContent.id}`, collection: true, optional: true }]);
  const { conflicts, variables } = variableOverview(s, model);
  assert.deepEqual(conflicts, []);
  assert.deepEqual(variables.find(v => v.name === 'contentForPrinting')?.sources.map(x => x.source), ['In', 'Ausgabe von Get Print Content']);
});

test('no conflict: the required twin in the InitIn of an optional In field', () => {
  const s = spec({
    types: [
      { id: 't-in', name: 'In', kind: 'case', root: true, fields: [{ id: 'f1', name: 'copies', type: 'Int', optional: true, default: '1' }] },
      { id: 't-init', name: 'InitIn', kind: 'case', initIn: true, fields: [{ id: 'f2', name: 'copies', type: 'Int' }] },
    ],
  } as Partial<ProcessSpec>);
  assert.deepEqual(variableOverview(s, model).conflicts, []);
});

test('orphan: an entry no source knows is reported - and stays a variable', () => {
  const s = spec({ variables: [{ name: 'fromScript', description: 'setzt ein Listener' }, { name: 'contentForPrinting' }, { name: '' }] });
  const { orphans, variables } = variableOverview(s, model);
  assert.deepEqual(orphans, ['fromScript']);
  const info = variables.find(v => v.name === 'fromScript')!;
  assert.equal(info.orphan, true);
  assert.deepEqual(info.sources, []);
  assert.ok(processVariables(s, model).some(v => v.name === 'fromScript' && v.source === 'Variable'));
});

test('overview: every variable with its source - engine variables included', () => {
  const s = spec({}, [{ id: 'f', name: 'clientKey', type: 'Long' }]);
  const byName = new Map(variableOverview(s, model).variables.map(v => [v.name, v]));
  assert.equal(byName.get('clientKey')?.sources[0].source, 'In');
  assert.equal(byName.get('contentForPrinting')?.sources[0].source, 'Ausgabe von Get Print Content');
  assert.equal(byName.get('businessKey')?.sources[0].source, 'Engine');
});

test('findings: conflict and orphan are warnings on the process - naming both sources and types', () => {
  const s = spec({ variables: [{ name: 'fromScript' }] }, [{ id: 'f', name: 'contentForPrinting', type: 'String', collection: true }]);
  const f = collectFindings(s, model, allSteps(s.steps)).get(PROCESS_FINDINGS)!;
  assert.deepEqual(f.errors, []);
  assert.equal(f.warnings.length, 2);
  assert.match(f.warnings[0], /«contentForPrinting».*In sagt Seq\[String\], später schreibt Seq\[PrintContent\] \(Ausgabe von Get Print Content\)/);
  assert.match(f.warnings[1], /«fromScript» kommt von nirgends — woher\?/);
  // without either: no finding on the process
  assert.equal(collectFindings(spec(), model, allSteps(spec().steps)).has(PROCESS_FINDINGS), false);
});

test('conflict: a stale InitIn and a later writer - the warning says so, at the step after the writer its type applies', () => {
  const s = spec({
    steps: [get, { id: 'PrintTask', name: 'Print', kind: 'service', topic: 'acme-print-do', multiInstance: { collection: 'contentForPrinting', element: 'printContent' } } as Step],
    types: [
      { id: 't-in', name: 'In', kind: 'case', root: true, fields: [] },
      { id: 't-init', name: 'InitIn', kind: 'case', initIn: true, fields: [{ id: 'f', name: 'contentForPrinting', type: 't-old', collection: true }] },
      { id: 't-old', name: 'OldDoc', kind: 'case', fields: [{ id: 'f2', name: 'docId', type: 'String' }] },
    ],
  } as Partial<ProcessSpec>);
  const conflict = variableOverview(s, model).conflicts.find(c => c.name === 'contentForPrinting')!;
  assert.equal(variableConflictRule(conflict),
    'InitIn sagt Seq[OldDoc], später schreibt Seq[PrintContent] (Ausgabe von Get Print Content) — ab dort gilt der Typ des letzten Schreibers; ist InitIn veraltet?');
  const at = variablesByStep(s, model);
  assert.equal(collectionNode('contentForPrinting', at.get('GetTask')!)?.label, 'Seq[OldDoc]');
  assert.equal(collectionNode('contentForPrinting', at.get('PrintTask')!)?.label, 'Seq[PrintContent]');
});

test('conflict between two steps, or two sources at the start - the rule says which applies', () => {
  const byStep = variableConflictRule({ name: 'x', sources: [
    { source: 'Ausgabe von A', label: 'Int', type: 'number' }, { source: 'Ergebnis von B', label: 'String', type: 'string' }] });
  assert.equal(byStep, 'Int (Ausgabe von A) · String (Ergebnis von B) — an einem Schritt gilt der Typ des letzten Schreibers davor.');
  const atStart = variableConflictRule({ name: 'x', sources: [
    { source: 'In', label: 'Int', type: 'number' }, { source: 'InConfig', label: 'String', type: 'string' }] });
  assert.equal(atStart, 'Int (In) · String (InConfig) — es gilt Int.');
});

test('the collected results of a multi-instance are a source - typed by what the instance knows', () => {
  const s = spec({
    variables: [{ name: 'printed', description: 'die gedruckten Dokumente' }],
    steps: [get, { id: 'PrintTask', name: 'Print', kind: 'service', topic: 'acme-print-do',
      multiInstance: { collection: 'contentForPrinting', element: 'printContent', result: { collection: 'printed', element: '{docId: printContent.docId}' } } } as Step],
  });
  const { variables, orphans } = variableOverview(s, model);
  assert.deepEqual(orphans, []);
  const printed = variables.find(v => v.name === 'printed')!;
  assert.equal(printed.node.source, 'Ergebnisse von Print');
  assert.equal(printed.node.type, 'list');
  assert.deepEqual(printed.node.children?.map(c => `${c.name}: ${c.label}`), ['docId: String']);
  assert.equal(printed.node.description, 'die gedruckten Dokumente');
  // known only after the multi-instance - no process variable from the start
  assert.equal(printed.after, 'Print');
  assert.equal(processVariables(s, model).some(v => v.name === 'printed'), false);
});
