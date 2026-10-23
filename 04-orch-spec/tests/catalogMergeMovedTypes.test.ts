// A project moved types into another package (`…v1.CProcessState` → `…v1.schema.CProcessState`)
// and was scanned again into the model.json, while the bundled catalog still has the old state.
// Merged per type ID, both versions stayed side by side: the sync then added copies of the
// moved types and cut the existing ones back to the old state. Per project, only one scan applies.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { importBpmn } from '../src/bpmn';
import { scanScala } from '../src/domainScan';
import { enrichSpec } from '../src/projectImport';
import { mergeDomain } from '../src/domainMerge';
import { mergeGeneratedCatalog } from '../src/catalogMerge';
import type { DomainType, Model, ProcessSpec } from '../src/types';

(globalThis as unknown as { DOMParser: unknown }).DOMParser = DOMParser;

const PID = 'acme-demo-sendEvent';
const bpmn = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="${PID}" name="${PID}" isExecutable="true">
    <bpmn:startEvent id="StartEvent"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:endEvent id="EndEvent"><bpmn:incoming>f1</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="f1" sourceRef="StartEvent" targetRef="EndEvent"/>
  </bpmn:process>
</bpmn:definitions>`;

const processObject = (imports: string) => `package acme.demo.domain.sendEvent.v1
${imports}
object SendEvent extends CompanyBpmnProcessDsl:
  val processName = "${PID}"
  val descr: String = ""

  case class In(
      state: Option[CProcessState] = None,
      identityLinks: Option[Seq[IdentityLink]] = None
  )
  object In:
    lazy val example = In()

  lazy val example = process(In.example, NoOutput())
end SendEvent
`;

/** the old state — still in the bundled catalog */
const oldScan = (): DomainType[] => [
  ...scanScala(processObject(''), 'acme-demo/01-domain/src/main/scala/acme/demo/domain/sendEvent/v1/SendEvent.scala'),
  ...scanScala(`package acme.demo.domain.sendEvent.v1

enum CProcessState:
  case ACTIVE

case class IdentityLink(groupId: Option[String] = None)
`, 'acme-demo/01-domain/src/main/scala/acme/demo/domain/sendEvent/v1/domain.scala'),
];

/** the current state — the newer scan in the model.json */
const newScan = (): DomainType[] => [
  ...scanScala(processObject('\nimport acme.demo.domain.sendEvent.v1.schema.*\n'),
    'acme-demo/01-domain/src/main/scala/acme/demo/domain/sendEvent/v1/SendEvent.scala'),
  ...scanScala(`package acme.demo.domain.sendEvent.v1.schema

enum CProcessState:
  case ACTIVE, COMPLETED
`, 'acme-demo/01-domain/src/main/scala/acme/demo/domain/sendEvent/v1/schema/CProcessState.scala'),
  ...scanScala(`package acme.demo.domain.sendEvent.v1.schema

case class IdentityLink(
    \`type\`: IdentityLinkType,
    groupId: Option[String] = None
)
`, 'acme-demo/01-domain/src/main/scala/acme/demo/domain/sendEvent/v1/schema/IdentityLink.scala'),
  ...scanScala(`package acme.demo.domain.sendEvent.v1.schema

enum IdentityLinkType:
  case candidate, assignee
`, 'acme-demo/01-domain/src/main/scala/acme/demo/domain/sendEvent/v1/schema/IdentityLinkType.scala'),
];

/** the specification as it was synced with the project folder itself */
const synced = (): ProcessSpec => {
  const r = enrichSpec({ ...importBpmn(bpmn, 'send-event').spec, project: 'acme-demo' }, newScan(), null);
  assert.ok(r);
  return r.spec;
};

const model = (domainTypes: DomainType[]): Model => ({ version: 1, services: [], domainTypes } as unknown as Model);

test('the scan moved types to .schema, the catalog has the old state: no duplicates after the sync', () => {
  const merged = mergeGeneratedCatalog(model(newScan()), { domainTypes: oldScan() });
  const ids = (merged.domainTypes ?? []).map(t => t.id).filter(id => id.startsWith('acme.demo.'));
  assert.ok(!ids.includes('acme.demo.domain.sendEvent.v1.CProcessState'), 'the old package is gone');
  assert.ok(ids.includes('acme.demo.domain.sendEvent.v1.schema.CProcessState'));

  const before = synced();
  const enriched = enrichSpec(before, merged.domainTypes ?? [], merged);
  assert.ok(enriched);
  const { spec: after, report } = mergeDomain(before, enriched.spec, { status: { added: 'implemented', changed: 'changed' } });

  const names = (after.types ?? []).map(t => t.name);
  assert.deepEqual(names.filter((n, i) => names.indexOf(n) !== i), [], 'no type twice');
  assert.deepEqual(report.added, []);
  const byName = (n: string) => after.types?.find(t => t.name === n);
  assert.deepEqual(byName('CProcessState')?.values?.map(v => v.name), ['ACTIVE', 'COMPLETED']);
  assert.ok(byName('IdentityLink')?.fields?.some(f => f.name === 'type'), 'IdentityLink.type stays');
});

// ── which scan of a project applies ───────────────────────────────────────────

const acmeIds = (m: Model) => (m.domainTypes ?? []).map(t => t.id).filter(id => id.startsWith('acme.demo.'));
const OLD = 'acme.demo.domain.sendEvent.v1.CProcessState';
const NEW = 'acme.demo.domain.sendEvent.v1.schema.CProcessState';
const project = (scannedAt?: string) => [{ id: 'p-acme-demo', name: 'acme-demo', ...(scannedAt ? { scannedAt } : {}) }];

test('the later scannedAt wins - the catalog when it was built after the own scan', () => {
  // the catalog with the new state, the model.json with the old one
  const merged = mergeGeneratedCatalog(
    { ...model(oldScan()), projects: project('2026-10-20T10:00:00Z') } as Model,
    { domainTypes: newScan(), projects: project('2026-10-22T10:00:00Z') },
  );
  assert.ok(acmeIds(merged).includes(NEW));
  assert.ok(!acmeIds(merged).includes(OLD));
  assert.ok(merged.domainTypes?.find(t => t.id === NEW)?.generated);
});

test('the later scannedAt wins - the own scan when it is newer than the catalog', () => {
  const merged = mergeGeneratedCatalog(
    { ...model(newScan()), projects: project('2026-10-23T07:00:00Z') } as Model,
    { domainTypes: oldScan(), projects: project('2026-10-21T14:00:00Z') },
  );
  assert.ok(acmeIds(merged).includes(NEW));
  assert.ok(!acmeIds(merged).includes(OLD));
  assert.ok(!merged.domainTypes?.find(t => t.id === NEW)?.generated, 'stays in the model.json');
});

test('a scan without a time is older than one with a time', () => {
  const merged = mergeGeneratedCatalog(model(oldScan()), { domainTypes: newScan(), projects: project('2026-10-22T10:00:00Z') });
  assert.ok(acmeIds(merged).includes(NEW));
  assert.ok(!acmeIds(merged).includes(OLD));
});

test('the other projects of the catalog stay as they are', () => {
  const other = scanScala('package globex.core.domain.client\n\ncase class Client(name: String)\n',
    'globex-core/01-domain/src/main/scala/globex/core/domain/client/Client.scala');
  const merged = mergeGeneratedCatalog(model(newScan()), { domainTypes: [...oldScan(), ...other] });
  assert.ok(merged.domainTypes?.some(t => t.id === 'globex.core.domain.client.Client' && t.generated));
});

test('a type without source belongs to the project of its package root', () => {
  // e.g. from the OpenAPI of an older catalog: no `source`, but the package of the project
  const fromApi = { id: 'acme.demo.domain.sendEvent.v1.Legacy', name: 'Legacy', pkg: 'acme.demo.domain.sendEvent.v1', kind: 'case', fields: [] } as unknown as DomainType;
  const merged = mergeGeneratedCatalog(model(newScan()), { domainTypes: [...oldScan(), fromApi] });
  assert.ok(!acmeIds(merged).includes(fromApi.id), 'part of the older scan of acme-demo');
});

test('the own scan has a time but no types of the project: the catalog keeps them', () => {
  // «Neu aufbauen» found nothing, or the project is only listed — that wipes nothing
  const merged = mergeGeneratedCatalog(
    { ...model([]), projects: project('2026-10-23T07:00:00Z') } as Model,
    { domainTypes: oldScan(), projects: project('2026-10-21T14:00:00Z') },
  );
  assert.ok(acmeIds(merged).includes(OLD));
});

test('a type without source whose package root belongs to several projects is merged by ID as before', () => {
  // two projects with the same package root — then it cannot be said which one the type belongs to
  const twin = scanScala('package acme.demo.domain.other\n\ncase class Other(id: String)\n',
    'acme-demo-twin/01-domain/src/main/scala/acme/demo/domain/other/Other.scala');
  const noSource = { id: 'acme.demo.domain.sendEvent.v1.Legacy', name: 'Legacy', pkg: 'acme.demo.domain.sendEvent.v1', kind: 'case', fields: [] } as unknown as DomainType;
  const merged = mergeGeneratedCatalog(model(newScan()), { domainTypes: [...oldScan(), ...twin, noSource] });
  // not part of either project: it stays, as with the merge by ID
  assert.ok(acmeIds(merged).includes(noSource.id));
  // the types with a source are still merged per project
  assert.ok(!acmeIds(merged).includes(OLD));
});

test('an old catalog without any source: its types still belong to the project of the own scan', () => {
  // catalogs from before `source`: the package root of the scanned project decides
  const withoutSource = oldScan().map(({ source: _s, ...t }) => t as DomainType);
  const merged = mergeGeneratedCatalog(model(newScan()), { domainTypes: withoutSource });
  assert.ok(!acmeIds(merged).includes(OLD));
  assert.ok(acmeIds(merged).includes(NEW));
  const before = synced();
  const enriched = enrichSpec(before, merged.domainTypes ?? [], merged);
  assert.ok(enriched);
  const { spec: after } = mergeDomain(before, enriched.spec, { status: { added: 'implemented', changed: 'changed' } });
  const names = (after.types ?? []).map(t => t.name);
  assert.deepEqual(names.filter((n, i) => names.indexOf(n) !== i), [], 'no type twice');
});
