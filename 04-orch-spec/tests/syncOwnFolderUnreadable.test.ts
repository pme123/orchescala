// The sync with the domain («Mit Domain abgleichen», the data model of «Mit BPMN abgleichen»)
// does not fall back silently to the catalog when the process's own project folder is
// remembered but not readable (folder access is remembered per address of the app) —
// the catalog may be older than the project. The dialog says so and offers folder / ZIP.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findDomain, findSyncDomain } from '../src/projectImport';
import { scanScala } from '../src/domainScan';
import type { Model } from '../src/types';

const PID = 'acme-demo-sendEvent';
const catalog = scanScala(`package acme.demo.domain.sendEvent.v1

object SendEvent extends CompanyBpmnProcessDsl:
  val processName = "${PID}"
  val descr: String = ""
  case class In(clientKey: Long)
  lazy val example = process(In(1L), NoOutput())
end SendEvent
`, 'acme-demo/01-domain/src/main/scala/acme/demo/domain/sendEvent/v1/SendEvent.scala');

// No IndexedDB here: a remembered folder has no handle — exactly as on another address of the app
const model = (projects: string[]): Model =>
  ({ version: 1, services: [], domainTypes: catalog, projects: projects.map(name => ({ id: `p-${name}`, name })) } as unknown as Model);

test('own project folder remembered but not readable: the sync gets no domain from the catalog', async () => {
  const r = await findSyncDomain(PID, model(['acme-demo']));
  assert.deepEqual(r, { blocked: true, unreadable: ['acme-demo'] });
});

test('no own project folder remembered: the sync uses the catalog', async () => {
  const r = await findSyncDomain(PID, model(['globex-core']));
  assert.ok(r && !('blocked' in r));
  assert.equal(r.source, 'Katalog');
});

test('the first import from the BPMN still uses the catalog', async () => {
  const r = await findDomain(PID, model(['acme-demo']));
  assert.equal(r?.source, 'Katalog');
});
