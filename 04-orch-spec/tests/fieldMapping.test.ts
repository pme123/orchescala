// A script task of a service orchestration as a mapping: its In (what it reads), its Out (what it
// sets), per field of the Out the paths in the In - its FEEL written along, in Scala a method
// from the In to the Out: an object field by field or a copy of what the line onto it gives.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import type { VarNode } from '../src/feel';
import { autoMapped, inOutIssues, linked, mappingFeel, mappingIssues, renamedVar, varFeel, withLink } from '../src/fieldMapping';
import { newOrchestration } from '../src/services/orchestration';
import { orchestrationFiles } from '../src/services/scalaOrchestration';
import type { ServiceOrchestrationSpec } from '../src/services/types';
import type { Field, FieldLink, FieldMapping, TypeDef } from '../src/types';

(globalThis as unknown as { DOMParser: unknown }).DOMParser ??= DOMParser;

const f = (name: string, type: string, optional = false): Field => ({ id: `f-${name}`, name, type, ...(optional ? { optional: true } : {}) });
const master: TypeDef = { id: 'master', name: 'Master', kind: 'case', fields: [f('clientType', 'String'), f('segment', 'String', true)] };
const clientWith = (masterOptional: boolean): TypeDef => ({
  id: 'client', name: 'Client', kind: 'case',
  fields: [f('clientKey', 'Long'), f('name', 'String', true), f('firstName', 'String'), f('etag', 'String'), f('master', 'master', masterOptional)],
});
const io = { in: [f('existingClient', 'client'), f('client', 'client')], out: [f('newClient', 'client')] };
const mapping = (fields: FieldLink[], more: Partial<FieldMapping> = {}): FieldMapping => ({ ...io, ...more, fields });

/** In of the orchestration: the client as it is and as it should be - the script builds the new one, the Out returns it */
const orchestration = (m: FieldMapping, masterOptional = false): ServiceOrchestrationSpec => {
  const o = newOrchestration({ title: 'Kunde ändern', project: 'acme-crm', api: 'client', apiVersion: 1, name: 'UpdateClient' });
  o.types.find(x => x.id === o.inTypeId)!.fields = [f('existingClient', 'client'), f('client', 'client')];
  o.types.find(x => x.id === o.outTypeId)!.fields = [f('newClient', 'client'), f('changed', 'Boolean')];
  return {
    ...o,
    types: [...o.types, clientWith(masterOptional), master],
    bpmn: `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d" targetNamespace="x">
  <bpmn:process id="acme-crm-clientV1-UpdateClient" isExecutable="false">
    <bpmn:startEvent id="Start" /><bpmn:scriptTask id="MapTask" name="Map Client" /><bpmn:endEvent id="End" />
    <bpmn:sequenceFlow id="f1" sourceRef="Start" targetRef="MapTask" /><bpmn:sequenceFlow id="f2" sourceRef="MapTask" targetRef="End" />
  </bpmn:process>
</bpmn:definitions>`,
    tasks: { MapTask: { script: mappingFeel(m), mapping: m } },
    conditions: {},
    outMappings: [{ name: 'newClient', expression: '= newClient' }],
  };
};
const files = (m: FieldMapping, masterOptional = false) => {
  const fs = orchestrationFiles(orchestration(m, masterOptional), [], null);
  return {
    worker: fs.find(x => x.path.endsWith('/UpdateClientWorker.scala'))!.content,
    test: fs.find(x => x.path.endsWith('/UpdateClientWorkerTest.scala'))!.content,
  };
};

// a copy of the client as it is - the first name and the name from the new one
const merge = mapping([
  { field: 'newClient', from: ['existingClient'] },
  { field: 'newClient.firstName', from: ['client.firstName'] },
  { field: 'newClient.name', from: ['client.name', 'existingClient.name'] },
]);

test('the FEEL of a mapping: a context per variable of the Out - an object set on the line onto it', () => {
  assert.equal(mappingFeel(merge),
    '= {newClient: context merge([existingClient, {firstName: client.firstName, name: if client.name != null then client.name else existingClient.name}])}');
  assert.equal(mappingFeel(mapping([{ field: 'newClient.master.clientType', from: ['client.firstName'] }, { field: 'newClient', from: ['existingClient'] }])),
    '= {newClient: context merge([existingClient, {master: context merge([existingClient.master, {clientType: client.firstName}])}])}');
  assert.equal(mappingFeel(mapping([{ field: 'newClient.clientKey', from: ['existingClient.clientKey'] }, { field: 'newClient.first-name', from: [], expression: '= upper case(client.firstName)' }])),
    '= {newClient: {clientKey: existingClient.clientKey, "first-name": upper case(client.firstName)}}');
  assert.equal(mappingFeel(mapping([])), '= {}');
  assert.equal(varFeel(merge, 'newClient'), 'context merge([existingClient, {firstName: client.firstName, name: if client.name != null then client.name else existingClient.name}])');
});

test('drawing a line adds a path - again it is no change; an empty link is dropped; a renamed variable takes its lines along', () => {
  const m1 = linked(mapping([]), 'newClient.name', 'client.name');
  const m2 = linked(m1, 'newClient.name', 'existingClient.name');
  assert.deepEqual(m2.fields, [{ field: 'newClient.name', from: ['client.name', 'existingClient.name'] }]);
  assert.equal(linked(m2, 'newClient.name', 'client.name'), m2);
  assert.deepEqual(withLink(m2, 'newClient.name', null).fields, []);
  assert.deepEqual(withLink(m2, 'newClient.name', { from: [] }).fields, []);
  assert.deepEqual(renamedVar(m2, 'in', 'client', 'wanted').fields, [{ field: 'newClient.name', from: ['wanted.name', 'existingClient.name'] }]);
  assert.deepEqual(renamedVar(m2, 'out', 'newClient', 'updated').fields, [{ field: 'updated.name', from: ['client.name', 'existingClient.name'] }]);
  assert.deepEqual(renamedVar(m2, 'in', 'existingClient', null).fields, [{ field: 'newClient.name', from: ['client.name'] }]);
  assert.deepEqual(renamedVar(m2, 'out', 'newClient', null).fields, []);
});

// the In and Out as the panel knows them
const node = (name: string, children?: VarNode[], optional = false): VarNode =>
  ({ name, type: children ? 'context' : 'string', label: children ? 'Client' : 'String', source: 'In', ...(children ? { children } : {}), ...(optional ? { optional: true } : {}) });
const masterNode = (): VarNode => ({ ...node('master', [node('clientType'), node('segment', undefined, true)]), label: 'Master' });
const fields = () => [node('clientKey'), node('name', undefined, true), node('firstName'), node('etag'), masterNode()];
const sources = [node('existingClient', fields()), node('client', fields()), node('etag')];
const target: VarNode = { name: 'Out', type: 'context', label: 'Out', source: '', children: [node('newClient', fields()), node('etag')] };

test('automatically: what is open on the right - a field of the same name and type, the one whose path ends most like it', () => {
  // newClient open: its base a variable of its type, its fields from the other - master closed as a whole
  const m = autoMapped(mapping([]), target, sources, new Set(['newClient']));
  assert.deepEqual(m.fields, [
    { field: 'newClient', from: ['existingClient'] },
    { field: 'newClient.clientKey', from: ['client.clientKey'] }, { field: 'newClient.name', from: ['client.name'] },
    { field: 'newClient.firstName', from: ['client.firstName'] }, { field: 'newClient.etag', from: ['client.etag'] },
    { field: 'newClient.master', from: ['client.master'] },
    { field: 'etag', from: ['etag'] },
  ]);
  // closed: only as a whole - no variable of the In named newClient
  assert.deepEqual(autoMapped(mapping([]), target, sources).fields, [{ field: 'etag', from: ['etag'] }]);
  // open deeper, the In of another type: the fields of the same path end
  const other: VarNode[] = [{ ...node('composed', [node('clientType'), { ...masterNode(), label: 'ClientMaster', children: [node('clientType'), node('segment', undefined, true), node('clientKey')] }]), label: 'Composed' }];
  const deep = autoMapped(mapping([{ field: 'newClient.clientKey', from: ['composed.master.clientKey'] }]), target, other, new Set(['newClient', 'newClient.master']));
  assert.deepEqual(deep.fields, [
    { field: 'newClient.clientKey', from: ['composed.master.clientKey'] },
    { field: 'newClient.master.clientType', from: ['composed.master.clientType'] },
    { field: 'newClient.master.segment', from: ['composed.master.segment'] },
  ]);
  // only what is open on the left: composed.master closed - its fields are not in sight
  const closed = autoMapped(mapping([]), target, other, new Set(['newClient', 'newClient.master']), new Set(['composed']));
  assert.deepEqual(closed.fields, [{ field: 'newClient.master.clientType', from: ['composed.clientType'] }]);
  // a field already mapped stays as it is
  const kept = autoMapped(mapping([{ field: 'newClient.etag', from: ['etag'] }]), target, sources);
  assert.deepEqual(kept.fields.filter(l => l.field.startsWith('newClient')), [{ field: 'newClient.etag', from: ['etag'] }]);
});

test('the checks: a name of In or Out is a plain variable name - a path splits at its dots', () => {
  assert.deepEqual(inOutIssues({ in: [], out: [f('new.client', 'client'), f('ok_1', 'client')], fields: [] }, null).map(i => i.text),
    ['Out: «new.client» ist kein Variablenname - nur Buchstaben, Ziffern und _.']);
});

test('the checks: the In known before the step, names there, a field of the Out without a value, a path not in the In', () => {
  assert.deepEqual(inOutIssues({ in: [f('existingClient', 'client'), f('', 'client'), f('wanted', '')], out: [], fields: [] }, [node('existingClient')]).map(i => i.text), [
    'In: ein Feld ohne Namen.', 'In: «wanted» hat keinen Typ.', 'Das Out braucht eine Variable - die, die der Schritt setzt.', 'In: «wanted» ist vor dem Schritt nicht bekannt.',
  ]);
  const texts = (m: FieldMapping) => mappingIssues(m, target, sources).map(i => `${i.level}: ${i.text}`);
  assert.deepEqual(texts(mapping([{ field: 'newClient.name', from: ['client.name'] }, { field: 'etag', from: ['etag'] }])), [
    'error: «newClient.clientKey» bekommt keinen Wert - eine Linie ziehen.',
    'error: «newClient.firstName» bekommt keinen Wert - eine Linie ziehen.',
    'error: «newClient.etag» bekommt keinen Wert - eine Linie ziehen.',
    'error: «newClient.master» bekommt keinen Wert - eine Linie ziehen.',
  ]);
  assert.deepEqual(texts(mapping([{ field: 'newClient', from: ['existingClient'] }, { field: 'newClient.name', from: ['client.nickname'] }, { field: 'newClient.kind', from: ['etag'] }, { field: 'etag', from: ['client'] }])), [
    'error: «newClient.name»: client.nickname gibt es im In nicht.',
    'warn: «newClient.kind» gibt es im Out nicht (mehr).',
    'warn: «etag»: client ist Client, das Feld String - ohne Typ-Mapper dazwischen.',
  ]);
  // an object in an object: set on what its parent is set on - without a line onto either its required fields need one
  assert.deepEqual(texts(mapping([{ field: 'newClient', from: ['existingClient'] }, { field: 'newClient.master.segment', from: ['etag'] }, { field: 'etag', from: ['etag'] }])), []);
  assert.deepEqual(texts(mapping([
    { field: 'newClient.clientKey', from: ['client.clientKey'] }, { field: 'newClient.firstName', from: ['client.firstName'] }, { field: 'newClient.etag', from: ['etag'] },
    { field: 'newClient.master.segment', from: ['etag'] }, { field: 'etag', from: ['etag'] },
  ])), ['error: «newClient.master.clientType» bekommt keinen Wert - eine Linie ziehen.']);
});

test('in Scala: a method from the In to the Out - a copy of the line onto the object, the first one set by orElse; the test checks it', () => {
  const { worker, test: t } = files(merge);
  assert.match(worker, /newClient <- ZIO\.attempt\(mapClient\(in\.existingClient, in\.client\)\)/, worker);
  assert.match(worker, /def mapClient\(existingClient: Client, client: Client\): Client =\n\s+existingClient\.copy\(\n\s+name = client\.name\.orElse\(existingClient\.name\),\n\s+firstName = client\.firstName\n\s+\)/, worker);
  assert.match(t, /val existingClient = Client\.example\n\s+val client = Client\.example\n\s+val result = Mocked\(\)\.mapClient\(existingClient, client\)\n\s+assertEquals\(result\.name, client\.name\.orElse\(existingClient\.name\)\)\n\s+assertEquals\(result\.firstName, client\.firstName\)/, t);
});

test('in Scala without a line onto the object: its class field by field - optional not mapped None, required a TODO, optional onto required fails', () => {
  const { worker } = files(mapping([{ field: 'newClient.clientKey', from: ['existingClient.clientKey'] }, { field: 'newClient.firstName', from: ['client.name'] }, { field: 'newClient.master', from: ['client.master'] }]));
  assert.match(worker, /Client\(\n\s+clientKey = existingClient\.clientKey,\n\s+name = None,\n\s+firstName = client\.name\.getOrElse\(throw IllegalArgumentException\("Map Client: newClient\.firstName fehlt"\)\),\n\s+etag = \?\?\? \/\* TODO newClient\.etag: nicht zugeordnet \*\/,\n\s+master = client\.master\n\s+\)/, worker);
});

test('in Scala an object in an object: a copy of its own - mapped into an optional one; a FEEL expression translated', () => {
  const m = mapping([{ field: 'newClient', from: ['existingClient'] }, { field: 'newClient.master.clientType', from: ['client.firstName'] }]);
  const req = files(m);
  assert.match(req.worker, /existingClient\.copy\(\n\s+master = existingClient\.master\.copy\(\n\s+clientType = client\.firstName\n\s+\)\n\s+\)/, req.worker);
  assert.match(req.test, /assertEquals\(result\.master\.clientType, client\.firstName\)/, req.test);
  const opt = files(m, true);
  assert.match(opt.worker, /master = existingClient\.master\.map\(master =>\n\s+master\.copy\(\n\s+clientType = client\.firstName\n\s+\)\n\s+\)/, opt.worker);
  assert.doesNotMatch(opt.test, /result\.master/);
  const expr = files(mapping([{ field: 'newClient', from: ['existingClient'] }, { field: 'newClient.etag', from: [], expression: '= "*"' }]));
  assert.match(expr.worker, /existingClient\.copy\(\n\s+etag = "\*"\n\s+\)/, expr.worker);
});

test('in Scala several variables in the Out: a tuple - its call sets each one', () => {
  const m = mapping([{ field: 'newClient', from: ['existingClient'] }, { field: 'changed', from: [], expression: '= true' }], { out: [f('newClient', 'client'), f('changed', 'Boolean')] });
  const { worker, test: t } = files(m);
  assert.match(worker, /\(newClient, changed\) <- ZIO\.attempt\(mapClient\(in\.existingClient, in\.client\)\)/, worker);
  assert.match(worker, /def mapClient\(existingClient: Client, client: Client\): \(Client, Boolean\) =\n\s+\(\n\s+existingClient,\n\s+true\n\s+\)/, worker);
  assert.match(t, /assertEquals\(result\._1, existingClient\)\n\s+assertEquals\(result\._2, true\)/, t);
});

test('a mapping stored without an In or Out reads as empty - nothing breaks on it', async () => {
  const { mappingOf } = await import('../src/fieldMapping');
  const { mappingVarNodes } = await import('../src/feel');
  const old = { fields: [{ field: 'name', from: ['client.name'] }] } as unknown as FieldMapping;
  assert.deepEqual(mappingOf(old), { in: [], out: [], fields: [{ field: 'name', from: ['client.name'] }] });
  assert.equal(inOutIssues(old, []).length, 1);
  const spec = { ...orchestration(merge), steps: [] } as unknown as Parameters<typeof mappingVarNodes>[1];
  assert.deepEqual(mappingVarNodes(old, spec, null).sources, []);
  const { worker } = files(old);
  assert.match(worker, /TODO «Map Client»: das Mapping hat kein Out/);
});

test('a rename of an In follows into the FEEL expressions of the lines; removed, such a line goes too', () => {
  const m: FieldMapping = { in: [], out: [], fields: [
    { field: 'a', from: [], expression: 'client.name + " " + other.client' },
    { field: 'b', from: [], expression: 'clientX' },
    { field: 'c', from: ['client.id'] },
  ] };
  assert.deepEqual(renamedVar(m, 'in', 'client', 'customer').fields, [
    { field: 'a', from: [], expression: 'customer.name + " " + other.client' },
    { field: 'b', from: [], expression: 'clientX' },
    { field: 'c', from: ['customer.id'] },
  ]);
  assert.deepEqual(renamedVar(m, 'in', 'client', null).fields, [{ field: 'b', from: [], expression: 'clientX' }]);
  // text in quotes stays; an empty name renames nothing
  const q: FieldMapping = { in: [], out: [], fields: [{ field: 'a', from: [], expression: 'if client.kind = "client \\" client" then client else "client"' }] };
  assert.equal(renamedVar(q, 'in', 'client', 'c').fields[0].expression, 'if c.kind = "client \\" client" then c else "client"');
  assert.equal(renamedVar(q, 'in', '', 'c'), q);
  // onto a name another In has: the lines stay - before and after the list has the new name
  const two: FieldMapping = { in: [f('a', 'client'), f('b', 'client')], out: [], fields: [{ field: 'x', from: ['a.id'] }, { field: 'y', from: ['b.id'] }] };
  assert.equal(renamedVar(two, 'in', 'a', 'b'), two);
  const listed = { ...two, in: [f('b', 'client'), f('b', 'client')] };
  assert.equal(renamedVar(listed, 'in', 'a', 'b'), listed);
  assert.deepEqual(renamedVar({ ...two, in: [f('c', 'client'), f('b', 'client')] }, 'in', 'a', 'c').fields[0], { field: 'x', from: ['c.id'] });
  // a new name is taken as it is - no replacement pattern
  assert.equal(renamedVar({ in: [], out: [], fields: [{ field: 'a', from: [], expression: 'client + 1' }] }, 'in', 'client', '$&x').fields[0].expression, '$&x + 1');
  assert.deepEqual(renamedVar({ in: [], out: [], fields: [{ field: 'a', from: [], expression: '"client"' }] }, 'in', 'client', null).fields, [{ field: 'a', from: [], expression: '"client"' }]);
});
