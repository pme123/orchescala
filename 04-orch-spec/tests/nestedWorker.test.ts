// A service of a nested API with an ADT In and Out — what the generator writes for the worker,
// as a project writes it by hand: the base paths per level, the case-by-case mappings, the test.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newCollection } from '../src/services/collection';
import { baseChain, chainFiles, chainIssue, projectBaseVar } from '../src/services/basePaths';
import { feelCondition, feelToScala } from '../src/services/feelScala';
import { collectionFiles, descr } from '../src/services/scalaCollection';
import { indexTypes, renderType } from '../src/scala';
import type { ServiceCollectionSpec } from '../src/services/types';
import type { TypeDef } from '../src/types';

const person: TypeDef = { id: 't-person', name: 'Person', kind: 'case', fields: [{ id: 'p1', name: 'name', type: 'String' }] };
const request: TypeDef = { id: 't-req', name: 'ReadPersonsRequest', kind: 'case', fields: [
  { id: 'r1', name: 'clientKeys', type: 'String', collection: true, optional: true },
  { id: 'r2', name: 'readFromCore', type: 'Boolean', optional: true },
] };
const response: TypeDef = { id: 't-res', name: 'ReadPersonsResponse', kind: 'case', fields: [
  { id: 'r3', name: 'persons', type: 't-person', collection: true, optional: true },
] };
const inType: TypeDef = { id: 't-in', name: 'In', kind: 'enum', interactionId: 's1',
  fields: [{ id: 'i0', name: 'readFromCore', type: 'Boolean', optional: true }],
  values: [
    { name: 'Standard', fields: [{ id: 'i1', name: 'clientKeys', type: 'String', collection: true, optional: true }] },
    { name: 'ByKey', fields: [{ id: 'i2', name: 'clientKey', type: 'String' }] },
  ] } as TypeDef;
const outType: TypeDef = { id: 't-out', name: 'Out', kind: 'enum', interactionId: 's1', values: [
  { name: 'Standard', fields: [{ id: 'o1', name: 'persons', type: 't-person', collection: true }] },
  { name: 'ByKey', fields: [{ id: 'o2', name: 'person', type: 't-person' }] },
] } as TypeDef;

function spec(): ServiceCollectionSpec {
  const c = newCollection({ title: 'Persons', project: 'acme-crm', api: 'clientMaster.persons', apiVersion: 1 });
  return {
    ...c,
    types: [person, request, response, inType, outType],
    services: [{
      id: 's1', name: 'PostReadPersons', api: 'clientMaster.persons', apiVersion: 1, status: 'draft',
      method: 'POST', path: '/api/ClientMaster/v1/Persons/ReadPersons', params: [],
      serviceIn: { type: 't-req' }, serviceOut: { type: 't-res' }, responseStatus: 200,
      inTypeId: 't-in', outTypeId: 't-out',
      bodyMappings: [{ name: 'clientKeys', expression: '= clientKeys' }, { name: 'readFromCore', expression: '= readFromCore' }],
      outCases: [
        { name: 'Standard', condition: '= in.clientKey = null', mappings: [{ name: 'persons', expression: '= body.persons' }] },
        { name: 'ByKey', mappings: [{ name: 'person', expression: '= body.persons[1]' }] },
      ],
    }],
  };
}

const fileOf = (name: string) => collectionFiles(spec()).find(f => f.path.endsWith(name))!;

test('the base paths: the project, each level, the API — the worker only the rest', () => {
  assert.equal(projectBaseVar('acme-crm'), 'crmBasePath');
  assert.equal(projectBaseVar('acme-core-neo'), 'coreNeoBasePath');
  const chain = baseChain(spec(), { project: 'acme-crm', api: 'clientMaster.persons', apiVersion: 1 });
  assert.deepEqual(chain, { prefix: ['api'], levels: [{ level: 'clientMaster', segments: ['ClientMaster', 'v1'] }], api: ['Persons'] });
  const project = fileOf('/acme/crm/worker/exports.scala');
  assert.match(project.content, /^package acme\.crm\.worker\n\n/);
  assert.match(project.content, /lazy val crmBasePath: String =\n  \?\?\? \/\* TODO the URL of the project, with \/api at the end/);
  const level = fileOf('/acme/crm/worker/clientMaster/exports.scala');
  assert.match(level.content, /^package acme\.crm\.worker\npackage clientMaster\n\n/);
  assert.match(level.content, /def clientMasterBasePath: String =\n  s"\$crmBasePath\/ClientMaster\/v1"/);
  const api = fileOf('/clientMaster/persons/v1/exports.scala');
  assert.match(api.content, /^package acme\.crm\.worker\npackage clientMaster\npackage persons\.v1\n/);
  assert.match(api.content, /def serviceBasePath: String =\n  s"\$clientMasterBasePath\/Persons"/);
  const worker = fileOf('PostReadPersonsWorker.scala').content;
  assert.match(worker, /uri"\$serviceBasePath\/ReadPersons"/);
  // an API without levels in its paths stays as it was
  const flat = { ...spec(), services: spec().services.map(s => ({ ...s, path: '/persons/read' })) };
  assert.equal(baseChain(flat, { project: 'acme-crm', api: 'clientMaster.persons', apiVersion: 1 }), null);
  assert.ok(!collectionFiles(flat).some(f => f.path.endsWith('/worker/clientMaster/exports.scala')));
});

test('the worker: a field one case lacks is a TODO, a missing list is empty, an element of a list may be missing', () => {
  const worker = fileOf('PostReadPersonsWorker.scala').content;
  assert.match(worker, /clientKeys = \(in match \{ case v: In\.Standard => v\.clientKeys; case _: In\.ByKey => \?\?\? \/\* TODO clientKeys: In\.ByKey hat kein Feld clientKeys \*\/ \}\)/);
  assert.match(worker, /if !in\.isInstanceOf\[In\.ByKey\] then/);
  assert.match(worker, /persons = body\.persons\.getOrElse\(Seq\.empty\)/);
  assert.match(worker, /person <- body\.persons\.flatMap\(_\.headOption\)\.toRight\(ServiceMappingError\("PostReadPersons: person fehlt in der Antwort"\)\)/);
});

test('the test of the worker: the whole chain in the URI, each case of the In, the message of a missing value', () => {
  const t = fileOf('PostReadPersonsWorkerTest.scala').content;
  assert.match(t, /^package acme\.crm\.worker\npackage clientMaster\npackage persons\.v1\n\nimport WorkerError\.\*\n/);
  assert.match(t, /s"\$crmBasePath\/ClientMaster\/v1\/Persons\/ReadPersons"/);
  assert.match(t, /test\("outputMapper ByKey"\):\n    assertEquals\(\n      worker\.outputMapper\(\n        ServiceOut\.mock\.toServiceResponse,\n        In\.ByKey\.example\n      \),\n      Right\(Out\.ByKey\.example\)/);
  assert.match(t, /test\("outputMapper ByKey without person"\):[\s\S]*In\.ByKey\.exampleMinimal[\s\S]*Left\(ServiceMappingError\("PostReadPersons: person fehlt in der Antwort"\)\)/);
});

test('exampleMinimal: a required list or map is empty — as the output mapper makes it of a missing one', () => {
  const out = renderType(outType, indexTypes([outType, person]));
  assert.match(out, /object Standard:[\s\S]*lazy val exampleMinimal = example\.copy\(\n {6}persons = Seq\.empty\n {4}\)\n {2}end Standard/);
  // a required single value stays
  assert.match(out, /object ByKey:[\s\S]*lazy val exampleMinimal = example\n {2}end ByKey/);
  const t: TypeDef = { id: 'm', name: 'Tags', kind: 'case', fields: [
    { id: 'a', name: 'byName', type: 'String', map: true },
    { id: 'b', name: 'names', type: 'String', collection: true, optional: true },
  ] };
  assert.match(renderType(t, indexTypes([t])), /lazy val exampleMinimal = example\.copy\(\n {4}byName = Map\.empty,\n {4}names = None\n {2}\)/);
});

test('FEEL: `in.` names the In, an element of a list, a case field checked against null', () => {
  const vars = new Map([
    ['clientKey', { scala: 'in.clientKey', type: 'String' }],
    ['persons', { scala: 'body.persons', type: 't-person', collection: true, optional: true }],
  ]);
  assert.equal(feelToScala('= in.clientKey', vars, []).scala, 'in.clientKey');
  assert.deepEqual(feelToScala('= persons[1]', vars, []), { scala: 'body.persons.flatMap(_.headOption)', optional: true });
  assert.equal(feelToScala('= persons[2]', vars, []).scala, 'body.persons.flatMap(_.lift(1))');
  assert.equal(feelToScala('= persons[-1]', vars, []).scala, 'body.persons.flatMap(_.lastOption)');
  assert.ok(feelToScala('= clientKey[1]', vars, []).todo);
  // a call is no list of a variable
  assert.ok(!/headOption/.test(feelToScala('= f(persons)[1]', vars, []).scala ?? ''));
  const byCase = new Map([['clientKey', {
    scala: '(in match { case v: In.ByKey => Some(v.clientKey); case _ => None })', type: 'String', optional: true,
    byCase: { at: 'in', cases: ['In.Standard', 'In.ByKey'], own: { 'In.ByKey': { scala: 'v.clientKey', optional: false } } },
  }]]);
  assert.equal(feelCondition('= in.clientKey = null', byCase, []).scala, '!in.isInstanceOf[In.ByKey]');
  assert.equal(feelCondition('= clientKey != null', byCase, []).scala, 'in.isInstanceOf[In.ByKey]');
});

test('the description has no blanks at the end of a line; a text field takes a default of another type as text', () => {
  assert.equal(descr('First\n \nSecond  '), '  val descr: String =\n    """First\n      |\n      |Second\n      |""".stripMargin');
  const t: TypeDef = { id: 'x', name: 'Key', kind: 'case', fields: [{ id: 'k', name: 'clientKey', type: 'String' }] };
  const model = { version: 1, services: [], domainDefaults: [{ name: 'defaultClientKey', pkg: 'acme.orchescala.domain', type: 'Long' }] } as never;
  assert.match(renderType(t, indexTypes([t], model)), /clientKey = defaultClientKey\.toString/);
  const long: TypeDef = { ...t, fields: [{ id: 'k', name: 'clientKey', type: 'Long' }] };
  assert.match(renderType(long, indexTypes([long], model)), /clientKey = defaultClientKey\n/);
});

const withPaths = (...paths: string[]): ServiceCollectionSpec => ({
  ...spec(),
  services: paths.map((path, i) => ({ ...spec().services[0], id: `s${i}`, name: `Svc${i}`, path })),
});
const persons = { project: 'acme-crm', api: 'clientMaster.persons', apiVersion: 1 };

test('the chain: a version after the API only if every service has it and something after it', () => {
  assert.deepEqual(baseChain(withPaths('/api/ClientMaster/v1/Persons/v2/Read', '/api/ClientMaster/v1/Persons/v2/List'), persons)?.api, ['Persons', 'v2']);
  // one path ends at the version: the version belongs to the services, for all of them
  assert.deepEqual(baseChain(withPaths('/api/ClientMaster/v1/Persons/v2', '/api/ClientMaster/v1/Persons/v2/List'), persons)?.api, ['Persons']);
  assert.deepEqual(baseChain(withPaths('/api/ClientMaster/v1/Persons/v2'), persons)?.api, ['Persons']);
});

test('the chain: a path that does not follow the levels is a TODO, not a silent fallback', () => {
  const c = withPaths('/api/ClientMaster/v1/Persons/Read', '/legacy/persons');
  assert.equal(baseChain(c, persons), null);
  assert.equal(chainIssue(c, persons), 'the paths of Svc1 do not follow the levels of clientMaster.persons');
  const exports = collectionFiles(c).find(f => f.path.endsWith('/clientMaster/persons/v1/exports.scala'))!.content;
  assert.match(exports, /\/\* TODO not from the base of the levels: the paths of Svc1 do not follow the levels of clientMaster\.persons \*\//);
  // a flat API (no path follows the levels) stays without a note
  assert.equal(chainIssue(withPaths('/persons/read'), persons), null);
});

test('the URI of the test: only the interpolations name the In — a segment `in.x` of the path stays', () => {
  const keyIn: TypeDef = { id: 't-in', name: 'In', kind: 'case', interactionId: 's1', fields: [{ id: 'k', name: 'key', type: 'String' }] };
  const c: ServiceCollectionSpec = {
    ...spec(),
    types: [person, response, keyIn, outType],
    services: [{
      ...spec().services[0], method: 'GET', path: '/api/ClientMaster/v1/Persons/in.json/{key}', serviceIn: undefined, bodyMappings: [],
      params: [{ name: 'key', in: 'path', type: 'String', required: true, expression: '= in.key' }],
    }],
  } as never;
  const t = collectionFiles(c).find(f => f.path.endsWith('WorkerTest.scala'))!.content;
  assert.match(t, /s"\$crmBasePath\/ClientMaster\/v1\/Persons\/in\.json\/\$\{In\.example\.key\}"/);
});
