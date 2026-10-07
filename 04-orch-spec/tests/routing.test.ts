// Ein Decoder wählt den Fall eines `In` selbst: aus `useCase` direkt oder aus
// `clientType` (+ `isUpdate`) — er setzt `useCase` dann selbst. Eine der Weichen
// genügt; mit `clientType` ist die Ausprägung erst zur Laufzeit bekannt.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scanScala } from '../src/domainScan';
import { collectFindings, missingRequiredInputs } from '../src/findings';
import { ALL_VARIANTS, chosenVariant, variantsOf } from '../src/variants';
import type { Mapping, Model, ProcessSpec, Step } from '../src/types';

const source = `package acme.client.domain
package client.v1

object PutClient extends CompanyBpmnServiceTaskDsl:
  val topicName = "acme-client-put"

  enum In:
    def useCase: PutUseCaseType
    def clientKey: Long
    def clientType: Option[ClientType]
    def isUpdate: Option[Boolean]
    case CreatePrivate(clientKey: Long, clientType: Option[ClientType], isUpdate: Option[Boolean], name: String, useCase: PutUseCaseType = PutUseCaseType.CreatePrivate)
    case UpdatePrivate(clientKey: Long, clientType: Option[ClientType], isUpdate: Option[Boolean], name: String, useCase: PutUseCaseType = PutUseCaseType.UpdatePrivate)
    case UpdateCompany(clientKey: Long, clientType: Option[ClientType], isUpdate: Option[Boolean], company: String, useCase: PutUseCaseType = PutUseCaseType.UpdateCompany)
  end In

  object In:
    lazy val decoder: InOutDecoder[In] = (c: HCursor) =>
      for
        maybeClientType <- c.downField("clientType").as[Option[ClientType]]
        isUpdate        <- c.downField("isUpdate").as[Option[Boolean]]
        maybeUseCase    <- c.downField("useCase").as[Option[PutUseCaseType]]

        in <-
          maybeClientType
            .map: clientType =>
              (clientType, isUpdate) match
              case (ClientType.privateIndividual, Some(false)) =>
                c.withFocus(
                  _.mapObject(_.add(
                    "useCase",
                    Json.fromString(PutUseCaseType.CreatePrivate.toString)
                  ))
                ).as[In.CreatePrivate]
              case _ =>
                c.withFocus(_.mapObject(_.add("useCase", Json.fromString(PutUseCaseType.UpdatePrivate.toString)))).as[In.UpdatePrivate]
            .getOrElse:
              maybeUseCase
                .map:
                  case PutUseCaseType.CreatePrivate => c.as[In.CreatePrivate]
                  case PutUseCaseType.UpdatePrivate => c.as[In.UpdatePrivate]
                  case PutUseCaseType.UpdateCompany => c.as[In.UpdateCompany]
                .getOrElse(Left(DecodingFailure("useCase or clientType are required", c.history)))
      yield in
      end for
  end In
end PutClient
`;

const model = { domainTypes: scanScala(source, 'PutClient.scala') } as unknown as Model;
const step = (inputs: Mapping[]): Step => ({ id: 'PutClientTask', name: 'Put Client', kind: 'service', topic: 'acme-client-put', inputs } as Step);
const spec = (s: Step): ProcessSpec => ({ processId: 'acme-demoV1', name: 'acme-demoV1', steps: [s] } as unknown as ProcessSpec);
const row = (name: string, disabled = false): Mapping => ({ name, expression: `= ${name}`, ...(disabled ? { disabled: true } : {}) });
const messages = (s: Step) => [...collectFindings(spec(s), model, [s]).values()].flatMap(f => [...f.errors, ...f.warnings]);

test('scan: the routing fields of the decoder - the one it sets itself first, isUpdate only decides along', () => {
  assert.deepEqual(model.domainTypes!.find(t => t.name === 'PutClient.In')?.routing, ['useCase', 'clientType']);
});

test('useCase only: a case of its own is needed, useCase is required as before', () => {
  const s = step([row('clientKey'), row('useCase'), row('clientType', true), row('isUpdate', true)]);
  const v = variantsOf(s, spec(s), model, 'inputs', null);
  assert.deepEqual(v?.routing, ['useCase', 'clientType']);
  assert.equal(chosenVariant(s, 'inputs', v).runtime, undefined);
  assert.ok(!messages(s).some(m => m.includes('Pflicht')), messages(s).join(' / '));
});

test('clientType instead of useCase: the case is chosen at runtime - no useCase, no mixed variants', () => {
  const s = step([row('clientKey'), row('useCase', true), row('clientType'), row('isUpdate')]);
  const chosen = chosenVariant(s, 'inputs', variantsOf(s, spec(s), model, 'inputs', null));
  assert.equal(chosen.name, ALL_VARIANTS);
  assert.equal(chosen.runtime, 'clientType');
  // `name` ist Pflicht in den Fällen — welcher es wird, entscheidet der Decoder
  assert.deepEqual(messages(s).filter(m => /Pflicht|Ausprägung/.test(m)), []);
  assert.deepEqual(missingRequiredInputs(s, spec(s), model), []);
});

test('useCase and clientType: the decoder asks clientType first - still at runtime', () => {
  const s = step([row('clientKey'), row('useCase'), row('clientType'), row('isUpdate')]);
  assert.equal(chosenVariant(s, 'inputs', variantsOf(s, spec(s), model, 'inputs', null)).runtime, 'clientType');
  assert.deepEqual(messages(s).filter(m => /Pflicht|Ausprägung/.test(m)), []);
});

test('neither useCase nor clientType: one of them is missing', () => {
  const s = step([row('clientKey'), row('useCase', true), row('clientType', true)]);
  assert.ok(messages(s).some(m => m.includes('«useCase» oder «clientType» fehlt')), messages(s).join(' / '));
  // ohne Zeile: das gemeinsame Feld kommt dazu
  assert.deepEqual(missingRequiredInputs(step([row('clientKey')]), spec(step([])), model), ['useCase']);
});

test('with an interaction: the In of the data model gets the routing fields of its domain type', () => {
  const s = step([row('clientKey'), row('useCase', true), row('clientType'), row('isUpdate')]);
  const withClass = {
    ...spec(s),
    interactions: [{ id: 'ia', stepId: s.id, kind: 'customTask', name: 'PutClient', inTypeId: 't-in' }],
    types: [{
      id: 't-in', name: 'In', kind: 'enum', interactionId: 'ia', domainId: 'acme.client.domain.client.v1.PutClient.In',
      fields: [
        { id: 'f1', name: 'useCase', type: 'PutUseCaseType' }, { id: 'f2', name: 'clientKey', type: 'Long' },
        { id: 'f3', name: 'clientType', type: 'ClientType', optional: true }, { id: 'f4', name: 'isUpdate', type: 'Boolean', optional: true },
      ],
      values: [
        { name: 'CreatePrivate', fields: [{ id: 'f5', name: 'name', type: 'String' }] },
        { name: 'UpdatePrivate', fields: [{ id: 'f6', name: 'name', type: 'String' }] },
        { name: 'UpdateCompany', fields: [{ id: 'f7', name: 'company', type: 'String' }] },
      ],
    }],
  } as unknown as ProcessSpec;
  const chosen = chosenVariant(s, 'inputs', variantsOf(s, withClass, model, 'inputs', null));
  assert.equal(chosen.runtime, 'clientType');
});
