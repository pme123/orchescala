// The type of an output comes from its source, not from its name: `existingClient = composedClient`
// writes a new process variable that has the type of `composedClient` - a field of the Out with the
// name `existingClient` does not exist and is no yardstick.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scanScala } from '../src/domainScan';
import { declaredVariables, expectedOfNode, outputRowType, outputSource, processVariables, resultVariables, type VarNode } from '../src/feel';
import type { DomainType, Model, ProcessSpec, Step, TypeDef } from '../src/types';

const composed: VarNode = {
  name: 'composedClient', type: 'context', label: 'ComposedClient', source: 'Ergebnis (GetClient.Out)',
  children: [{ name: 'client', type: 'context', label: 'Client', source: 'Feld von ComposedClient', children: [] }],
};
const vars: VarNode[] = [composed, { name: 'status', type: 'string', label: 'Status', source: 'In', values: ['open', 'closed'] }];

test('outputSource: a plain path into the variables - null for anything else', () => {
  assert.equal(outputSource('= composedClient', vars)?.label, 'ComposedClient');
  assert.equal(outputSource('=composedClient . client', vars)?.label, 'Client');
  assert.equal(outputSource('= composedClient.unknown', vars), null);
  assert.equal(outputSource('= if true then composedClient else null', vars), null);
  assert.equal(outputSource('composedClient', vars), null);
});

test('expectedOfNode: the kind of the chip from the node', () => {
  const client: TypeDef = { id: 'client', name: 'Client', kind: 'enum', values: [{ name: 'Person', fields: [] }] };
  assert.deepEqual(expectedOfNode(composed), { accepts: ['context'], label: 'ComposedClient', kind: 'class' });
  assert.equal(expectedOfNode(composed.children![0], [client])?.kind, 'enum');
  assert.deepEqual(expectedOfNode({ ...vars[1], optional: true }), { accepts: ['string', 'nil'], label: 'Status', kind: 'enum', values: ['open', 'closed'] });
  assert.equal(expectedOfNode({ name: 'xs', type: 'list', label: 'Seq[Client]', source: 'In' })?.kind, 'list');
  assert.equal(expectedOfNode({ name: 'm', type: 'context', label: 'Map[String, Json]', source: 'In', open: true })?.kind, 'map');
  assert.equal(expectedOfNode({ name: 'x', type: 'any', label: '?', source: 'Ausgabe' }), null);
});

test('expectedOfNode: an ADT from the domain catalog is an enum', () => {
  const clientDom = { id: 'acme.domain.Client', name: 'Client', pkg: 'acme.domain', kind: 'enum', importPath: 'acme.domain.Client' } as DomainType;
  const model = { domainTypes: [clientDom] } as unknown as Model;
  assert.equal(expectedOfNode(composed.children![0], [], model)?.kind, 'enum');
  assert.equal(expectedOfNode(composed.children![0], [], null)?.kind, 'class');
});

// the row of an output: the name is a process variable, the source path gives the type
const node = (name: string, label: string, type: VarNode['type'] = 'context', source = 'In'): VarNode => ({ name, type, label, source });

test('outputRowType: a new variable takes the type of its source - no yardstick, no grey FEEL chip', () => {
  const row = outputRowType({ name: 'existingClient', expression: '= composedClient' }, vars, []);
  assert.equal(row.expected, null);
  assert.equal(row.source?.label, 'ComposedClient');
  assert.equal(row.path, 'composedClient');
  assert.equal(row.issue, null);
  assert.equal(row.showResult, false);
});

test('outputRowType: no plain path - the FEEL kind is all there is', () => {
  const row = outputRowType({ name: 'existingClient', expression: '= if true then composedClient else null' }, vars, []);
  assert.deepEqual([row.source, row.path, row.showResult], [null, null, true]);
});

test('outputRowType: a declared variable is the yardstick - another class is a warning', () => {
  const declared = [node('client', 'Client')];
  const same = outputRowType({ name: 'client', expression: '= composedClient.client' }, vars, declared);
  assert.equal(same.expected?.label, 'Client');
  assert.equal(same.issue, null);
  assert.equal(same.showResult, true);
  const other = outputRowType({ name: 'client', expression: '= composedClient' }, vars, declared);
  assert.equal(other.issue, 'Die Quelle ist ComposedClient, die Prozessvariable «client» ist als Client definiert (In).');
  // converted into another type: the class of the source does not count
  assert.equal(outputRowType({ name: 'client', expression: '= composedClient', mapTo: 'Client' }, vars, declared).issue, null);
});

test('outputRowType: lists compare their elements - scalars and other shapes are the FEEL check', () => {
  const results = [node('persons', 'Seq[Person]', 'list', 'Ergebnis'), node('names', 'Seq[String]', 'list', 'Ergebnis'), node('one', 'Person', 'context', 'Ergebnis')];
  const declared = [node('clients', 'Seq[Client]', 'list')];
  assert.match(outputRowType({ name: 'clients', expression: '= persons' }, results, declared).issue ?? '', /Seq\[Person\].*Seq\[Client\]/);
  assert.equal(outputRowType({ name: 'clients', expression: '= names' }, results, declared).issue, null);
  assert.equal(outputRowType({ name: 'clients', expression: '= one' }, results, declared).issue, null);
  // Option does not count
  assert.equal(outputRowType({ name: 'client', expression: '= one' }, results, [node('client', 'Option[Person]')]).issue, null);
});

test('outputRowType: the source reads the result of the step even where a declared variable has the same name', () => {
  // `status` of the result (OtherStatus) shadows the In variable `status` (Status) in the source
  const results = [node('status', 'OtherStatus', 'context', 'Ergebnis'), node('status', 'Status')];
  const row = outputRowType({ name: 'status', expression: '= status' }, results, [node('status', 'Status')]);
  assert.equal(row.source?.label, 'OtherStatus');
  assert.match(row.issue ?? '', /Die Quelle ist OtherStatus/);
});

test('outputRowType: the same class with its prefix is no other class - an alias gives no verdict', () => {
  const results = [node('client', 'acme.domain.Client', 'context', 'Ergebnis'), node('other', 'GetClient.Client', 'context', 'Ergebnis'), node('clients', 'Clients', 'context', 'Ergebnis')];
  const declared = [node('client', 'Client'), node('a', 'GetA.Out'), node('c', 'Seq[Client]')];
  assert.equal(outputRowType({ name: 'client', expression: '= client' }, results, declared).issue, null);
  assert.equal(outputRowType({ name: 'client', expression: '= other' }, results, declared).issue, null);
  assert.match(outputRowType({ name: 'a', expression: '= other' }, results, declared).issue ?? '', /GetClient\.Client.*GetA\.Out/);
  const alias = { domainTypes: [{ id: 'acme.domain.Clients', name: 'Clients', pkg: 'acme.domain', kind: 'alias', importPath: 'acme.domain.Clients' }] } as unknown as Model;
  assert.equal(outputRowType({ name: 'client', expression: '= clients' }, results, declared, [], alias).issue, null);
});

// the wiring in the app: the result variables of the step are the source, the
// declared process variables of the spec the yardstick
const clientSource = `package acme.client.domain.v1

object GetClient extends CompanyBpmnServiceTaskDsl:
  val topicName = "acme-client-get"
  val descr: String = ""
  case class In(clientKey: Long)
  case class Person(name: String)
  case class Company(uid: String)
  enum Out:
    case PersonOut(client: Person)
    case CompanyOut(client: Company)
end GetClient
`;
const clientModel = { domainTypes: scanScala(clientSource, 'GetClient.scala') } as unknown as Model;
const getClient = (outVariant?: string): Step => ({
  id: 'GetClient', name: 'Get Client', kind: 'service', topic: 'acme-client-get', ...(outVariant ? { outVariant } : {}),
  outputs: [{ name: 'existingClient', expression: '= client' }],
} as Step);
const clientSpec = (step: Step, rootFields: TypeDef['fields'] = []): ProcessSpec => ({
  processId: 'acme-clientV1', name: 'acme-clientV1', engine: 'c8', steps: [step],
  types: [{ id: 't-in', name: 'In', kind: 'case', root: true, fields: rootFields }],
} as unknown as ProcessSpec);

test('wiring: the chosen case of an enum Out types the source - a declared In variable is the yardstick', () => {
  for (const [variant, label] of [['PersonOut', 'Person'], ['CompanyOut', 'Company']] as const) {
    const step = getClient(variant);
    const spec = clientSpec(step);
    const row = outputRowType(step.outputs![0], resultVariables(step, spec, clientModel, null), declaredVariables(processVariables(spec, clientModel)), spec.types, clientModel);
    assert.equal(row.source?.label, label, variant);
    assert.equal(row.expected, null);
  }
  const step = getClient('CompanyOut');
  const spec = clientSpec(step, [{ id: 'f', name: 'existingClient', type: 'String' }]);
  const declared = declaredVariables(processVariables(spec, clientModel));
  assert.deepEqual(declared.map(v => [v.name, v.source]), [['existingClient', 'In']]);
  const row = outputRowType(step.outputs![0], resultVariables(step, spec, clientModel, null), declared, spec.types, clientModel);
  assert.equal(row.expected?.label, 'String');
  assert.equal(row.showResult, true);
});
