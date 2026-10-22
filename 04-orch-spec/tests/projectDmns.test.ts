// Beim Anlegen und beim Abgleich holt die App die Tabellen der zugeordneten
// Decisions aus dem eigenen Projekt-Ordner — am Schritt sind sie dann gleich
// bearbeitbar. Der Ordnerzugriff (IndexedDB, Directory-Handles) ist hier nachgebildet.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { withProjectDmns } from '../src/dmnProject';
import type { Model, ProcessSpec } from '../src/types';

(globalThis as unknown as { DOMParser: unknown }).DOMParser = DOMParser;

type Tree = { [name: string]: Tree | string };

/** ein Ordner im Speicher — Unterordner als Objekt, Dateien als Text */
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

/** IndexedDB mit den gemerkten Handles — nur was getHandle braucht */
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

test('a matched decision without table gets the table of the own project', async () => {
  const saved: Array<[string, string]> = [];
  const r = await withProjectDmns(spec([decision('ia1', 'acme-bpmn-map-actions')]), model,
    async (slug, id) => { saved.push([slug, id]); return { ok: true }; });
  assert.deepEqual(r.loaded, ['ia1Dmn']);
  assert.equal(r.spec.interactions?.[0].dmnFile, 'bpmn-map-actions.dmn');
  assert.deepEqual(saved, [['acme-bpmn-sendevent', 'acme-bpmn-map-actions']]);
});

test('a decision that already has a table, or one only another project has, stays as it is', async () => {
  const saved: string[] = [];
  const s = spec([decision('ia1', 'acme-bpmn-map-actions', 'kept.dmn'), decision('ia2', 'acme-other-rules')]);
  const r = await withProjectDmns(s, model, async (_slug, id) => { saved.push(id); return { ok: true }; });
  assert.deepEqual(r.loaded, []);
  assert.equal(r.spec, s);
  assert.deepEqual(saved, []);
});

test('a table that cannot be saved is not referenced', async () => {
  const r = await withProjectDmns(spec([decision('ia1', 'acme-bpmn-map-actions')]), model,
    async () => ({ ok: false, message: 'read only' }));
  assert.deepEqual(r.loaded, []);
  assert.equal(r.spec.interactions?.[0].dmnFile, undefined);
});
