// The sync with the domain («Mit Domain abgleichen», the data model of «Mit BPMN abgleichen»)
// does not fall back silently to the catalog when the process's own project folder is
// remembered but not readable (folder access is remembered per address of the app) —
// the catalog may be older than the project. The dialog says so and offers folder / ZIP.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
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

// ── the folder is remembered and opens, but reading it fails ────────────────

const g = globalThis as unknown as { indexedDB: unknown };
const realIndexedDb = g.indexedDB;
after(() => { g.indexedDB = realIndexedDb; });

/** IndexedDB with the remembered handles — only what getHandle needs */
function fakeIndexedDb(handles: Record<string, unknown>) {
  const request = <T>(result: T) => {
    const req: { result: T; onsuccess?: () => void } = { result };
    setTimeout(() => req.onsuccess?.());
    return req;
  };
  g.indexedDB = {
    open: () => request({
      transaction: () => ({ objectStore: () => ({ get: (key: string) => request(handles[key] ?? null) }) }),
    }),
  };
}

test('own project folder whose reading fails (access revoked, folder moved): like not readable', async () => {
  const broken = {
    kind: 'directory', name: 'acme-demo',
    queryPermission: async () => 'granted',
    // eslint-disable-next-line require-yield
    entries: async function* () { throw new DOMException('acme-demo', 'NotAllowedError'); },
  };
  fakeIndexedDb({ 'project:p-acme-demo': broken });
  const r = await findSyncDomain(PID, model(['acme-demo']));
  assert.deepEqual(r, { blocked: true, unreadable: ['acme-demo'] });
});

test('own project folder readable but without the process: the search goes on to the catalog', async () => {
  // moved to another project or renamed — no question of access
  const empty = { kind: 'directory', name: 'acme-demo', queryPermission: async () => 'granted', entries: async function* () { /* empty */ } };
  fakeIndexedDb({ 'project:p-acme-demo': empty });
  try {
    const r = await findSyncDomain(PID, model(['acme-demo']));
    assert.ok(r && !('blocked' in r));
    assert.equal(r.source, 'Katalog');
  } finally { g.indexedDB = realIndexedDb; }
});
