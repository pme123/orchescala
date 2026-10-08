// Die Beschreibung eines Prozess-Objekts (`override def descr = """…""".stripMargin`)
// ist die Ausgangslage der Spezifikation — beim Import und, solange sie leer ist,
// beim Abgleich mit der Domain.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scanScala } from '../src/domainScan';
import { mergeDomain } from '../src/domainMerge';
import type { ProcessSpec } from '../src/types';

const source = `package acme.product.domain
package lilaSet.v2

object LilaSet extends CompanyBpmnProcessDsl:

  val processName = "acme-product-lilaSetV2"

  override def descr =
    """01 Basisset eröffnen
      |
      |- Privatkonto
      |- Sparkonto
      |""".stripMargin

  case class In(clientKey: Long)
end LilaSet
`;

test('scan: override def descr with a multi-line text', () => {
  const inT = scanScala(source).find(t => t.name === 'LilaSet.In');
  assert.equal(inT?.ownerDescr, '01 Basisset eröffnen\n\n- Privatkonto\n- Sparkonto');
});

const spec = (description?: string): ProcessSpec =>
  ({ processId: 'acme-product-lilaSetV2', name: 'acme-product-lilaSetV2', steps: [], types: [], interactions: [], ...(description != null ? { description } : {}) } as unknown as ProcessSpec);
const status = { added: 'draft', changed: 'changed' } as const;

test('domain sync: an empty Ausgangslage gets the descr of the domain, a written one stays', () => {
  assert.equal(mergeDomain(spec(''), spec('aus der Domain'), { status }).spec.description, 'aus der Domain');
  assert.equal(mergeDomain(spec(), spec('aus der Domain'), { status }).spec.description, 'aus der Domain');
  assert.equal(mergeDomain(spec('eigene'), spec('aus der Domain'), { status }).spec.description, 'eigene');
});

test('export: the whole descr for the helper - // descr: first line, // descr| each further one', async () => {
  const { descrComment } = await import('../src/scala');
  assert.deepEqual(descrComment('01 Basisset eröffnen\n\n- Privatkonto "Young"\n'), [
    '// descr: 01 Basisset eröffnen', '// descr|', '// descr| - Privatkonto \\"Young\\"',
  ]);
  assert.deepEqual(descrComment('  '), []);
});
