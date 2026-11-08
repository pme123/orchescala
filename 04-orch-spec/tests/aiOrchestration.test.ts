// The AI mode for a service orchestration (a process in service mode): its own task and skill
// (serviceOrchestrator), only service steps, the services of the collections and the catalog.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { orchestrationSystem, processPrompt, processSystem } from '../src/ai/context';
import { aiFor, parseConfig } from '../src/ai/config';
import { processDiff } from '../src/ai/diff';
import { callableTopics, newProcessErrors, processModelText, processToolKit, runProcessTool, startProcessDraft, type ProcessContext, type ProcessDraft } from '../src/ai/processTools';
import { newCollection } from '../src/services/collection';
import { newServiceProcess, orchestrationTargets, withCollections } from '../src/services/serviceProcess';
import { checkTypes } from '../src/scala';
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
const services = orchestrationTargets([collection], model);
const ctx: ProcessContext = { model, serviceMode: true, services };
const GET = 'acme-crm-clientV1.GetClient';
const PUT = 'acme-crm-clientV1.PutClient';

const draft = () => {
  const { spec, xml } = newServiceProcess({ title: 'Kunde ändern', project: 'acme-crm', api: 'client', apiVersion: 1, name: 'UpdateClient' });
  return startProcessDraft(spec, xml);
};

test('the services an orchestration can call - the same as a step (callableServices), with typed In/Out', () => {
  // a catalog entry without the topic of an API (project-apiV1.Name) is no service a step can call - so neither for the AI
  assert.deepEqual(services.map((s) => s.topic), [GET, PUT]);
  assert.deepEqual(services[0].out.map((f) => `${f.name}: ${f.type}`), ['name: String', 'active: Boolean']);
  assert.deepEqual(services[1].in.map((f) => `${f.name}: ${f.type}`), ['clientKey: Long', 'name: String']);
  assert.deepEqual(services[1].out, []); // noOut
  assert.deepEqual([...callableTopics(ctx)], services.map((s) => s.topic));
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
  const orch = orchestrationSystem(services);
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

// ---------------------------------------------------------------- the data model

const ok = (r: { isError?: boolean; content: string }) => { assert.equal(r.isError, undefined, r.content); return r; };
const typeNamed = (d: ProcessDraft, name: string) => d.spec.types?.find((t) => !t.interactionId && t.name === name);

test('data model - a choice with cases, the Out of the orchestration set to it; read back with ids and names', () => {
  const d0 = draft();
  const choice = ok(runProcessTool('add_type', {
    name: 'ClientResult', kind: 'enum', description: 'Was gefunden wurde',
    fields: [{ name: 'clientKey', type: 'Long' }],
    cases: [{ name: 'Person', fields: [{ name: 'client', type: 'GetClient.Out' }] }, { name: 'Company', fields: [{ name: 'name', type: 'String' }, { name: 'tags', type: 'String', list: true, optional: true }] }],
  }, d0, ctx));
  const result = typeNamed(choice.draft, 'ClientResult')!;
  assert.equal(result.kind, 'enum');
  assert.equal(result.status, 'draft');
  assert.deepEqual(result.values?.map((v) => v.name), ['Person', 'Company']);
  // a class of the domain (the Out of a service) as dom:<id>, a list as collection
  assert.equal(result.values![0].fields![0].type, "dom:acme.crm.domain.client.v1.GetClient.Out");
  assert.deepEqual(result.values![1].fields![1], { ...result.values![1].fields![1], collection: true, optional: true });

  const out = ok(runProcessTool('update_type', { type: 'Out', fields: [{ name: 'result', type: 'ClientResult' }] }, choice.draft, ctx));
  const outType = out.draft.spec.types!.find((t) => t.processOut)!;
  assert.equal(outType.fields![0].type, result.id); // an own type by its id
  const text = processModelText(out.draft.spec, model);
  assert.match(text, new RegExp(`- ${result.id} – ClientResult: Auswahl Person\\{client: GetClient.Out\\} \\| Company\\{name: String, tags\\?: \\[String\\]\\}; gemeinsam: clientKey: Long`));
  assert.match(text, /– Out \(Out des Prozesses\): \{result: ClientResult\}/);
  // the RE sees the classes among the changes
  assert.deepEqual(processDiff(d0.spec, out.draft.spec).map((c) => `${c.kind} ${c.label}`), ['changed Out des Prozesses «Out»', 'added Auswahl «ClientResult»']);
});

test('data model - the Out itself a choice; fields of the same name keep their identity', () => {
  const d0 = draft();
  const withField = ok(runProcessTool('update_type', { type: 'Out', fields: [{ name: 'clientKey', type: 'Long', description: 'der Schlüssel' }] }, d0, ctx));
  const id = withField.draft.spec.types!.find((t) => t.processOut)!.fields![0].id;
  const asChoice = ok(runProcessTool('update_type', { type: 'Out', kind: 'enum', cases: [{ name: 'Found' }, { name: 'NotFound' }] }, withField.draft, ctx));
  const out = asChoice.draft.spec.types!.find((t) => t.processOut)!;
  assert.equal(out.kind, 'enum');
  assert.equal(out.fields![0].id, id); // the field became a shared one, same id
  assert.equal(out.fields![0].description, 'der Schlüssel');
  assert.equal(runProcessTool('update_type', { type: 'Out', kind: 'enum' }, withField.draft, ctx).isError, true); // a choice needs cases
  const back = ok(runProcessTool('update_type', { type: 'Out', kind: 'case' }, asChoice.draft, ctx));
  assert.equal(back.draft.spec.types!.find((t) => t.processOut)!.values, undefined);
});

test('data model - refused with a reason: names, unknown types, In/Out, a type in use', () => {
  const d0 = draft();
  const err = (name: string, input: unknown, d = d0) => {
    const r = runProcessTool(name, input, d, ctx);
    assert.equal(r.isError, true, `${name} ${JSON.stringify(input)}`);
    return r.content;
  };
  assert.match(err('add_type', { name: 'clientResult', kind: 'case' }), /PascalCase/);
  assert.match(err('add_type', { name: 'Out', kind: 'case' }), /Rollen des Prozesses/);
  assert.match(err('add_type', { name: 'X', kind: 'case', fields: [{ name: 'a', type: 'Whatever' }] }), /Einen Typ «Whatever» gibt es nicht/);
  assert.match(err('add_type', { name: 'X', kind: 'case', fields: [{ name: 'A', type: 'String' }] }), /camelCase/);
  assert.match(err('add_type', { name: 'X', kind: 'enum' }), /Fälle/);
  assert.match(err('update_type', { type: 'Nope' }), /gibt es im Datenmodell nicht/);
  assert.match(err('update_type', { type: 'In', name: 'Input' }), /behalten ihren Namen/);
  assert.match(err('remove_type', { type: 'In' }), /bleiben/);
  const two = ok(runProcessTool('add_type', { name: 'Part', kind: 'case', fields: [{ name: 'text', type: 'String' }] }, d0, ctx));
  assert.match(err('add_type', { name: 'Part', kind: 'case' }, two.draft), /gibt es schon/);
  const used = ok(runProcessTool('update_type', { type: 'Out', fields: [{ name: 'part', type: 'Part' }] }, two.draft, ctx));
  assert.match(err('remove_type', { type: 'Part' }, used.draft), /noch verwendet – in «Out»/);
  const free = ok(runProcessTool('update_type', { type: 'Out', fields: [] }, used.draft, ctx));
  assert.equal(typeNamed(ok(runProcessTool('remove_type', { type: 'Part' }, free.draft, ctx)).draft, 'Part'), undefined);
});

test('data model - the types stay when the flow changes afterwards (the spec follows the diagram)', () => {
  const d0 = draft();
  const typed = ok(runProcessTool('add_type', { name: 'Part', kind: 'case', fields: [{ name: 'text', type: 'String' }] }, d0, ctx));
  const after = typed.draft.spec.steps.find((s) => s.kind === 'service')!.id;
  const stepped = ok(runProcessTool('add_step', { after, kind: 'service', name: 'Kunde lesen', topic: GET }, typed.draft, ctx));
  assert.ok(typeNamed(stepped.draft, 'Part'));
});

test('data model - the tools are there for processes and orchestrations', () => {
  for (const c of [ctx, { model }]) {
    const names = processToolKit(c).tools.map((t) => t.name);
    assert.ok(['add_type', 'update_type', 'remove_type'].every((n) => names.includes(n)), names.join());
  }
});

test('data model - review: no class named like a simple type; flags kept when re-sent; a rename brings no new errors', () => {
  const d0 = draft();
  const r = runProcessTool('add_type', { name: 'String', kind: 'case' }, d0, ctx);
  assert.equal(r.isError, true);
  assert.match(r.content, /einfacher Typ/);

  const out = ok(runProcessTool('update_type', { type: 'Out', fields: [{ name: 'tags', type: 'String', optional: true, list: true }] }, d0, ctx));
  // Claude re-sends the list to add a field - without repeating the flags of the old one
  const more = ok(runProcessTool('update_type', { type: 'Out', fields: [{ name: 'tags', type: 'String' }, { name: 'clientKey', type: 'Long' }] }, out.draft, ctx));
  const tags = more.draft.spec.types!.find((t) => t.processOut)!.fields![0];
  assert.equal(tags.optional, true);
  assert.equal(tags.collection, true);
  const off = ok(runProcessTool('update_type', { type: 'Out', fields: [{ name: 'tags', type: 'String', optional: false, list: false }] }, more.draft, ctx));
  assert.deepEqual([off.draft.spec.types!.find((t) => t.processOut)!.fields![0].optional, off.draft.spec.types!.find((t) => t.processOut)!.fields![0].collection], [undefined, undefined]);

  // a class with an error in the process before the draft: renamed by Claude, its error is not new
  const broken = { ...d0, spec: { ...d0.spec, types: [...(d0.spec.types ?? []), { id: 't-x', name: 'Part', kind: 'case' as const, fields: [{ id: 'f1', name: 'a', type: 'String' }, { id: 'f2', name: 'a', type: 'Long' }] }] } };
  const base = startProcessDraft(broken.spec, broken.xml);
  assert.ok(checkTypes(base.spec.types, model).some((i) => i.typeId === 't-x' && !i.warn), 'the class has an error'); // else the test proves nothing
  assert.ok(newProcessErrors({ ...base, spec: { ...base.spec, title: 'x' } }, ctx).every((l) => !l.includes('Part'))); // as before: not new
  const renamed = ok(runProcessTool('update_type', { type: 'Part', name: 'Piece' }, base, ctx));
  assert.deepEqual(newProcessErrors(renamed.draft, ctx).filter((l) => l.startsWith('Typ')), []);
});

test('data model - a choice back to a class: shared and case fields together, once per name', () => {
  const d0 = draft();
  const choice = ok(runProcessTool('update_type', { type: 'Out', kind: 'enum', fields: [{ name: 'clientKey', type: 'Long' }],
    cases: [{ name: 'Person', fields: [{ name: 'name', type: 'String' }] }, { name: 'Company', fields: [{ name: 'name', type: 'String' }, { name: 'uid', type: 'String' }] }] }, d0, ctx));
  const back = ok(runProcessTool('update_type', { type: 'Out', kind: 'case' }, choice.draft, ctx));
  assert.deepEqual(back.draft.spec.types!.find((t) => t.processOut)!.fields!.map((f) => f.name), ['clientKey', 'name', 'uid']);
});
