// Der Schlüssel eines Objekts auf der nächsten Zeile — scalafmt bricht
// `val topicName: String = "…"` um, wenn die Zeile zu lang wird.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scanScala } from '../src/domainScan';

const source = `package acme.demo.domain
package lilaSet.v2

object MergeNewAccounts extends CompanyBpmnCustomTaskDsl:

  val topicName: String =
    "acme-demo-lilaSetV2-MergeNewAccounts"

  val descr: String = "Merge"

  case class In(
      accountKey: Option[Long],
      portfolioKey: Long
  )

end MergeNewAccounts
`;

test('topicName auf der nächsten Zeile', () => {
  const types = scanScala(source);
  const inT = types.find(t => t.name === 'MergeNewAccounts.In');
  assert.equal(inT?.topicName, 'acme-demo-lilaSetV2-MergeNewAccounts');
  assert.deepEqual(inT?.fields?.map(f => f.name), ['accountKey', 'portfolioKey']);
});

test('final val topicName', () => {
  const types = scanScala(source.replace('  val topicName: String =\n    "acme-demo-lilaSetV2-MergeNewAccounts"', '  final val topicName = "acme-demo-lilaSetV2-MergeNewAccounts"'));
  assert.equal(types.find(t => t.name === 'MergeNewAccounts.In')?.topicName, 'acme-demo-lilaSetV2-MergeNewAccounts');
});
