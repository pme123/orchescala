// An orchestration that decides by a value of a service: the exclusive gateway is a match on the
// type of the value (an enum of the domain), the services with an ADT In get the case the step
// chose, their ADT Out is narrowed to the case it reads, and a class of a service becomes the type
// the Out of the orchestration defines (`person` → `Client.Person`). The test of the worker runs
// each branch with the services answering their examples.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { scanScala } from '../src/domainScan';
import { newCollection } from '../src/services/collection';
import { newOrchestration } from '../src/services/orchestration';
import { fittingCase, matchOf, orchestrationFiles } from '../src/services/scalaOrchestration';
import type { CollectionService, ServiceCollectionSpec, ServiceOrchestrationSpec } from '../src/services/types';
import type { Field, Model, TypeDef } from '../src/types';

(globalThis as unknown as { DOMParser: unknown }).DOMParser ??= DOMParser;

const f = (name: string, type: string, optional = true): Field => ({ id: `f-${name}-${type}`, name, type, ...(optional ? { optional: true } : {}) });
const caseType = (id: string, name: string, fields: Field[], interactionId?: string): TypeDef =>
  ({ id, name, kind: 'case', ...(interactionId ? { interactionId } : {}), fields });
// In: `def readFromFcs` + Standard(clientKeys) / ClientKey(clientKey); Out: Standard(<many>) / ClientKey(<one>)
const adtIn = (id: string, owner: string): TypeDef => ({
  id, name: 'In', kind: 'enum', interactionId: owner, fields: [f('readFromFcs', 'Boolean')],
  values: [{ name: 'Standard', fields: [f('clientKeys', 'String')] }, { name: 'ClientKey', fields: [f('clientKey', 'String', false)] }],
});
const adtOut = (id: string, owner: string, one: string, type: string): TypeDef => ({
  id, name: 'Out', kind: 'enum', interactionId: owner,
  values: [{ name: 'Standard', fields: [{ ...f(`${one}s`, type), collection: true }] }, { name: 'ClientKey', fields: [f(one, type, false)] }],
});
const svc = (id: string, name: string): CollectionService =>
  ({ id, name, api: 'party', apiVersion: 1, status: 'implemented', method: 'POST', path: `/${id}`, params: [], inTypeId: `${id}-in`, outTypeId: `${id}-out` });
const collection = (): ServiceCollectionSpec => ({
  ...newCollection({ title: 'Party', project: 'acme-crm', api: 'party', apiVersion: 1 }),
  types: [
    caseType('kind-in', 'In', [f('clientKey', 'String', false)], 'kind'),
    caseType('kind-out', 'Out', [f('kind', 'dom:acme.crm.domain.schema.Kind', false)], 'kind'),
    adtIn('person-in', 'person'), adtOut('person-out', 'person', 'person', 'person3'),
    adtIn('company-in', 'company'), adtOut('company-out', 'company', 'company', 'company3'),
    caseType('person3', 'Person3', [f('clientKey', 'String'), f('firstName', 'String')]),
    caseType('company3', 'Company3', [f('clientKey', 'String'), f('name', 'String'), f('uid', 'String')]),
  ],
  services: [svc('kind', 'GetKind'), svc('person', 'ReadPerson'), svc('company', 'ReadCompany')],
});
const model = { version: 1, services: [], domainTypes: scanScala('package acme.crm.domain\npackage schema\n\nenum Kind:\n  case Person, Company\n', 'schema/Kind.scala') } as unknown as Model;

const task = (id: string) => `<bpmn:serviceTask id="${id}" name="${id}" />`;
const flow = (id: string, from: string, to: string) => `<bpmn:sequenceFlow id="${id}" sourceRef="${from}" targetRef="${to}" name="${id}" />`;
const orchestration = (conditions: Record<string, string>): ServiceOrchestrationSpec => {
  const o = newOrchestration({ title: 'Kunde lesen', project: 'acme-crm', api: 'client', apiVersion: 1, name: 'GetClient' });
  const client: TypeDef = {
    id: 'client', name: 'Client', kind: 'enum', fields: [f('clientKey', 'String')],
    values: [{ name: 'Person', fields: [f('firstName', 'String')] }, { name: 'Company', fields: [f('name', 'String'), f('uid', 'String')] }],
  };
  o.types.find(x => x.id === o.inTypeId)!.fields = [f('clientKey', 'String', false), f('readFromFcs', 'Boolean')];
  o.types.find(x => x.id === o.outTypeId)!.fields = [f('client', 'client', false)];
  return {
    ...o,
    types: [...o.types, client],
    bpmn: `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d" targetNamespace="x">
  <bpmn:process id="acme-crm-clientV1-GetClient" isExecutable="false">
    <bpmn:startEvent id="Start" />
    ${task('Kind')}<bpmn:exclusiveGateway id="Which" /><bpmn:exclusiveGateway id="Merge" />${task('ReadP')}${task('ReadC')}
    ${flow('f1', 'Start', 'Kind')}${flow('f2', 'Kind', 'Which')}
    ${flow('Person', 'Which', 'ReadP')}${flow('Company', 'Which', 'ReadC')}
    ${flow('f3', 'ReadP', 'Merge')}${flow('f4', 'ReadC', 'Merge')}${flow('f5', 'Merge', 'End')}
    <bpmn:endEvent id="End" />
  </bpmn:process>
</bpmn:definitions>`,
    tasks: {
      Kind: { service: 'acme-crm-partyV1.GetKind', outputs: [{ name: 'kind', expression: '= kind' }] },
      ReadP: { service: 'acme-crm-partyV1.ReadPerson', inCase: 'ClientKey', outputs: [{ name: 'client', expression: '= person' }] },
      ReadC: { service: 'acme-crm-partyV1.ReadCompany', inCase: 'ClientKey', outputs: [{ name: 'client', expression: '= company' }] },
    },
    conditions,
    outMappings: [{ name: 'client', expression: '= client' }],
  };
};
const files = (conditions = { Person: '= kind = "Person"', Company: '= kind = "Company"' }) =>
  orchestrationFiles(orchestration(conditions), [collection()], model);

test('an exclusive gateway on one value of a domain enum: a match on its cases - all of them, no default', () => {
  const w = files().find(x => x.path.endsWith('/GetClientWorker.scala'))!.content;
  assert.match(w, /client <-\n\s+kind match\n\s+case Kind\.Person =>\n\s+\(for \{/, w);
  assert.match(w, /\n\s+case Kind\.Company =>\n\s+\(for \{/, w);
  assert.doesNotMatch(w, /case _ =>/);
  assert.match(w, /import acme\.crm\.domain\.schema\.Kind\n/);
  assert.match(w, /import acme\.crm\.domain\.client\.v1\.schema\.\*\n/);
});

test('an ADT In: the case the step chose with the shared fields; an ADT Out: narrowed to the case of that name', () => {
  const w = files().find(x => x.path.endsWith('/GetClientWorker.scala'))!.content;
  assert.match(w, /readPerson <- runReadPerson\(\n\s+ReadPerson\.In\.ClientKey\(\n\s+readFromFcs = in\.readFromFcs,\n\s+clientKey = in\.clientKey\n\s+\)\n\s+\)\.collect\(CustomError\("ReadPerson: nicht Out\.ClientKey"\)\) \{ case out: ReadPerson\.Out\.ClientKey => out \}/, w);
  // each service called by a method of its own - the test overrides it
  assert.match(w, /protected def runReadPerson\(in: ReadPerson\.In\): RunWorkZIOOutput\[ReadPerson\.Out\] =\n\s+ReadPersonWorker\(\)\n\s+\.runWorkFromWorkerUnsafe\(in\)\n\s+\.mapError\(e => CustomError\(s"ReadPerson: \$\{e\.errorMsg\}"\)\)/);
  assert.doesNotMatch(w, /\?\?\?/);
});

test('a class of a service into the type the Out defines: the case it fits, field by field', () => {
  const w = files().find(x => x.path.endsWith('/GetClientWorker.scala'))!.content;
  assert.match(w, /client = Client\.Person\(\n\s+clientKey = readPerson\.person\.clientKey,\n\s+firstName = readPerson\.person\.firstName\n\s+\)/, w);
  assert.match(w, /client = Client\.Company\(\n\s+clientKey = readCompany\.company\.clientKey,\n\s+name = readCompany\.company\.name,\n\s+uid = readCompany\.company\.uid\n\s+\)/, w);
});

test('the test of the worker: per branch the deciding service answers its value - the Out has the case of the branch', () => {
  const t = files().find(x => x.path.endsWith('/GetClientWorkerTest.scala'))!;
  assert.equal(t.path, '03-worker/src/test/scala/acme/crm/worker/client/v1/GetClientWorkerTest.scala');
  const c = t.content;
  assert.match(c, /class Mocked extends GetClientWorker:\n\s+override protected def runGetKind\(in: GetKind\.In\): RunWorkZIOOutput\[GetKind\.Out\] =\n\s+ZIO\.succeed\(GetKind\.Out\.example\)/);
  assert.match(c, /override protected def runReadPerson\(in: ReadPerson\.In\): RunWorkZIOOutput\[ReadPerson\.Out\] =\n\s+ZIO\.succeed\(ReadPerson\.Out\.ClientKey\.example\)/);
  assert.match(c, /test\("runWorkZIO Person"\):\n\s+val worker = new Mocked:\n\s+override protected def runGetKind[^\n]*\n\s+ZIO\.succeed\(GetKind\.Out\.example\.copy\(kind = Kind\.Person\)\)\n\s+val result = run\(worker, In\.example\)\n\s+assert\(result\.exists\(out => out\.client\.isInstanceOf\[Client\.Person\]\), result\)/, c);
  assert.match(c, /test\("runWorkZIO Company"\)[\s\S]*isInstanceOf\[Client\.Company\]/);
  assert.match(c, /given EngineRunContext = EngineRunContext\(DefaultEngineContext\.example, GeneralVariables\(\)\)/);
  assert.match(c, /import acme\.crm\.domain\.schema\.Kind\n/);
});

test('a value the enum lacks, or conditions on other things: no match - the if as before, the condition as Scala', () => {
  const w = files({ Person: '= kind = "Person"', Company: '= kind != "Person"' }).find(x => x.path.endsWith('/GetClientWorker.scala'))!.content;
  assert.doesNotMatch(w, / match\n/);
  assert.match(w, /if kind == Kind\.Person then/);
  assert.match(w, /else if kind != Kind\.Person then/);
});

test('matchOf: a text compares by its values, an optional one in Some - with a default; fittingCase by share, count, name', () => {
  const vars = new Map([['status', { scala: 'status', type: 'String', optional: true }]]);
  const m = matchOf(['= status = "A"', 'status = "B"'], vars, [])!;
  assert.deepEqual(m.patterns, ['Some("A")', 'Some("B")']);
  assert.equal(m.exhaustive, false);
  assert.equal(matchOf(['= status = "A"', '= other = "B"'], vars, []), null);
  const client: TypeDef = {
    id: 'c', name: 'Client', kind: 'enum',
    values: [{ name: 'Person', fields: [f('firstName', 'String')] }, { name: 'MultiplePersons', fields: [f('firstName', 'String'), f('firstNamePartner', 'String')] }],
  };
  assert.equal(fittingCase(client, caseType('p', 'NaturalPerson3', [f('firstName', 'String')])), 'Person');
  assert.equal(fittingCase(client, caseType('m', 'MultipleNaturalPerson2', [f('firstName', 'String'), f('firstNamePartner', 'String')])), 'MultiplePersons');
  assert.equal(fittingCase(client, caseType('x', 'Other', [f('zip', 'String')])), undefined);
});

// A script task with an implementation in FEEL: a method of the worker - the lists concatenated,
// each element in the case of the Out's type it fits - called in the `for`, with a test of its own.
const scripted = (script: string, resultVariable = 'clients'): ServiceOrchestrationSpec => {
  const o = orchestration({});
  o.types.find(x => x.id === o.outTypeId)!.fields = [{ ...f('clients', 'client', false), collection: true }];
  return {
    ...o,
    bpmn: `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d" targetNamespace="x">
  <bpmn:process id="acme-crm-clientV1-GetClient" isExecutable="false">
    <bpmn:startEvent id="Start" />${task('ReadP')}${task('ReadC')}<bpmn:scriptTask id="MergeClientsTask" name="Merge Clients" /><bpmn:endEvent id="End" />
    ${flow('f1', 'Start', 'ReadP')}${flow('f2', 'ReadP', 'ReadC')}${flow('f3', 'ReadC', 'MergeClientsTask')}${flow('f4', 'MergeClientsTask', 'End')}
  </bpmn:process>
</bpmn:definitions>`,
    tasks: {
      ReadP: { service: 'acme-crm-partyV1.ReadPerson', inCase: 'Standard', outputs: [{ name: 'persons', expression: '= persons' }] },
      ReadC: { service: 'acme-crm-partyV1.ReadCompany', inCase: 'Standard', outputs: [{ name: 'companys', expression: '= companys' }] },
      MergeClientsTask: { script, resultVariable },
    },
    conditions: {},
    outMappings: [{ name: 'clients', expression: '= clients' }],
  };
};

test('a script task in FEEL: a method of the worker - concatenate of lists, each element in the case it fits', () => {
  const fs = orchestrationFiles(scripted('= concatenate(persons, companys)'), [collection()], model);
  const w = fs.find(x => x.path.endsWith('/GetClientWorker.scala'))!.content;
  assert.match(w, /clients <- ZIO\.attempt\(mergeClients\(persons, companys\)\)\.mapError\(e => CustomError\(s"Merge Clients: \$\{e\.getMessage\}"\)\)/, w);
  assert.match(w, /def mergeClients\(persons: Option\[Seq\[Person3\]\], companys: Option\[Seq\[Company3\]\]\): Seq\[Client\] =\n\s+persons\.getOrElse\(Seq\.empty\)\.map\(x =>\n\s+Client\.Person\(\n\s+clientKey = x\.clientKey,\n\s+firstName = x\.firstName\n\s+\)\n\s+\) \+\+\n\s+companys\.getOrElse\(Seq\.empty\)\.map\(x =>\n\s+Client\.Company\(/, w);
  assert.match(w, /yield Out\(\n\s+clients = clients\n\s+\)/);
  const t = fs.find(x => x.path.endsWith('/GetClientWorkerTest.scala'))!.content;
  assert.match(t, /test\("mergeClients"\):\n\s+val persons = Some\(Seq\(Person3\.example\)\)\n\s+val companys = Some\(Seq\(Company3\.example\)\)\n\s+val result = Mocked\(\)\.mergeClients\(persons, companys\)\n\s+assertEquals\(result\.size, persons\.getOrElse\(Seq\.empty\)\.size \+ companys\.getOrElse\(Seq\.empty\)\.size\)\n\s+assert\(result\.exists\(_\.isInstanceOf\[Client\.Person\]\), result\)\n\s+assert\(result\.exists\(_\.isInstanceOf\[Client\.Company\]\), result\)/, t);
});

test('a script task in FEEL: another expression as a mapping; without a result variable a TODO', () => {
  const w = orchestrationFiles(scripted('= count(persons)'), [collection()], model).find(x => x.path.endsWith('/GetClientWorker.scala'))!.content;
  assert.match(w, /def mergeClients\(persons: Option\[Seq\[Person3\]\]\): Seq\[Client\] =\n\s+\?\?\? \/\* TODO/, w);
  const none = orchestrationFiles(scripted('= concatenate(persons, companys)', ''), [collection()], model).find(x => x.path.endsWith('/GetClientWorker.scala'))!.content;
  assert.match(none, /\/\/ TODO «Merge Clients»: die Implementierung hat keine Ergebnis-Variable/);
  assert.doesNotMatch(none, /def mergeClients/);
});

test('a script task in FEEL: flatten([…]) as concatenate - a list of lists stays one (the FEEL check says it)', () => {
  const method = (script: string) => orchestrationFiles(scripted(script), [collection()], model)
    .find(x => x.path.endsWith('/GetClientWorker.scala'))!.content.split('  def mergeClients')[1]?.split('\n\n')[0];
  const concat = method('= concatenate(persons, companys)');
  assert.match(concat ?? '', /Client\.Person[\s\S]*\) \+\+\n[\s\S]*Client\.Company/);
  assert.equal(method('= flatten([ persons, companys ])'), concat);
  assert.doesNotMatch(method('= [persons, companys]') ?? '', /Client\.Person/);
  // two lists side by side are no one list
  assert.doesNotMatch(method('= [persons] ++ [companys]') ?? '', /Client\.Person/);
});

test('an output converted into another type (mapTo): element by element, the case chosen or the fitting one', () => {
  const o = scripted('= concatenate(persons, companys)');
  o.tasks.ReadP = { ...o.tasks.ReadP, outputs: [{ name: 'persons', expression: '= persons', mapTo: 'client' }] };
  o.tasks.ReadC = { ...o.tasks.ReadC, outputs: [{ name: 'companys', expression: '= companys', mapTo: 'client', mapToCase: 'Company' }] };
  const w = orchestrationFiles(o, [collection()], model).find(x => x.path.endsWith('/GetClientWorker.scala'))!.content;
  assert.match(w, /persons = readPerson\.persons\.map\(_\.map\(x =>\n\s+Client\.Person\(\n\s+clientKey = x\.clientKey,\n\s+firstName = x\.firstName\n\s+\)\n\s+\)\)/, w);
  assert.match(w, /companys = readCompany\.companys\.map\(_\.map\(x =>\n\s+Client\.Company\(/);
  // the script reads them as clients - nothing more to convert
  assert.match(w, /def mergeClients\(persons: Option\[Seq\[Client\]\], companys: Option\[Seq\[Client\]\]\): Seq\[Client\] =\n\s+persons\.getOrElse\(Seq\.empty\) \+\+\n\s+companys\.getOrElse\(Seq\.empty\)\n/, w);
});

test('a script result that is no field of the Out: the type the step names - without one derived from lists of one type', () => {
  const mapped = (o: ServiceOrchestrationSpec) => {
    o.tasks.ReadP = { ...o.tasks.ReadP, outputs: [{ name: 'persons', expression: '= persons', mapTo: 'client' }] };
    o.tasks.ReadC = { ...o.tasks.ReadC, outputs: [{ name: 'companys', expression: '= companys', mapTo: 'client' }] };
    o.outMappings = [{ name: 'clients', expression: '= allClients' }];
    return o;
  };
  const method = (o: ServiceOrchestrationSpec) => orchestrationFiles(o, [collection()], model)
    .find(x => x.path.endsWith('/GetClientWorker.scala'))!.content.split('  def mergeClients')[1]?.split('\n')[0];
  const named = mapped(scripted('= flatten([persons, companys])', 'allClients'));
  named.tasks.MergeClientsTask = { ...named.tasks.MergeClientsTask, resultType: 'client', resultCollection: true };
  assert.equal(method(named), '(persons: Option[Seq[Client]], companys: Option[Seq[Client]]): Seq[Client] =');
  // without a type: the lists are all clients - so is the result
  assert.equal(method(mapped(scripted('= concatenate(persons, companys)', 'allClients'))), '(persons: Option[Seq[Client]], companys: Option[Seq[Client]]): Seq[Client] =');
  // lists of different types: no type to derive - text, the compiler says it
  assert.match(method(scripted('= concatenate(persons, companys)', 'allClients')) ?? '', /\): String =$/);
});

test('a field of the Out without a mapping: the variable of the same name - otherwise the one of its type', () => {
  const o = scripted('= concatenate(persons, companys)', 'allClients');
  o.tasks.ReadP = { ...o.tasks.ReadP, outputs: [{ name: 'persons', expression: '= persons', mapTo: 'client' }] };
  o.tasks.ReadC = { ...o.tasks.ReadC, outputs: [{ name: 'companys', expression: '= companys', mapTo: 'client' }] };
  o.outMappings = undefined;
  const w = orchestrationFiles(o, [collection()], model).find(x => x.path.endsWith('/GetClientWorker.scala'))!.content;
  // allClients: derived Seq[Client] - the only one of the type of `clients`
  assert.match(w, /yield Out\(\n\s+clients = allClients\n\s+\)/, w);
});
