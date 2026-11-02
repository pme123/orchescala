// A caller passes mocks of the callee (`postAccountMock`) as its own
// variables — they are in the callee's `InConfig`, not in the catalog of inputs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scanScala } from '../src/domainScan';
import { acceptedEverywhere } from '../src/bpmn';
import { domainInputNames, inConfigFields } from '../src/feel';
import { collectFindings, withServiceRows } from '../src/findings';
import type { Mapping, Model, ProcessSpec, Step } from '../src/types';

const source = `package acme.product.domain
package openAccount.v2

object OpenAccountV2 extends CompanyBpmnProcessDsl:
  val processName = "acme-product-openAccountV2"

  case class In(
      clientKey: Long,
      inConfig: Option[InConfig] = None
  ) extends WithConfig[InConfig]

  case class InConfig(
      basisSetMock: Option[MockedServiceResponse[NoOutput]] = None,
      postAccountMock: Option[MockedServiceResponse[NoOutput]] = None
  )
end OpenAccountV2
`;

test('the fields of the InConfig of an In', () => {
  const model = { domainTypes: scanScala(source) } as unknown as Model;
  const inT = model.domainTypes!.find(t => t.name === 'OpenAccountV2.In')!;
  assert.deepEqual(inConfigFields(inT, model), ['basisSetMock', 'postAccountMock']);
  // without InConfig: none
  assert.deepEqual(inConfigFields(model.domainTypes!.find(t => t.name === 'OpenAccountV2.InConfig')!, model), []);
});

test('known inputs of a call: the fields of the In - inConfig too - and those of its InConfig', () => {
  const model = { domainTypes: scanScala(source) } as unknown as Model;
  const inT = model.domainTypes!.find(t => t.name === 'OpenAccountV2.In')!;
  assert.deepEqual(domainInputNames(inT, model), ['clientKey', 'inConfig', 'basisSetMock', 'postAccountMock']);
});

const callSpec = (inputs: Mapping[]): ProcessSpec => ({
  processId: 'acme-demoV1', name: 'acme-demoV1',
  steps: [{ id: 'OpenAccountCall', name: 'Open account', kind: 'call', calledProcess: 'acme-product-openAccountV2', inputs } as Step],
} as unknown as ProcessSpec);

test('a call gets no row inConfig - an old unchecked one goes, a checked one is warned about', () => {
  const model = { domainTypes: scanScala(source), services: [] } as unknown as Model;
  const rows = (s: ProcessSpec) => withServiceRows(s, model).spec.steps[0].inputs!.map(m => `${m.name}${m.disabled ? ' (ab)' : ''}`);
  assert.deepEqual(rows(callSpec([])), ['clientKey']);
  assert.deepEqual(rows(callSpec([{ name: 'inConfig', expression: '= inConfig', disabled: true }])), ['clientKey']);
  const active = callSpec([{ name: 'clientKey', expression: '= 1' }, { name: 'inConfig', expression: '= inConfig' }]);
  const found = [...collectFindings(active, model, active.steps).values()].flatMap(f => f.warnings);
  assert.ok(found.some(w => w.includes('«inConfig» nicht mitgeben')), found.join(' / '));
  assert.ok(!found.some(w => w.includes('noch nicht im')), found.join(' / '));
});

test('a call accepts businessKey without its In - in Camunda 8 the business key goes to the subprocess as this variable', () => {
  const model = { domainTypes: scanScala(source), services: [] } as unknown as Model;
  const warningsOf = (inputs: Mapping[]) => {
    const s = { ...callSpec(inputs), engine: 'c8' } as ProcessSpec;
    return [...collectFindings(s, model, s.steps).values()].flatMap(f => f.warnings);
  };
  const ok = warningsOf([{ name: 'businessKey', expression: '= businessKey' }, { name: 'clientKey', expression: '= 1' }]);
  assert.ok(!ok.some(w => w.includes('noch nicht im')), ok.join(' / '));
  // another unknown input is still an extension
  const other = warningsOf([{ name: 'businessKey', expression: '= businessKey' }, { name: 'clientKey', expression: '= 1' }, { name: 'somethingElse', expression: '= 1' }]);
  assert.ok(other.some(w => w.includes('«somethingElse» noch nicht im') && !w.includes('businessKey')), other.join(' / '));
});

test('on Camunda 7 a call accepts businessKey too - an input with that name reaches the subprocess as well', () => {
  const model = { domainTypes: scanScala(source), services: [] } as unknown as Model;
  const s = { ...callSpec([{ name: 'businessKey', expression: '= businessKey' }, { name: 'clientKey', expression: '= 1' }]), engine: 'c7' } as ProcessSpec;
  const found = [...collectFindings(s, model, s.steps).values()].flatMap(f => f.warnings);
  assert.ok(!found.some(w => w.includes('noch nicht im')), found.join(' / '));
});

test('businessKey is accepted only by a call - a service task still reports it as an extension', () => {
  assert.equal(acceptedEverywhere('businessKey', 'call'), true);
  assert.equal(acceptedEverywhere('businessKey', 'service'), false);
  assert.equal(acceptedEverywhere('_idempotentId', 'service'), true);
});
