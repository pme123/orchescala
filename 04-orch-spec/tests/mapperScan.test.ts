// Type mappers of the code: the domain scan reads the extensions of an object (what the export of
// Orch Spec writes, or a developer), the catalog carries them, a mapping converts with them - the
// worker imports their object, the export brings no file for them.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeGeneratedCatalog } from '../src/catalogMerge';
import { scanFiles, scanMappers } from '../src/domainScan';
import { modelMappers } from '../src/typeMappers';
import type { DomainMapper, Model, TypeMapper } from '../src/types';

const file = `package acme.crm.domain
package clientMaster.schema

import acme.crm.domain.client.v1.schema.ClientMainType

/** Type mappers */
object ClientMasterTypeMappers:

  /** ClientMainType → ClientType */
  extension (x: ClientMainType) def toClientType: ClientType =
    x match
      case ClientMainType.Person => ClientType.PERSON

  extension (x: BigDecimalWrapper)
    /** the value of the wrapper */
    def toBigDecimal: BigDecimal = x.value
    def toLabel(lang: String): String = ???

  extension (xs: Seq[ClientMainType]) def toTypes: Seq[ClientType] = ???

end ClientMasterTypeMappers

extension (x: Other) def toLoose: Loose = ???
`;

test('the scan reads the extensions of an object - on one line and as a block, with their doc; one with parameters or of a generic type is none', () => {
  const found = scanMappers(file, 'crm/01-domain/ClientMasterTypeMappers.scala');
  assert.deepEqual(found.map(m => `${m.object}.${m.method}(${m.from}): ${m.to} ${m.descr ?? ''}`.trim()), [
    'ClientMasterTypeMappers.toClientType(ClientMainType): ClientType ClientMainType → ClientType',
    'ClientMasterTypeMappers.toBigDecimal(BigDecimalWrapper): BigDecimal the value of the wrapper',
  ]);
  assert.equal(found[0].pkg, 'acme.crm.domain.clientMaster.schema');
  assert.equal(found[0].id, 'acme.crm.domain.clientMaster.schema.ClientMasterTypeMappers.toClientType(ClientMainType)');
  assert.equal(found[0].source, 'crm/01-domain/ClientMasterTypeMappers.scala');
  // a file of the scan: its mappers in the result, once per id
  const r = scanFiles([{ path: 'a.scala', text: file }, { path: 'b.scala', text: file }]);
  assert.equal(r.mappers.length, 2);
  assert.equal(r.mappers[0].source, 'a.scala');
});

test('the scan: an inline def is one, a private one none; a nested object is not the outer one\'s; docs between the defs of a block', () => {
  const src = `package acme.crm.domain
package schema

object TypeMappers:

  extension (x: Wrapper)
    /** the value */
    def toValue: BigDecimal = x.value

    /** as text */
    def toText: String = x.value.toString
    private def toSecret: Secret = ???

  extension (x: Code) inline def toKind: Kind = ???

  object Inner:
    extension (x: Hidden) def toShown: Shown = ???
  end Inner

  /** after the nested one */
  extension (x: Kind) def toCode: Code = ???
end TypeMappers
`;
  assert.deepEqual(scanMappers(src).map(m => `${m.object}.${m.method}(${m.from}): ${m.to} ${m.descr ?? ''}`.trim()), [
    'TypeMappers.toValue(Wrapper): BigDecimal the value',
    'TypeMappers.toText(Wrapper): String as text',
    'TypeMappers.toKind(Code): Kind',
    'TypeMappers.toCode(Kind): Code after the nested one',
  ]);
});

const code = (from: string, to: string, more: Partial<DomainMapper> = {}): DomainMapper => ({
  id: `acme.crm.domain.schema.TypeMappers.to${to}(${from})`, pkg: 'acme.crm.domain.schema', object: 'TypeMappers', method: `to${to}`, from, to, ...more,
});

test('a mapping converts with the model\'s mappers, then those of the code - one of the code with the same names steps back', () => {
  const own: TypeMapper = { id: 'm1', from: 'mainType', to: 'clientType', kind: 'decoder' };
  const all = modelMappers({ typeMappers: [own], domainMappers: [code('Wrapper', 'BigDecimal'), code('Wrapper', 'BigDecimal', { id: 'twice', pkg: 'other' }), code('mainType', 'clientType')] });
  assert.deepEqual(all.filter(m => !m.id.startsWith('std:')).map(m => m.id), ['m1', 'code:acme.crm.domain.schema.TypeMappers.toBigDecimal(Wrapper)']);
  assert.deepEqual(all[1].code, { pkg: 'acme.crm.domain.schema', object: 'TypeMappers', method: 'toBigDecimal' });
});

test('the catalog carries the mappers of the code - the delivered ones marked, a local scan of the project wins', () => {
  const user: Model = { version: 1, services: [], domainMappers: [code('A', 'B', { source: 'x/A.scala' })] };
  const merged = mergeGeneratedCatalog(user, { domainMappers: [code('C', 'D')] });
  assert.deepEqual(merged.domainMappers?.map(m => `${m.from}→${m.to} ${m.generated ? 'gen' : 'own'}`), ['C→D gen', 'A→B own']);
});
