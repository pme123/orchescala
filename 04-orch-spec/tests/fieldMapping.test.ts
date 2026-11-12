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
const orchestration = (m: FieldMapping): ServiceOrchestrationSpec => {
  const o = newOrchestration({ title: 'Kunde ändern', project: 'acme-crm', api: 'client', apiVersion: 1, name: 'UpdateClient' });
  o.types.find(x => x.id === o.inTypeId)!.fields = [f('existingClient', 'client'), f('client', 'client')];
  o.types.find(x => x.id === o.outTypeId)!.fields = [f('newClient', 'client')];
  return {
    ...o,
    types: [...o.types, client],
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
const files = (m: FieldMapping) => {
  const fs = orchestrationFiles(orchestration(m), [], null);
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
