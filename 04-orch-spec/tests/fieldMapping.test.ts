// A script task of a service orchestration as a mapping: per field of the result the paths it
// reads - its FEEL written along, in Scala the class field by field or a copy of the base.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import type { VarNode } from '../src/feel';
import { autoMapped, linked, mappingFeel, mappingIssues, withLink } from '../src/fieldMapping';
import { newOrchestration } from '../src/services/orchestration';
import { orchestrationFiles } from '../src/services/scalaOrchestration';
import type { ServiceOrchestrationSpec } from '../src/services/types';
import type { Field, FieldMapping, TypeDef } from '../src/types';

(globalThis as unknown as { DOMParser: unknown }).DOMParser ??= DOMParser;

const f = (name: string, type: string, optional = false): Field => ({ id: `f-${name}`, name, type, ...(optional ? { optional: true } : {}) });
const client: TypeDef = {
  id: 'client', name: 'Client', kind: 'case',
  fields: [f('clientKey', 'Long'), f('name', 'String', true), f('firstName', 'String'), f('etag', 'String')],
};

/** In: the client as it is and as it should be - the script builds the new one, the Out returns it */
const orchestration = (m: FieldMapping, more: TypeDef[] = []): ServiceOrchestrationSpec => {
  const o = newOrchestration({ title: 'Kunde ändern', project: 'acme-crm', api: 'client', apiVersion: 1, name: 'UpdateClient' });
  o.types.find(x => x.id === o.inTypeId)!.fields = [f('existingClient', 'client'), f('client', 'client')];
  o.types.find(x => x.id === o.outTypeId)!.fields = [f('newClient', 'client')];
  return {
    ...o,
    types: [...o.types, ...more.filter(t => t.id === 'client'), ...(more.some(t => t.id === 'client') ? [] : [client]), ...more.filter(t => t.id !== 'client')],
    bpmn: `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d" targetNamespace="x">
  <bpmn:process id="acme-crm-clientV1-UpdateClient" isExecutable="false">
    <bpmn:startEvent id="Start" /><bpmn:scriptTask id="MapTask" name="Map Client" /><bpmn:endEvent id="End" />
    <bpmn:sequenceFlow id="f1" sourceRef="Start" targetRef="MapTask" /><bpmn:sequenceFlow id="f2" sourceRef="MapTask" targetRef="End" />
  </bpmn:process>
</bpmn:definitions>`,
    tasks: { MapTask: { script: mappingFeel(m), resultVariable: 'newClient', mapping: m } },
    conditions: {},
    outMappings: [{ name: 'newClient', expression: '= newClient' }],
  };
};
const files = (m: FieldMapping, more: TypeDef[] = []) => {
  const fs = orchestrationFiles(orchestration(m, more), [], null);
  return {
    worker: fs.find(x => x.path.endsWith('/UpdateClientWorker.scala'))!.content,
    test: fs.find(x => x.path.endsWith('/UpdateClientWorkerTest.scala'))!.content,
  };
};

const merge: FieldMapping = {
  base: 'existingClient',
  fields: [{ field: 'firstName', from: ['client.firstName'] }, { field: 'name', from: ['client.name', 'existingClient.name'] }],
};

test('the FEEL of a mapping: a context - with a base merged into it; several paths the first one set', () => {
  assert.equal(mappingFeel(merge),
    '= context merge([existingClient, {firstName: client.firstName, name: if client.name != null then client.name else existingClient.name}])');
  assert.equal(mappingFeel({ fields: [{ field: 'clientKey', from: ['existingClient.clientKey'] }, { field: 'first-name', from: [], expression: '= upper case(client.firstName)' }] }),
    '= {clientKey: existingClient.clientKey, "first-name": upper case(client.firstName)}');
  assert.equal(mappingFeel({ base: 'existingClient', fields: [] }), '= existingClient');
});

test('drawing a line adds a path - again it is no change; an empty link is dropped', () => {
  const m0: FieldMapping = { fields: [] };
  const m1 = linked(m0, 'name', 'client.name');
  const m2 = linked(m1, 'name', 'existingClient.name');
  assert.deepEqual(m2.fields, [{ field: 'name', from: ['client.name', 'existingClient.name'] }]);
  assert.equal(linked(m2, 'name', 'client.name'), m2);
  assert.deepEqual(withLink(m2, 'name', null).fields, []);
  assert.deepEqual(withLink(m2, 'name', { from: [] }).fields, []);
});

// the variables as the panel knows them
const node = (name: string, children?: VarNode[], optional = false): VarNode =>
  ({ name, type: children ? 'context' : 'string', label: children ? 'Client' : 'String', source: 'In', ...(children ? { children } : {}), ...(optional ? { optional: true } : {}) });
const fields = () => [node('clientKey'), node('name', undefined, true), node('firstName'), node('etag')];
const sources = [node('existingClient', fields()), node('client', fields()), node('etag')];
const target = node('newClient', fields());

test('automatically: the fields of the same name - a variable first, the base needs no line', () => {
  const m = autoMapped({ base: 'existingClient', fields: [] }, target, sources);
  assert.deepEqual(m.fields, [
    { field: 'clientKey', from: ['client.clientKey'] }, { field: 'name', from: ['client.name'] },
    { field: 'firstName', from: ['client.firstName'] }, { field: 'etag', from: ['etag'] },
  ]);
  // a field already mapped stays as it is
  const kept = autoMapped({ fields: [{ field: 'etag', from: ['existingClient.etag'] }] }, target, sources);
  assert.deepEqual(kept.fields.find(l => l.field === 'etag'), { field: 'etag', from: ['existingClient.etag'] });
});

test('the checks: a required field without a value, a path not known, a base of another type', () => {
  const texts = (m: FieldMapping) => mappingIssues(m, target, sources).map(i => `${i.level}: ${i.text}`);
  assert.deepEqual(texts({ fields: [{ field: 'name', from: ['client.name'] }] }), [
    'error: «clientKey» bekommt keinen Wert - eine Linie ziehen oder eine Basis wählen.',
    'error: «firstName» bekommt keinen Wert - eine Linie ziehen oder eine Basis wählen.',
    'error: «etag» bekommt keinen Wert - eine Linie ziehen oder eine Basis wählen.',
  ]);
  assert.deepEqual(texts({ base: 'existingClient', fields: [{ field: 'name', from: ['client.nickname'] }] }), ['error: «name»: client.nickname ist vor dem Schritt nicht bekannt.']);
  assert.deepEqual(texts({ base: 'etag', fields: [] }), ['error: Basis «etag» ist String - das Ergebnis Client.']);
  assert.equal(mappingIssues({ fields: [] }, node('x'), sources)[0].level, 'error');
});

test('in Scala with a base: a copy with the mapped fields in the order of the type - the first one set by orElse; the test checks them', () => {
  const { worker, test: t } = files(merge);
  assert.match(worker, /newClient <- ZIO\.attempt\(mapClient\(in\.existingClient, in\.client\)\)/, worker);
  assert.match(worker, /def mapClient\(existingClient: Client, client: Client\): Client =\n\s+existingClient\.copy\(\n\s+name = client\.name\.orElse\(existingClient\.name\),\n\s+firstName = client\.firstName\n\s+\)/, worker);
  assert.match(t, /val existingClient = Client\.example\n\s+val client = Client\.example\n\s+val result = Mocked\(\)\.mapClient\(existingClient, client\)\n\s+assertEquals\(result\.name, client\.name\.orElse\(existingClient\.name\)\)\n\s+assertEquals\(result\.firstName, client\.firstName\)/, t);
});

test('in Scala without a base: the class field by field - optional not mapped None, required a TODO, optional onto required fails', () => {
  const { worker } = files({ fields: [{ field: 'clientKey', from: ['existingClient.clientKey'] }, { field: 'firstName', from: ['client.name'] }] });
  assert.match(worker, /Client\(\n\s+clientKey = existingClient\.clientKey,\n\s+name = None,\n\s+firstName = client\.name\.getOrElse\(throw IllegalArgumentException\("Map Client: firstName fehlt"\)\),\n\s+etag = \?\?\? \/\* TODO etag: nicht zugeordnet \*\/\n\s+\)/, worker);
});

test('in Scala: a FEEL expression of a field translated like a mapping', () => {
  const { worker } = files({ base: 'existingClient', fields: [{ field: 'etag', from: [], expression: '= "*"' }] });
  assert.match(worker, /existingClient\.copy\(\n\s+etag = "\*"\n\s+\)/, worker);
});

// a client with its master data: a field of the result whose own fields get lines
const master: TypeDef = { id: 'master', name: 'Master', kind: 'case', fields: [f('clientType', 'String'), f('segment', 'String', true)] };
const withMaster = (optional: boolean): TypeDef[] => [{ ...client, fields: [...client.fields!, f('master', 'master', optional)] }, master];
const masterNode = (optional = false) => ({ ...node('master', [node('clientType'), node('segment', undefined, true)]), label: optional ? 'Option[Master]' : 'Master', ...(optional ? { optional: true } : {}) });
const withMasterNode = (n: VarNode) => ({ ...n, children: [...n.children!, masterNode()] });

test('a field of a field: built from its fields - on the line onto it or on the base, otherwise a context of its own', () => {
  assert.equal(mappingFeel({ base: 'existingClient', fields: [{ field: 'master.clientType', from: ['client.clientType'] }] }),
    '= context merge([existingClient, {master: context merge([existingClient.master, {clientType: client.clientType}])}])');
  assert.equal(mappingFeel({ fields: [{ field: 'master', from: ['client.master'] }, { field: 'master.clientType', from: ['clientType'] }] }),
    '= {master: context merge([client.master, {clientType: clientType}])}');
  assert.equal(mappingFeel({ fields: [{ field: 'master.clientType', from: ['clientType'] }] }), '= {master: {clientType: clientType}}');
});

test('the checks of a field of a field: its path known in the result, its required fields without a base', () => {
  const t = withMasterNode(target);
  const srcs = [withMasterNode(sources[0]), sources[1], sources[2], node('clientType')];
  const texts = (m: FieldMapping) => mappingIssues(m, t, srcs).map(i => `${i.level}: ${i.text}`);
  assert.deepEqual(texts({ base: 'existingClient', fields: [{ field: 'master.clientType', from: ['clientType'] }] }), []);
  assert.deepEqual(texts({ base: 'existingClient', fields: [{ field: 'master.kind', from: ['clientType'] }] }), ['warn: «master.kind» gibt es im Ergebnis nicht (mehr).']);
  // without a base: the master built from its fields needs its required ones - a line onto it is its base
  const without = (more: FieldMapping['fields']) => texts({ fields: [{ field: 'clientKey', from: ['client.clientKey'] }, { field: 'firstName', from: ['client.firstName'] }, { field: 'etag', from: ['etag'] }, ...more] });
  assert.deepEqual(without([{ field: 'master.segment', from: ['clientType'] }]), ['error: «master.clientType» bekommt keinen Wert - eine Linie ziehen oder eine Basis wählen.']);
  assert.deepEqual(without([{ field: 'master', from: ['existingClient.master'] }, { field: 'master.segment', from: ['clientType'] }]), []);
});

test('in Scala a field of a field: a copy of the base\'s - an optional one mapped into, a required one built field by field', () => {
  const m: FieldMapping = { base: 'existingClient', fields: [{ field: 'master.clientType', from: ['client.firstName'] }] };
  const req = files(m, withMaster(false));
  assert.match(req.worker, /existingClient\.copy\(\n\s+master = existingClient\.master\.copy\(\n\s+clientType = client\.firstName\n\s+\)\n\s+\)/, req.worker);
  assert.match(req.test, /assertEquals\(result\.master\.clientType, client\.firstName\)/, req.test);
  const opt = files(m, withMaster(true));
  assert.match(opt.worker, /master = existingClient\.master\.map\(master =>\n\s+master\.copy\(\n\s+clientType = client\.firstName\n\s+\)\n\s+\)/, opt.worker);
  assert.doesNotMatch(opt.test, /result\.master/);
  const own = files({ fields: [{ field: 'clientKey', from: ['existingClient.clientKey'] }, { field: 'firstName', from: ['client.firstName'] }, { field: 'etag', from: ['client.etag'] }, { field: 'master.clientType', from: ['client.firstName'] }] }, withMaster(true));
  assert.match(own.worker, /master = Some\(Master\(\n\s+clientType = client\.firstName,\n\s+segment = None\n\s+\)\)/, own.worker);
});
