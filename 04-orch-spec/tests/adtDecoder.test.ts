// An ADT (`enum Out` with fields per case): the JSON names no case (no discriminator), so
// the codec is `CirceCodec.from(decoder, deriveInOutEncoder)` — with a decoder per case and
// an own decoder that chooses the case.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { indexTypes, renderType } from '../src/scala';
import type { TypeDef } from '../src/types';

const person: TypeDef = { id: 'p', name: 'MultipleNaturalPerson2', kind: 'case', fields: [{ id: 'pf', name: 'name', type: 'String' }] } as unknown as TypeDef;

test('without a field that names the case: the cases are tried — the one that needs more first', () => {
  const out: TypeDef = { id: 'out', name: 'Out', kind: 'enum', values: [
    { name: 'Standard', fields: [{ id: 'f1', name: 'multipleNaturalPersons', type: 'p', collection: true }] },
    { name: 'ClientKey', fields: [{ id: 'f2', name: 'multipleNaturalPerson', type: 'p' }, { id: 'f3', name: 'clientKey', type: 'Long' }] },
    { name: 'Nothing', fields: [] },
  ] } as unknown as TypeDef;
  const scala = renderType(out, indexTypes([out, person]));
  assert.match(scala, /  given ApiSchema\[Out\]  = deriveApiSchema\n  given InOutCodec\[Out\] = CirceCodec\.from\(decoder, deriveInOutEncoder\)\n/);
  assert.match(scala, /  given InOutDecoder\[Out\.Standard\] = deriveInOutDecoder\n  given InOutDecoder\[Out\.ClientKey\] = deriveInOutDecoder\n\n/);
  // a case without fields has no decoder of its own
  assert.doesNotMatch(scala, /InOutDecoder\[Out\.Nothing\]/);
  assert.ok(scala.includes([
    '  private lazy val decoder: InOutDecoder[Out] = (c: HCursor) =>',
    '    // TODO the JSON names no case: the first case that reads it wins — choose it by a field if one decides',
    '    customDecodeAccumulating[Out.ClientKey](c)',
    '      .orElse(customDecodeAccumulating[Out.Standard](c))',
    '      .orElse(Right(Out.Nothing))',
  ].join('\n')), scala);
  // no codec of a case, no schema of a case
  assert.doesNotMatch(scala, /InOutCodec\[Out\.|ApiSchema\[Out\./);
});

const useCase: TypeDef = { id: 'uc', name: 'PutUseCaseType', kind: 'enum', values: [{ name: 'Create' }, { name: 'Update' }] } as unknown as TypeDef;
const switchCase = (name: string, value: string, extra: object[] = []) =>
  ({ name, fields: [{ id: `u-${name}`, name: 'useCase', type: 'uc', enumCase: value }, ...extra] });

test('a field fixed to its own case in every case: the decoder reads it', () => {
  const t: TypeDef = { id: 'in', name: 'In', kind: 'enum', values: [
    switchCase('CreatePerson', 'Create', [{ id: 'a', name: 'name', type: 'String' }]),
    switchCase('UpdatePerson', 'Update', [{ id: 'b', name: 'clientKey', type: 'Long' }]),
  ] } as unknown as TypeDef;
  const scala = renderType(t, indexTypes([t, useCase]));
  assert.ok(scala.includes([
    '  private lazy val decoder: InOutDecoder[In] = (c: HCursor) =>',
    '    c.downField("useCase").as[PutUseCaseType].flatMap:',
    '      case PutUseCaseType.Create => customDecodeAccumulating[In.CreatePerson](c)',
    '      case PutUseCaseType.Update => customDecodeAccumulating[In.UpdatePerson](c)',
    '',
  ].join('\n')), scala);
  // all values of the switch have a case: nothing else to try
  assert.doesNotMatch(scala, /case _ =>/);
});

test('a switch with values no case has: the rest tries the cases', () => {
  const more = { ...useCase, values: [...(useCase.values ?? []), { name: 'Delete' }] } as TypeDef;
  const t: TypeDef = { id: 'in', name: 'In', kind: 'enum', values: [
    switchCase('CreatePerson', 'Create'),
    switchCase('UpdatePerson', 'Update', [{ id: 'b', name: 'clientKey', type: 'Long' }]),
  ] } as unknown as TypeDef;
  const scala = renderType(t, indexTypes([t, more]));
  assert.ok(scala.includes([
    '      case PutUseCaseType.Update => customDecodeAccumulating[In.UpdatePerson](c)',
    '      case _ =>',
    '        customDecodeAccumulating[In.UpdatePerson](c)',
    '          .orElse(customDecodeAccumulating[In.CreatePerson](c))',
  ].join('\n')), scala);
});
