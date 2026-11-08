// The AI mode for a service orchestration (a process in service mode): its own task and skill
// (serviceOrchestrator), only service steps, the services of the collections and the catalog.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { orchestrationSystem, processPrompt, processSystem } from '../src/ai/context';
import { aiFor, parseConfig } from '../src/ai/config';
import { callableTopics, newProcessErrors, processToolKit, runProcessTool, startProcessDraft, type ProcessContext } from '../src/ai/processTools';
import { orchestrationTargets } from '../src/pages/designer/model';
import { newCollection } from '../src/services/collection';
import { newServiceProcess, withCollections } from '../src/services/serviceProcess';
import type { CollectionService, ServiceCollectionSpec } from '../src/services/types';
import type { Model, TypeDef } from '../src/types';

const g = globalThis as unknown as { DOMParser: unknown; XMLSerializer: unknown };
g.DOMParser ??= DOMParser;
g.XMLSerializer ??= class { serializeToString(doc: { toString(): string }) { return doc.toString(); } };

const t = (id: string, name: string, fields: Array<[string, string, boolean?]>, interactionId?: string): TypeDef =>
  ({ id, name, kind: 'case', ...(interactionId ? { interactionId } : {}), fields: fields.map(([n, type, optional]) => ({ id: `${id}-${n}`, name: n, type, ...(optional ? { optional: true } : {}) })) });
const svc = (id: string, name: string, method: 'GET' | 'PUT', extra: Partial<CollectionService> = {}): CollectionService =>
  ({ id, name, api: 'client', apiVersion: 1, status: 'implemented', method, path: '/clients/{clientKey}', params: [], inTypeId: `${id}-in`, outTypeId: `${id}-out`, ...extra });
const collection: ServiceCollectionSpec = {
  ...newCollection({ title: 'Client', project: 'acme-crm', api: 'client', apiVersion: 1 }),
  types: [
    t('get-in', 'In', [['clientKey', 'Long']], 'get'), t('get-out', 'Out', [['name', 'String'], ['active', 'Boolean']], 'get'),
    t('put-in', 'In', [['clientKey', 'Long'], ['name', 'String']], 'put'), t('put-out', 'Out', [], 'put'),
  ],
  services: [svc('get', 'GetClient', 'GET'), svc('put', 'PutClient', 'PUT', { noOut: true })],
};

/** the model of the process view in service mode: the catalog (one worker) and the collection */
const catalog = { services: [{ id: 'acme-crm-notifyPost', name: 'Post melden', topic: 'acme-crm-notifyPost', kind: 'service' }], domainTypes: [] } as unknown as Model;
const model = withCollections(catalog, [collection]);
const ctx: ProcessContext = { model, serviceMode: true };
const PUT = 'acme-crm-clientV1.PutClient';

const draft = () => {
  const { spec, xml } = newServiceProcess({ title: 'Kunde ändern', project: 'acme-crm', api: 'client', apiVersion: 1, name: 'UpdateClient' });
  return startProcessDraft(spec, xml);
};

test('the services an orchestration can call - the collection and the catalog, with In/Out', () => {
  const targets = orchestrationTargets(model!);
  assert.deepEqual(targets.map((s) => s.topic), ['acme-crm-clientV1.GetClient', 'acme-crm-clientV1.PutClient', 'acme-crm-notifyPost']);
  assert.deepEqual(targets[0].out.map((f) => f.name), ['name', 'active']);
  assert.deepEqual(targets[1].in.map((f) => f.name), ['clientKey', 'name']);
  assert.deepEqual([...callableTopics(ctx)].sort(), targets.map((s) => s.topic));
  // the workers of a process are not what an orchestration calls - and vice versa
  assert.equal(callableTopics({ model, serviceMode: false }).has(PUT), false);
});

test('service mode - only service steps with a service of the orchestration; the tool says why', () => {
  const d = draft();
  const after = d.spec.steps.find((s) => s.kind === 'service')!.id;
  const user = runProcessTool('add_step', { after, kind: 'user', name: 'Freigeben' }, d, ctx);
  assert.equal(user.isError, true);
  assert.match(user.content, /Orchestrierung ist ein Worker/);
  assert.equal(runProcessTool('add_step', { after, kind: 'timer', name: 'Warten', timer: 'P1D' }, d, ctx).isError, true);
  assert.equal(runProcessTool('add_step', { after, kind: 'service', name: 'Ohne' }, d, ctx).isError, true); // no topic
  const unknown = runProcessTool('add_step', { after, kind: 'service', name: 'X', topic: 'acme-crm-invented' }, d, ctx);
  assert.equal(unknown.isError, true);
  assert.match(unknown.content, /kann die Orchestrierung nicht aufrufen/);

  const put = runProcessTool('add_step', { after, kind: 'service', name: 'Kunde schreiben', topic: PUT }, d, ctx);
  assert.equal(put.isError, undefined, put.content);
  const step = put.draft.spec.steps.find((s) => s.name === 'Kunde schreiben');
  assert.equal(step?.kind, 'service');
  assert.equal(step?.topic, PUT);
});

test('service mode - add_step offers only service and end, no timer', () => {
  const add = processToolKit(ctx).tools.find((x) => x.name === 'add_step')!;
  const props = add.input_schema.properties as Record<string, { enum?: string[] }>;
  assert.deepEqual(props.kind.enum, ['service', 'end']);
  assert.equal(props.timer, undefined);
  // a process keeps all kinds
  const inProcess = processToolKit({ model }).tools.find((x) => x.name === 'add_step')!.input_schema.properties as Record<string, { enum?: string[] }>;
  assert.deepEqual(inProcess.kind.enum, ['user', 'service', 'manual', 'end', 'timer']);
});

test('the system - only the context: the services of the orchestration, the workers of a process; the instructions are the skills\'', () => {
  const orch = orchestrationSystem(orchestrationTargets(model!));
  assert.equal(orch.length, 1);
  assert.equal(orch[0].cache_control?.type, 'ephemeral');
  assert.match(orch[0].text, /acme-crm-clientV1\.PutClient \(PutClient\)\n  In: \{clientKey: Long, name: String\}/);
  const proc = processSystem({ services: [], processes: [{ key: 'acme-x', title: 'X', in: [] }], messages: [], userTasks: [] });
  assert.equal(proc.length, 1);
  assert.doesNotMatch([...orch, ...proc].map((b) => b.text).join('\n'), /You help a requirements engineer/);
  assert.match(processPrompt('Kunde ändern', 'acme-x', 'Bitte', true), /^Die Orchestrierung im Entwurf/);
  assert.match(processPrompt('Adresse', 'acme-y', 'Bitte'), /^Der Prozess im Entwurf/);
});

test('the AI of an orchestration only with its own skill - not with the one for processes', () => {
  const onlyProcesses = parseConfig({ enabled: true, tasks: ['processCreator'] });
  assert.equal(aiFor(onlyProcesses, 'processCreator'), true);
  assert.equal(aiFor(onlyProcesses, 'serviceOrchestrator'), false);
  assert.equal(aiFor(parseConfig({ enabled: true, tasks: ['serviceOrchestrator'] }), 'serviceOrchestrator'), true);
});

test('service mode - the inputs of a new step are the RE\'s to map: in the findings, not to correct', () => {
  const d = draft();
  const after = d.spec.steps.find((s) => s.kind === 'service')!.id;
  const put = runProcessTool('add_step', { after, kind: 'service', name: 'Kunde schreiben', topic: PUT }, d, ctx);
  assert.match(put.content, /KundeSchreibenTask «Kunde schreiben»: Pflichtfeld «clientKey» fehlt in den Eingaben/); // Claude sees them
  assert.deepEqual(newProcessErrors(put.draft, ctx), []);
  // in a process the same error is Claude's to correct
  assert.deepEqual(newProcessErrors(put.draft, { model, serviceMode: false }).filter((l) => l.includes('Pflichtfeld')).length, 2);
});
