// Ein Aufrufer gibt Mocks des Aufgerufenen (`postAccountMock`) als eigene
// Variablen mit — sie stehen in dessen `InConfig`, nicht im Katalog der Eingaben.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scanScala } from '../src/domainScan';
import { inConfigFields } from '../src/feel';
import type { Model } from '../src/types';

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
