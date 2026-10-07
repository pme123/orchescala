// Ein Aufrufer gibt Mocks des Aufgerufenen (`postAccountMock`) als eigene
// Variablen mit — sie stehen in dessen `InConfig`, nicht im Katalog der Eingaben.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scanScala } from '../src/domainScan';
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
  // ohne InConfig: keine
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
