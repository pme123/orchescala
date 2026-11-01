// The export of a spec folder without a browser (tools/spec2export.ts): per process what
// «Process from Spec» gives - and the same bytes for the same folder, so Orchescala's merge can
// compare the export of the spec before and after a change.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { exportSpecFolder, specExportJson, type SpecFolder } from '../src/specExport';
import { helperPayload } from '../src/exporters';
import { withoutRetiredFields } from '../src/specLoad';
import { fsFolder } from '../tools/lib/fsFolder';
import { installNodeDom } from './xmlNamespaces';
import type { ProcessSpec } from '../src/types';

installNodeDom();

const root = resolve(import.meta.dirname, '..');
const fixture = join(root, 'tests/fixtures/spec-folder');

/** The folder with files replaced (`null` removes one) and the listing in reverse order. */
function variant(base: SpecFolder, files: Record<string, string | null> = {}): SpecFolder {
  return {
    read: p => (p in files ? files[p] : base.read(p)),
    list: d => [...base.list(d)].reverse(),
  };
}

test('the same folder gives the same bytes', () => {
  const a = specExportJson(exportSpecFolder(fsFolder(fixture)));
  const b = specExportJson(exportSpecFolder(fsFolder(fixture)));
  assert.equal(a, b);
  assert.ok(a.endsWith('}\n'));
});

test('neither the order of the listing nor the time stamps of the spec change the export', () => {
  const folder = fsFolder(fixture);
  const spec = JSON.parse(folder.read('processes/order.json')!) as ProcessSpec;
  const touched = JSON.stringify({ ...spec, updatedAt: '2030-01-01T00:00:00+01:00', createdAt: '2030-01-01' }, null, 4);
  assert.equal(
    specExportJson(exportSpecFolder(variant(folder, { 'processes/order.json': touched }))),
    specExportJson(exportSpecFolder(folder)),
  );
});

test('per process the content of «Process from Spec» - the same code as the export dialog', () => {
  const folder = fsFolder(fixture);
  const { entries, issues } = exportSpecFolder(folder);
  assert.deepEqual(issues, []);
  assert.equal(entries.length, 1);
  const [e] = entries;
  assert.equal(e.kind, 'process');
  assert.equal(e.slug, 'order');
  assert.equal(e.processId, 'acme-demo-orderV1');
  assert.equal(e.engine, 'c7');
  const spec = withoutRetiredFields(JSON.parse(folder.read('processes/order.json')!));
  const payload = helperPayload(spec, null, folder.read('processes/order.bpmn')!, 'c7');
  // the model only adds the catalog - this spec uses none
  assert.equal(e.scala, payload.scala);
  assert.equal(e.bpmn, payload.bpmn);
  assert.match(e.scala, /object CheckOrder extends CompanyBpmnCustomTaskDsl/);
  assert.match(e.bpmn!, /camunda:topic="acme-demo-orderV1-checkOrder"/);
});

test('a missing DMN table and an unreadable spec are issues, the rest is exported', () => {
  const folder = fsFolder(fixture);
  const spec = JSON.parse(folder.read('processes/order.json')!) as ProcessSpec;
  const withDecision = { ...spec, interactions: [...(spec.interactions ?? []), { id: 'ia-d', stepId: 'X', kind: 'decision', name: 'Rules', key: 'acme-demo-rules', dmnFile: 'acme-demo-rules.dmn' }] };
  const broken: SpecFolder = {
    read: p => (p === 'processes/order.json' ? JSON.stringify(withDecision) : p === 'processes/broken.json' ? '{ nope' : folder.read(p)),
    list: d => (d === 'processes' ? [...folder.list(d), 'broken.json'] : folder.list(d)),
  };
  const { entries, issues } = exportSpecFolder(broken);
  assert.deepEqual(entries.map(e => e.slug), ['order']);
  assert.deepEqual(issues.map(i => i.file).sort(), ['processes/broken.json', 'processes/order/acme-demo-rules.dmn']);
});

test('the tool: the same JSON on stdout, twice the same bytes', () => {
  const run = () => spawnSync(process.execPath, [join(root, 'tools/spec2export.ts'), fixture], { encoding: 'utf8', timeout: 20_000 });
  const a = run();
  const b = run();
  assert.equal(a.status, 0, a.stderr);
  assert.equal(a.stdout, b.stdout);
  assert.equal(a.stdout, specExportJson(exportSpecFolder(fsFolder(fixture))));
  assert.equal(JSON.parse(readFileSync(join(fixture, 'processes/order.json'), 'utf8')).processId, JSON.parse(a.stdout).entries[0].processId);
});
