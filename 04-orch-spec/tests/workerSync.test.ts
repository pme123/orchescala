// «Mit Code abgleichen»: the CustomWorker of a service orchestration back into its steps - what the
// code has differently from the export of the spec goes in, an unchanged worker changes nothing.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { newCollection } from '../src/services/collection';
import { newOrchestration, servicesByTopic } from '../src/services/orchestration';
import { orchestrationFiles } from '../src/services/scalaOrchestration';
import { asOrchestration, fromOrchestration, newServiceProcess, type ServiceProcess } from '../src/services/serviceProcess';
import { mappingLinks, pathsOf, readWorkerCode } from '../src/services/workerScan';
import { syncWorker, type WorkerSyncContext } from '../src/services/workerSync';
import type { CollectionService, ServiceCollectionSpec, ServiceOrchestrationSpec } from '../src/services/types';
import type { Field, FieldMapping, Step, TypeDef, TypeMapper } from '../src/types';

(globalThis as unknown as { DOMParser: unknown }).DOMParser ??= DOMParser;

const t = (id: string, name: string, fields: Array<[string, string, boolean?]>, interactionId?: string): TypeDef =>
  ({ id, name, kind: 'case', ...(interactionId ? { interactionId } : {}), fields: fields.map(([n, type, optional]) => ({ id: `${id}-${n}`, name: n, type, ...(optional ? { optional: true } : {}) })) });
const svc = (id: string, name: string, method: 'GET' | 'PUT', extra: Partial<CollectionService> = {}): CollectionService =>
  ({ id, name, api: 'client', apiVersion: 1, status: 'implemented', method, path: '/clients/{clientKey}', params: [], inTypeId: `${id}-in`, outTypeId: `${id}-out`, ...extra });
const collection = (): ServiceCollectionSpec => ({
  ...newCollection({ title: 'Client', project: 'acme-crm', api: 'client', apiVersion: 1 }),
  types: [
    t('get-in', 'In', [['clientKey', 'Long']], 'get'), t('get-out', 'Out', [['name', 'String'], ['etag', 'String', true]], 'get'),
    t('put-in', 'In', [['clientKey', 'Long'], ['etag', 'String'], ['name', 'String']], 'put'), t('put-out', 'Out', [], 'put'),
  ],
  services: [svc('get', 'GetClient', 'GET'), svc('put', 'PutClient', 'PUT', { noOut: true })],
});

const bpmn = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d" targetNamespace="x">
  <bpmn:process id="acme-crm-clientV1-UpdateClient" isExecutable="false">
    <bpmn:startEvent id="Start" />
    ${body}
    <bpmn:endEvent id="End" />
  </bpmn:process>
</bpmn:definitions>`;
const flow = (id: string, from: string, to: string) => `<bpmn:sequenceFlow id="${id}" sourceRef="${from}" targetRef="${to}" />`;

/** GetClient, then PutClient with the etag GetClient returned */
function described(): ServiceProcess {
  const { spec } = newServiceProcess({ title: 'Kunde ändern', project: 'acme-crm', api: 'client', apiVersion: 1, name: 'UpdateClient' });
  const xml = bpmn(`<bpmn:serviceTask id="Get" name="Kunde lesen" /><bpmn:serviceTask id="Put" name="Kunde schreiben" />
    ${flow('f1', 'Start', 'Get')}${flow('f2', 'Get', 'Put')}${flow('f3', 'Put', 'End')}`);
  const fresh = fromOrchestration({ ...newOrchestration({ title: 'x', project: 'acme-crm', api: 'client', apiVersion: 1, name: 'UpdateClient' }), bpmn: xml }, new Map()).spec;
  const steps = fresh.steps.map((s): Step => s.id === 'Get'
    ? { ...s, topic: 'acme-crm-clientV1.GetClient', serviceId: 'acme-crm-clientV1.GetClient', outputs: [{ name: 'etag', expression: '= etag' }] }
    : s.id === 'Put' ? { ...s, topic: 'acme-crm-clientV1.PutClient', serviceId: 'acme-crm-clientV1.PutClient', inputs: [{ name: 'name', expression: '= "Muster"' }] } : s);
  const types = spec.types!.map(x => (x.root ? { ...x, fields: [{ id: 'k', name: 'clientKey', type: 'Long' }] } : x.processOut ? { ...x, fields: [{ id: 'e', name: 'etag', type: 'String' }] } : x));
  return { ...spec, steps, types };
}

const services = () => servicesByTopic([collection()]);
const ctx = (mappers: TypeMapper[] = []): WorkerSyncContext => ({ services: services(), mappers, nameOf: r => r });
const workerOf = (spec: ServiceProcess, all = [collection()]) =>
  orchestrationFiles(asOrchestration(spec), all, null).find(f => f.path.endsWith('Worker.scala') && !f.path.includes('/test/'))!.content;

test('an unchanged worker: nothing changes, nothing to say', () => {
  const spec = described();
  const w = workerOf(spec);
  const r = syncWorker(spec, w, w, ctx());
  assert.deepEqual(r.report, { changed: [], hints: [], steps: [] });
  assert.equal(r.spec, spec);
});

test('a service call changed in the code: its input and output go into the step, which is changed', () => {
  const spec = described();
  const w = workerOf(spec);
  const code = w.replace('name = "Muster"', 'name = "Meier"').replace('etag = getClient.etag', 'etag = getClient.name');
  assert.notEqual(code, w);
  const r = syncWorker(spec, w, code, ctx());
  const put = r.spec.steps.find(s => s.id === 'Put')!;
  const get = r.spec.steps.find(s => s.id === 'Get')!;
  assert.deepEqual(put.inputs?.find(m => m.name === 'name')?.expression, '= "Meier"');
  assert.deepEqual(get.outputs?.find(m => m.name === 'etag')?.expression, '= name');
  assert.deepEqual(r.report.steps.sort(), ['Get', 'Put']);
  assert.equal(put.status, 'changed');
  assert.deepEqual(r.report.changed, ['«Kunde lesen»: Output etag = name', '«Kunde schreiben»: Input name = "Meier"']);
  // round trip: the spec it gives exports the code again
  const again = workerOf(r.spec);
  assert.deepEqual(syncWorker(r.spec, again, code, ctx()).report.changed, []);
});

test('what the reader does not know stays - and is said; a call more of a service: none of its steps is taken over', () => {
  const spec = described();
  const w = workerOf(spec);
  const hand = w.replace('name = "Muster"', 'name = compute("x") + 1')
    .replace(/(\n\s+)(_ <- runPutClient)/, '$1extra <- runGetClient(GetClient.In(clientKey = in.clientKey))$1$2');
  const r = syncWorker(spec, w, hand, ctx());
  assert.deepEqual(r.report.changed, []);
  assert.ok(r.report.hints.some(h => h.includes('Input name = compute("x") + 1 ist nicht lesbar')), r.report.hints.join('\n'));
  // the call is the step's only while both have as many - otherwise nothing of that service is taken over
  assert.ok(r.report.hints.some(h => h.includes('runGetClient ruft der Code 2-mal auf, der Ablauf 1-mal')), r.report.hints.join('\n'));
  assert.equal(r.spec, spec);
});

// ── a mapping ────────────────────────────────────────────────────────────────

const f = (name: string, type: string, more: Partial<Field> = {}): Field => ({ id: `f-${name}`, name, type, ...more });
const client: TypeDef = { id: 'client', name: 'Client', kind: 'case', fields: [f('name', 'String', { optional: true }), f('firstName', 'String', { optional: true }), f('code', 'Int', { optional: true }), f('country', 'String', { optional: true })] } as TypeDef;
const country: TypeMapper = { id: 'country', from: 'Int', to: 'String', kind: 'table', name: 'Country', cases: [{ from: '756', to: 'CH' }] };

function mapped(m: FieldMapping): ServiceProcess {
  const o = newOrchestration({ title: 'Kunde', project: 'acme-crm', api: 'client', apiVersion: 1, name: 'UpdateClient' });
  o.types.find(x => x.id === o.inTypeId)!.fields = [f('existingClient', 'client'), f('client', 'client')];
  const spec: ServiceOrchestrationSpec = {
    ...o, types: [...o.types, client],
    bpmn: bpmn(`<bpmn:scriptTask id="MapTask" name="Map Client" />${flow('f1', 'Start', 'MapTask')}${flow('f2', 'MapTask', 'End')}`),
    tasks: { MapTask: { script: '= {}', mapping: m } }, conditions: {}, outMappings: [],
  };
  return fromOrchestration(spec, new Map()).spec;
}
const mapping = (fields: FieldMapping['fields']): FieldMapping => ({ in: [f('existingClient', 'client'), f('client', 'client')], out: [f('newClient', 'client')], fields });
const mapWorker = (spec: ServiceProcess) =>
  orchestrationFiles(asOrchestration(spec), [], { version: 1, services: [], typeMappers: [country] } as never).find(x => x.path.endsWith('Worker.scala') && !x.path.includes('/test/'))!.content;

test('the reader: the lines of a mapping method - a copy onto the object, the first one set, a type mapper', () => {
  const spec = mapped(mapping([
    { field: 'newClient', from: ['existingClient'] }, { field: 'newClient.name', from: ['client.name', 'existingClient.name'] },
    { field: 'newClient.country', from: ['client.code'], mapper: 'country' },
  ]));
  const w = mapWorker(spec);
  const links = mappingLinks(readWorkerCode(w), 'mapClient', ['newClient'], new Set(['toCountry']));
  assert.deepEqual(Object.fromEntries([...links.fields].map(([k, v]) => [k, `${v.from.join(' | ')}${v.ext ? ` ${v.ext}` : ''}`])), {
    newClient: 'existingClient',
    'newClient.name': 'client.name | existingClient.name',
    'newClient.country': 'client.code toCountry',
  }, w);
  assert.deepEqual([...links.unreadable], []);
  // the paths of an expression
  assert.deepEqual(pathsOf('src.p.flatMap(_.name).map(_.toCountry)', new Set(['toCountry'])), { from: ['src.p.name'], ext: 'toCountry' });
  assert.deepEqual(pathsOf('TypeMappers.toCountry(src.code)', new Set(['toCountry'])), { from: ['src.code'], ext: 'toCountry' });
  assert.equal(pathsOf('compute(src.code)', new Set()), null);
});

test('a mapping changed in the code: a line moved, a mapper chosen, a line gone - into the spec, and it exports the code again', () => {
  const spec = mapped(mapping([
    { field: 'newClient', from: ['existingClient'] }, { field: 'newClient.name', from: ['client.name'] }, { field: 'newClient.firstName', from: ['client.firstName'] },
  ]));
  const w = mapWorker(spec);
  const code = w.replace('name = client.name', 'name = client.firstName')
    .replace(/,?\n\s+firstName = client\.firstName/, '')
    .replace(/(existingClient\.copy\(\n)/, '$1          country = client.code.map(_.toCountry),\n');
  const c = ctx([country]);
  const r = syncWorker(spec, w, code, c);
  const step = r.spec.steps.find(s => s.id === 'MapTask')!;
  assert.deepEqual(step.fieldMapping!.fields, [
    { field: 'newClient', from: ['existingClient'] },
    { field: 'newClient.name', from: ['client.firstName'] },
    { field: 'newClient.country', from: ['client.code'], mapper: 'country' },
  ], `${code}\n${r.report.changed.join('\n')}`);
  assert.equal(step.status, 'changed');
  assert.deepEqual(syncWorker(r.spec, mapWorker(r.spec), code, c).report.changed, []);
});

test('the real form of a case mapping: the match onto a method per case - the case table and the lines of each case', () => {
  const code = `class MapClientWorker
    extends CompanyCustomWorkerDsl[In, Out]:

  override def runWorkZIO(in: In): RunWorkZIOOutput[Out] =
    for
      dst <- mapClient(in.src)
    yield NoOutput()

  def mapClient(src: Src): IO[CustomError, Dst] =
    src match
      case src: Src.A => mapClientA(src)
      case other => ZIO.fail(CustomError(s"Map Client: Src $other - kein Fall von Dst gewählt"))

  def mapClientA(src: Src.A): IO[CustomError, Dst.X] =
    for
      a <- ZIO.fromOption(src.a).orElseFail(CustomError("Map Client: dst.a fehlt"))
      built <- mapped("Map Client")(
        Dst.X(
          id = src.id,
          a = a,
          extra = None
        )
      )
    yield built
end MapClientWorker
`;
  const w = readWorkerCode(code);
  assert.deepEqual(w.items?.map(i => i.kind), ['mapping']);
  const links = mappingLinks(w, 'mapClient', ['dst'], new Set());
  assert.deepEqual([...links.cases], [['dst', { from: 'src', cases: [{ from: 'A', to: 'X' }] }]]);
  assert.deepEqual(Object.fromEntries([...links.fields].map(([k, v]) => [k, v.from.join(' | ')])), { 'dst.id': 'src.id', 'dst.a': 'src.a' });
});

test('the whole plan from the exported files: In, Out and the worker are as the spec has them; a field added in the code comes in', async () => {
  const { planCodeSync } = await import('../src/services/codeSync');
  const spec = described();
  const files = orchestrationFiles(asOrchestration(spec), [collection()], null).map(x => ({ path: `acme-crm/${x.path}`, text: x.content }));
  const plan = planCodeSync(spec, files, null, [collection()]);
  assert.ok(plan.workerPath?.endsWith('/UpdateClientWorker.scala'), plan.workerPath);
  assert.deepEqual(plan.worker?.changed, []);
  assert.deepEqual(plan.worker?.hints, []);
  assert.ok(plan.domain, 'the CustomTask object by its topic');
  assert.deepEqual([plan.domain!.report.added, plan.domain!.report.stale], [[], []]);
  // a field of the In added in the code
  const more = files.map(x => (x.path.endsWith('/UpdateClient.scala') ? { ...x, text: x.text.replace(/clientKey: Long/, 'clientKey: Long,\n      note: Option[String] = None') } : x));
  const changed = planCodeSync(spec, more, null, [collection()]);
  const inType = changed.spec.types!.find(x => x.root)!;
  assert.deepEqual(inType.fields?.map(x => x.name), ['clientKey', 'note'], files.find(x => x.path.endsWith('/UpdateClient.scala'))!.text);
  assert.ok(changed.domain!.report.changed.includes('In'));
});

test('a call of a service removed in the code: its other steps are not matched by position - said, nothing taken over', () => {
  const spec = described();
  const w = workerOf(spec);
  // GetClient no more - and PutClient changed: it stays with its own step
  const code = w.replace('<- runGetClient(', '<- runOtherClient(').replace('name = "Muster"', 'name = "Meier"');
  assert.notEqual(code, w);
  const r = syncWorker(spec, w, code, ctx());
  assert.ok(r.report.hints.some(h => h.includes('«Kunde lesen»: runGetClient ruft der Code 0-mal auf, der Ablauf 1-mal')), r.report.hints.join('\n'));
  assert.ok(r.report.hints.some(h => h.includes('runOtherClient ruft der Code einmal auf, der Ablauf nicht')), r.report.hints.join('\n'));
  assert.deepEqual(r.report.changed, ['«Kunde schreiben»: Input name = "Meier"'], code);
});

test('code the reader does not know in a mapping: a method of a value, a text with = in it - said, nothing taken over', () => {
  const spec = mapped(mapping([{ field: 'newClient', from: ['existingClient'] }, { field: 'newClient.name', from: ['client.name'] }]));
  const w = mapWorker(spec);
  const code = w.replace('name = client.name', 'name = client.name.map(_.trim),\n          firstName = Some("a = b")');
  assert.notEqual(code, w);
  // the paths of its In: `client.name.trim` is none of them
  const known = new Set(['existingClient', 'client', ...['name', 'firstName', 'code', 'country'].flatMap(f => [`existingClient.${f}`, `client.${f}`])]);
  const r = syncWorker(spec, w, code, { ...ctx(), sourcePaths: () => (p: string) => known.has(p) });
  assert.deepEqual(r.report.changed, [], r.report.changed.join('\n'));
  assert.ok(r.report.hints.some(h => h.includes('newClient.name liest im Code client.name.trim - das gibt es im In nicht')), r.report.hints.join('\n'));
  assert.ok(r.report.hints.some(h => h.includes('newClient.firstName ist im Code nicht lesbar')), r.report.hints.join('\n'));
  assert.equal(r.spec, spec);
});

test('an output set to None in the code: removed from the step, said - no crash', () => {
  const spec = described();
  const w = workerOf(spec);
  const code = w.replace('etag = getClient.etag', 'etag = None');
  assert.notEqual(code, w);
  const r = syncWorker(spec, w, code, ctx());
  assert.deepEqual(r.report.changed, ['«Kunde lesen»: Output etag entfernt']);
  assert.deepEqual(r.spec.steps.find(s => s.id === 'Get')!.outputs, []);
});
