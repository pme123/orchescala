// The AI mode, stage B (processes) - without network: the operations on the BPMN (insert a step, a
// decision, an error path, remove, rename) with their layout, the spec that follows the diagram, the
// findings and the conversation with a mocked Claude.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { allSteps, importBpmn } from '../src/bpmn';
import { runTurn, type Send } from '../src/ai/agent';
import { insertDecision, insertErrorPath, insertStep, removeStep, renameElement } from '../src/ai/bpmnEdit';
import {
  newProcessErrors, processDraftChanged, processOutline, processToolKit, runProcessTool, startProcessDraft, type ProcessContext,
} from '../src/ai/processTools';
import type { Model, ProcessSpec } from '../src/types';
import { installXmlNamespaces } from './xmlNamespaces';

const g = globalThis as unknown as Record<string, unknown>;
g.DOMParser ??= DOMParser;
g.XMLSerializer ??= class { serializeToString(doc: { toString(): string }) { return doc.toString(); } };
installXmlNamespaces();

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" id="d" targetNamespace="x">
  <bpmn:process id="acme-crm-changeAddressV1" name="Adresse ändern" isExecutable="true">
    <bpmn:startEvent id="StartProcessStartEvent" name="Adresse erfasst">
      <bpmn:outgoing>f1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:userTask id="CheckAddressTask" name="Adresse prüfen">
      <bpmn:incoming>f1</bpmn:incoming>
      <bpmn:outgoing>f2</bpmn:outgoing>
    </bpmn:userTask>
    <bpmn:endEvent id="ChangedEndEvent" name="geändert">
      <bpmn:incoming>f2</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="f1" sourceRef="StartProcessStartEvent" targetRef="CheckAddressTask" />
    <bpmn:sequenceFlow id="f2" sourceRef="CheckAddressTask" targetRef="ChangedEndEvent" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="dia">
    <bpmndi:BPMNPlane id="plane" bpmnElement="acme-crm-changeAddressV1">
      <bpmndi:BPMNShape id="s0" bpmnElement="StartProcessStartEvent"><dc:Bounds x="100" y="100" width="36" height="36" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="s1" bpmnElement="CheckAddressTask"><dc:Bounds x="190" y="78" width="100" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="s2" bpmnElement="ChangedEndEvent"><dc:Bounds x="350" y="100" width="36" height="36" /></bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="e1" bpmnElement="f1"><di:waypoint x="136" y="118" /><di:waypoint x="190" y="118" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="e2" bpmnElement="f2"><di:waypoint x="290" y="118" /><di:waypoint x="350" y="118" /></bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

const pkg = 'acme.crm.domain';
const model = {
  version: 1, services: [],
  domainTypes: [
    { id: `${pkg}.ValidateAddress.In`, name: 'ValidateAddress.In', pkg, kind: 'member', importPath: '', topicName: 'acme-crm-validateAddress', dsl: 'CustomTask', fields: [{ name: 'street', type: 'String' }] },
    { id: `${pkg}.ValidateAddress.Out`, name: 'ValidateAddress.Out', pkg, kind: 'member', importPath: '', topicName: 'acme-crm-validateAddress', dsl: 'CustomTask', fields: [{ name: 'valid', type: 'Boolean' }] },
  ],
} as unknown as Model;
const ctx: ProcessContext = { model };

const spec = (): ProcessSpec => ({
  ...importBpmn(xml, 'test.bpmn').spec,
  slug: 'acme-crm-changeaddressv1', title: 'Adresse ändern', engine: 'c7',
  steps: importBpmn(xml, 'test.bpmn').spec.steps.map((s) => (s.id === 'CheckAddressTask' ? { ...s, description: 'Sachbearbeitung prüft die neue Adresse.' } : s)),
});

const doc = (x: string) => new DOMParser().parseFromString(x, 'text/xml') as unknown as Document;
const all = (e: Element): Element[] => Array.from(e.children).flatMap((c) => [c, ...all(c)]);
const elements = (x: string) => all(doc(x).documentElement);
const byId = (x: string, id: string) => elements(x).find((e) => e.getAttribute('id') === id) ?? null;
const bounds = (x: string, el: string) => {
  const shape = elements(x).find((e) => e.getAttribute('bpmnElement') === el && (e.tagName.endsWith('Shape')));
  const b = shape?.firstElementChild;
  return b ? [Number(b.getAttribute('x')), Number(b.getAttribute('y')), Number(b.getAttribute('width'))] : null;
};
const ids = (x: string) => allSteps(importBpmn(x, 't.bpmn').spec.steps).map((s) => s.id);

// ---------------------------------------------------------------- the diagram

test('insertStep - a service task on the flow, wired and laid out: what follows moves right', () => {
  const r = insertStep(xml, 'c7', 'CheckAddressTask', { kind: 'service', name: 'Adresse validieren', topic: 'acme-crm-validateAddress' });
  assert.ok(r.ok);
  assert.equal(r.id, 'AdresseValidierenTask'); // the convention of the app: name + suffix
  const task = byId(r.xml, r.id)!;
  assert.equal(task.getAttribute('camunda:topic'), 'acme-crm-validateAddress');
  assert.equal(task.getAttribute('camunda:type'), 'external');
  assert.deepEqual(ids(r.xml), ['StartProcessStartEvent', 'CheckAddressTask', 'AdresseValidierenTask', 'ChangedEndEvent']);
  assert.deepEqual(bounds(r.xml, r.id), [350, 78, 100]); // where the end was
  assert.deepEqual(bounds(r.xml, 'ChangedEndEvent'), [500, 100, 36]); // moved by 100 + 50
  assert.deepEqual(bounds(r.xml, 'CheckAddressTask'), [190, 78, 100]); // before: stays
  // Camunda 8: the topic in the task definition
  const c8 = insertStep(xml, 'c8', 'CheckAddressTask', { kind: 'service', name: 'Adresse validieren', topic: 'acme-crm-validateAddress' });
  assert.ok(c8.ok && /zeebe:taskDefinition type="acme-crm-validateAddress"/.test(c8.xml));
});

test('insertStep - what does not fit changes nothing', () => {
  assert.deepEqual(insertStep(xml, 'c7', 'Nope', { kind: 'user', name: 'X' }), { ok: false, error: 'Ein Element «Nope» gibt es im Diagramm nicht.' });
  const atEnd = insertStep(xml, 'c7', 'ChangedEndEvent', { kind: 'user', name: 'X' });
  assert.ok(!atEnd.ok && /keinen Ausgang/.test(atEnd.error));
  const endMid = insertStep(xml, 'c7', 'StartProcessStartEvent', { kind: 'end', name: 'Schluss' });
  assert.ok(!endMid.ok && /schneidet den Rest ab/.test(endMid.error));
  const noTopic = insertStep(xml, 'c7', 'CheckAddressTask', { kind: 'service', name: 'X' });
  assert.ok(!noTopic.ok);
  // an end at an end: it only gets the name
  const named = insertStep(xml, 'c7', 'CheckAddressTask', { kind: 'end', name: 'Adresse geändert' });
  assert.ok(named.ok && named.id === 'ChangedEndEvent' && /name="Adresse geändert"/.test(named.xml));
});

test('insertDecision - first branch goes on, the others end; conditions in the form of the engine', () => {
  const r = insertDecision(xml, 'c7', 'CheckAddressTask', 'Adresse gültig?', [
    { label: 'ja', condition: 'valid = true' }, { label: 'nein', isDefault: true },
  ]);
  assert.ok(r.ok);
  const s = importBpmn(r.xml, 't.bpmn').spec;
  const gw = allSteps(s.steps).find((x) => x.id === r.id)!;
  assert.equal(gw.kind, 'gateway');
  assert.deepEqual(gw.branches?.map((b) => [b.label, b.isDefault ?? false, b.steps.map((x) => x.kind)]), [['ja', false, ['end']], ['nein', true, ['end']]]);
  assert.match(r.xml, /\$\{valid == true\}|\$\{valid eq true\}|\$\{valid\s*==\s*true\}/);
  // a step into the «nein» branch
  const into = insertStep(r.xml, 'c7', r.id, { kind: 'user', name: 'Kunde anrufen' }, 'nein');
  assert.ok(into.ok);
  const s2 = importBpmn(into.xml, 't.bpmn').spec;
  const nein = allSteps(s2.steps).find((x) => x.id === r.id)!.branches!.find((b) => b.label === 'nein')!;
  assert.deepEqual(nein.steps.map((x) => x.name), ['Kunde anrufen', 'nein']);
  // several ways out: which one?
  const which = insertStep(r.xml, 'c7', r.id, { kind: 'user', name: 'X' });
  assert.ok(!which.ok && /mehrere Ausgänge.*ja, nein/.test(which.error));
  assert.ok(!insertDecision(xml, 'c7', 'CheckAddressTask', 'X', [{ label: 'a' }, { label: 'b', isDefault: true }]).ok); // a without condition
});

test('insertErrorPath - boundary error event with its error, a path to its own end; remove it again', () => {
  const r = insertErrorPath(xml, 'c7', 'CheckAddressTask', 'address-invalid', 'Adresse ungültig');
  assert.ok(r.ok);
  const error = byId(r.xml, 'Error_address-invalid')!;
  assert.deepEqual([error.tagName, error.getAttribute('errorCode'), error.getAttribute('name')], ['bpmn:error', 'address-invalid', 'address-invalid']);
  assert.equal(r.id, 'AdresseUngultigBoundaryEvent');
  const s = importBpmn(r.xml, 't.bpmn').spec;
  const step = allSteps(s.steps).find((x) => x.id === 'CheckAddressTask')!;
  assert.equal(step.errors?.[0].code, 'address-invalid');
  assert.deepEqual(step.errors?.[0].steps?.map((x) => x.kind), ['end']);
  // a step into the path, then the whole path away
  const into = insertStep(r.xml, 'c7', r.id, { kind: 'user', name: 'Kunde informieren' });
  assert.ok(into.ok);
  const gone = removeStep(into.xml, 'c7', r.id);
  assert.ok(gone.ok);
  assert.deepEqual(ids(gone.xml), ['StartProcessStartEvent', 'CheckAddressTask', 'ChangedEndEvent']);
  assert.ok(!/KundeInformierenTask/.test(gone.xml));
  // a step with an error path is not removed silently
  assert.ok(!removeStep(r.xml, 'c7', 'CheckAddressTask').ok);
});

test('removeStep and renameElement - the flow closes, the name changes', () => {
  const gone = removeStep(xml, 'c7', 'CheckAddressTask');
  assert.ok(gone.ok);
  assert.deepEqual(ids(gone.xml), ['StartProcessStartEvent', 'ChangedEndEvent']);
  assert.equal(byId(gone.xml, 'f1')?.getAttribute('targetRef'), 'ChangedEndEvent');
  assert.equal(byId(gone.xml, 'f2'), null);
  const renamed = renameElement(xml, 'c7', 'CheckAddressTask', 'Neue Adresse prüfen');
  assert.ok(renamed.ok && byId(renamed.xml, 'CheckAddressTask')?.getAttribute('name') === 'Neue Adresse prüfen');
});

// ---------------------------------------------------------------- the tools on the draft

test('tools - the spec follows the diagram and keeps its texts; details of a user task', () => {
  const d = startProcessDraft(spec(), xml);
  const read = runProcessTool('read_process', {}, d, ctx);
  assert.match(read.content, /CheckAddressTask \[user\] «Adresse prüfen» – Sachbearbeitung prüft/);
  const added = runProcessTool('add_step', { after: 'CheckAddressTask', kind: 'service', name: 'Adresse validieren', topic: 'acme-crm-validateAddress' }, d, ctx);
  assert.equal(added.isError, undefined);
  assert.match(added.content, /ok – ID AdresseValidierenTask/);
  // the description of the existing step stays (mergeSpec by ID)
  assert.equal(allSteps(added.draft.spec.steps).find((s) => s.id === 'CheckAddressTask')?.description, 'Sachbearbeitung prüft die neue Adresse.');
  assert.ok(processDraftChanged(added.draft));
  const groups = runProcessTool('update_step', { id: 'CheckAddressTask', candidateGroups: 'backoffice', description: 'Neu' }, added.draft, ctx);
  const step = allSteps(groups.draft.spec.steps).find((s) => s.id === 'CheckAddressTask')!;
  assert.deepEqual([step.candidateGroups, step.description], ['backoffice', 'Neu']);
  assert.equal(runProcessTool('update_step', { id: 'AdresseValidierenTask', assignee: 'x' }, groups.draft, ctx).isError, true); // not a user task
  // the base stays untouched
  assert.equal(d.spec.steps.length, 3);
});

test('tools - a worker that is not in the data model is not invented', () => {
  const d = startProcessDraft(spec(), xml);
  const r = runProcessTool('add_step', { after: 'CheckAddressTask', kind: 'service', name: 'Post melden', topic: 'acme-crm-notifyPost' }, d, ctx);
  assert.equal(r.isError, true);
  assert.match(r.content, /report_open_point/);
  assert.equal(r.draft, d);
  assert.equal(runProcessTool('add_step', { after: 'CheckAddressTask', kind: 'loop', name: 'X' }, d, ctx).isError, true);
  assert.equal(runProcessTool('drop_database', {}, d, ctx).isError, true);
  const point = runProcessTool('report_open_point', { text: 'Worker notifyPost fehlt' }, d, ctx);
  assert.deepEqual(point.draft.openPoints, ['Worker notifyPost fehlt']);
});

test('processOutline - branches with condition, error paths with their boundary event', () => {
  const r = insertDecision(xml, 'c7', 'CheckAddressTask', 'Gültig?', [{ label: 'ja', condition: 'valid' }, { label: 'nein', isDefault: true }]);
  assert.ok(r.ok);
  const lines = processOutline(importBpmn(r.xml, 't.bpmn').spec.steps);
  assert.ok(lines.some((l) => /\? Zweig «ja» wenn = ?valid/.test(l)), lines.join('\n'));
  assert.ok(lines.some((l) => /\? Zweig «nein» \(Standard\)/.test(l)));
});

test('runTurn - Claude adds a step to the process, the draft follows, nothing is new as error', async () => {
  const answers = [
    { content: [{ type: 'tool_use', id: 't1', name: 'read_process', input: {} }], stop_reason: 'tool_use' },
    { content: [{ type: 'tool_use', id: 't2', name: 'add_step', input: { after: 'CheckAddressTask', kind: 'user', name: 'Adresse freigeben' } }], stop_reason: 'tool_use' },
    { content: [{ type: 'text', text: 'Ich habe «Adresse freigeben» nach der Prüfung eingefügt.' }], stop_reason: 'end_turn' },
  ].map((a) => ({ ...a, id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', usage: { input_tokens: 100, output_tokens: 50 } }) as unknown as BetaMessage);
  const send: Send = async (r) => answers[r.messages.filter((m) => m.role === 'assistant').length];
  const d = startProcessDraft(spec(), xml);
  const result = await runTurn({ send, system: [], kit: processToolKit(ctx), history: [], prompt: 'Nach der Prüfung soll das Backoffice freigeben.', draft: d });
  assert.equal(result.stop, 'done');
  assert.deepEqual(allSteps(result.draft.spec.steps).map((s) => s.name), ['Adresse erfasst', 'Adresse prüfen', 'Adresse freigeben', 'geändert']);
  assert.deepEqual(newProcessErrors(result.draft, ctx), []);
});
