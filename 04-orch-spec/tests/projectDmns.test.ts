// On create and on sync the app fetches the tables of the matched decisions
// from the own project folder — they can then be edited at the step right away.
// The folder access (IndexedDB, directory handles) is faked here.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { findDmnInProject, findProjectDmns, notFoundMessage, saveProjectDmns, withDmnFiles, type SaveDmn } from '../src/dmnProject';
import type { Model, ProcessSpec } from '../src/types';

(globalThis as unknown as { DOMParser: unknown }).DOMParser = DOMParser;

type Tree = { [name: string]: Tree | string };

/** a folder in memory — subfolders as objects, files as text */
function dir(name: string, tree: Tree): unknown {
  return {
    kind: 'directory', name,
    queryPermission: async () => 'granted',
    getDirectoryHandle: async (n: string) => {
      const sub = tree[n];
      if (!sub || typeof sub === 'string') throw new Error(`NotFound: ${n}`);
      return dir(n, sub);
    },
    entries: async function* () {
      for (const [n, v] of Object.entries(tree)) {
        yield [n, typeof v === 'string' ? { kind: 'file', name: n, getFile: async () => ({ text: async () => v }) } : dir(n, v)];
      }
    },
  };
}

/** IndexedDB with the remembered handles — only what getHandle needs */
function fakeIndexedDb(handles: Record<string, unknown>) {
  const request = <T>(result: T) => {
    const req: { result: T; onsuccess?: () => void } = { result };
    setTimeout(() => req.onsuccess?.());
    return req;
  };
  (globalThis as unknown as { indexedDB: unknown }).indexedDB = {
    open: () => request({
      transaction: () => ({ objectStore: () => ({ get: (key: string) => request(handles[key] ?? null) }) }),
    }),
  };
}

const dmn = (id: string) => `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" id="Definitions_1" name="DRD" namespace="http://camunda.org/schema/1.0/dmn">
  <decision id="${id}" name="${id}">
    <decisionTable id="DecisionTable_1">
      <input id="Input_1" label="subStatusKey"><inputExpression id="Expr_1" typeRef="string"><text>subStatusKey</text></inputExpression></input>
      <output id="Output_1" label="subStatusNr" name="subStatusNr" typeRef="number" />
    </decisionTable>
  </decision>
</definitions>`;

const spec = (interactions: ProcessSpec['interactions']): ProcessSpec => ({
  slug: 'acme-bpmn-sendevent', processId: 'acme-bpmn-sendEvent', engine: 'c8', steps: [], interactions,
} as unknown as ProcessSpec);

const decision = (id: string, key: string, dmnFile?: string) =>
  ({ id, stepId: `${id}-step`, kind: 'decision' as const, name: `${id}Dmn`, key, ...(dmnFile ? { dmnFile } : {}) });

const model = {
  projects: [
    { id: 'p-own', name: 'acme-bpmn', path: '', types: 0, root: 'projects' },
    { id: 'p-other', name: 'acme-other', path: '', types: 0, root: 'projects' },
  ],
} as unknown as Model;

fakeIndexedDb({
  'root:projects': dir('projects', {
    'acme-bpmn': { src: { main: { resources: {
      camunda8: { 'bpmn-map-actions.dmn': dmn('acme-bpmn-map-actions'), 'notes.txt': 'x' },
      camunda: { 'bpmn-map-actions.dmn': dmn('acme-bpmn-map-actions') },
    } } } },
    'acme-other': { src: { main: { resources: { camunda8: { 'other.dmn': dmn('acme-other-rules') } } } } },
  }),
});

test('a matched decision without table finds the table of the own project - without saving anything', async () => {
  const found = await findProjectDmns(spec([decision('ia1', 'acme-bpmn-map-actions')]), model);
  assert.deepEqual(found.map(f => [f.iaId, f.name, f.decisionId, f.file]), [['ia1', 'ia1Dmn', 'acme-bpmn-map-actions', 'bpmn-map-actions.dmn']]);
  assert.match(found[0].xml, /decision id="acme-bpmn-map-actions"/);
  const s = withDmnFiles(spec([decision('ia1', 'acme-bpmn-map-actions')]), found);
  assert.equal(s.interactions?.[0].dmnFile, 'bpmn-map-actions.dmn');
});

test('a decision that already has a table, or one only another project has, is not looked up', async () => {
  const s = spec([decision('ia1', 'acme-bpmn-map-actions', 'kept.dmn'), decision('ia2', 'acme-other-rules')]);
  assert.deepEqual(await findProjectDmns(s, model), []);
  assert.equal(withDmnFiles(s, []), s);
});

/** the tables found for one decision of the own project */
const foundOne = () => findProjectDmns(spec([decision('ia1', 'acme-bpmn-map-actions')]), model);

test('saving: created, kept when already stored (createOnly), failed with the reason', async () => {
  const calls: Array<[string, string, boolean]> = [];
  const ok: SaveDmn = async (slug, id, _xml, opts) => { calls.push([slug, id, !!opts?.createOnly]); return { ok: true }; };
  const saved = await saveProjectDmns('acme-bpmn-sendevent', await foundOne(), ok, { createOnly: true });
  assert.deepEqual([saved.saved.map(f => f.name), saved.kept, saved.failed], [['ia1Dmn'], [], []]);
  assert.deepEqual(calls, [['acme-bpmn-sendevent', 'acme-bpmn-map-actions', true]]);

  // a table already stored beside the spec is not overwritten — it is linked
  const exists: SaveDmn = async () => ({ ok: false, message: 'Datei existiert bereits.', exists: true });
  const kept = await saveProjectDmns('acme-bpmn-sendevent', await foundOne(), exists, { createOnly: true });
  assert.deepEqual([kept.saved, kept.kept.map(f => f.name), kept.failed], [[], ['ia1Dmn'], []]);

  const readOnly: SaveDmn = async () => ({ ok: false, message: 'read only' });
  const failed = await saveProjectDmns('acme-bpmn-sendevent', await foundOne(), readOnly);
  assert.deepEqual([failed.saved, failed.kept, failed.failed], [[], [], ['ia1Dmn: read only']]);
});

test('saving: a throwing write is reported, not swallowed', async () => {
  const throws: SaveDmn = async () => { throw new Error('network down'); };
  const r = await saveProjectDmns('acme-bpmn-sendevent', await foundOne(), throws);
  assert.deepEqual(r.failed, ['ia1Dmn: network down']);
});

test('a folder without access is reported as such - not as a missing table', async () => {
  // the own project under a folder above that this browser has no access to
  const blocked = { projects: [{ id: 'p-own', name: 'acme-bpmn', path: '', types: 0, root: 'elsewhere' }] } as unknown as Model;
  const noAccess: string[] = [];
  const hit = await findDmnInProject('acme-bpmn-map-actions', 'acme-bpmn-sendEvent', blocked, 'c8', undefined, { noAccess });
  assert.equal(hit, null);
  assert.deepEqual(noAccess, ['acme-bpmn']);
  assert.match(notFoundMessage('acme-bpmn-map-actions', 'acme-bpmn-sendEvent', blocked, 'c8', noAccess), /Kein Zugriff auf den Projekt-Ordner «acme-bpmn»/);
});

test('the message names the real cause - no folders, or the table is not there', async () => {
  assert.match(notFoundMessage('x', 'acme-bpmn-sendEvent', { projects: [] } as unknown as Model, 'c8', []), /Keine Projekt-Ordner gemerkt/);
  const noAccess: string[] = [];
  assert.equal(await findDmnInProject('acme-bpmn-unknown', 'acme-bpmn-sendEvent', model, 'c8', undefined, { noAccess }), null);
  assert.deepEqual(noAccess, []);
  assert.match(notFoundMessage('acme-bpmn-unknown', 'acme-bpmn-sendEvent', model, 'c8', noAccess), /camunda8 keine Tabelle «acme-bpmn-unknown»/);
});
