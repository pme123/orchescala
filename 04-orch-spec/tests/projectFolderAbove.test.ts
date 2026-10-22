// A project whose remembered folder is the one above it (`…/projects` instead
// of `…/projects/democompany-services`): the build reads the project inside it.
// Before, it read all projects below through this one, and the others counted
// 0 types (same packages).
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { grantAccess, intoProject, rebuild } from '../src/projects';
import type { ProjectFolder } from '../src/types';

type Tree = { [name: string]: Tree | string };

/** a folder in memory — subfolders as objects, files as text */
function dir(name: string, tree: Tree, denied: string[] = []): FileSystemDirectoryHandle {
  return {
    kind: 'directory', name,
    queryPermission: async () => 'granted',
    getDirectoryHandle: async (n: string) => {
      const sub = tree[n];
      if (denied.includes(n)) throw new DOMException(n, 'NotAllowedError');
      if (sub === undefined) throw new DOMException(n, 'NotFoundError');
      if (typeof sub === 'string') throw new DOMException(n, 'TypeMismatchError');
      return dir(n, sub);
    },
    entries: async function* () {
      for (const [n, v] of Object.entries(tree)) {
        yield [n, typeof v === 'string' ? { kind: 'file', name: n, getFile: async () => ({ text: async () => v }) } : dir(n, v)];
      }
    },
  };
}

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
      transaction: () => {
        const tx: { oncomplete?: () => void; objectStore: () => object } = {
          objectStore: () => ({
            get: (key: string) => request(handles[key] ?? null),
            put: (value: unknown, key: string) => { handles[key] = value; setTimeout(() => tx.oncomplete?.()); },
          }),
        };
        return tx;
      },
    }),
  };
}

/** a project with one class in its own package */
const project = (name: string, cls: string): Tree => ({
  '01-domain': { src: { main: { scala: { acme: { [name]: { domain: { [`${cls}.scala`]: `package acme.${name}.domain\n\ncase class ${cls}(id: String)\n` } } } } } } },
});

const projects = dir('projects', {
  'acme-services': project('services', 'Client'),
  'acme-customer': project('customer', 'Advisor'),
  'acme-cards': project('cards', 'Card'),
});

test('a project remembered with the folder above it counts only its own types', async () => {
  const list: ProjectFolder[] = [
    { id: 'p-services', name: 'acme-services' },
    { id: 'p-customer', name: 'acme-customer' },
    { id: 'p-cards', name: 'acme-cards' },
  ];
  fakeIndexedDb({
    // services: the folder above — customer and cards: their own
    'project:p-services': projects,
    'project:p-customer': await projects.getDirectoryHandle('acme-customer'),
    'project:p-cards': await projects.getDirectoryHandle('acme-cards'),
  });
  const r = await rebuild(list, () => {});
  assert.deepEqual(r.projects.map(p => [p.name, p.types]), [['acme-services', 1], ['acme-customer', 1], ['acme-cards', 1]]);
  assert.equal(r.files, 3);
  assert.deepEqual(r.types.map(t => t.name).sort(), ['Advisor', 'Card', 'Client']);
});

test('a remembered folder without a subfolder of the project name stays as it is', async () => {
  // e.g. the folder was renamed on disk — read it as before
  const renamed = dir('acme-services-old', project('services', 'Client'));
  assert.equal(await intoProject(renamed, 'acme-services'), renamed);
  const exact = dir('acme-services', project('services', 'Client'));
  assert.equal(await intoProject(exact, 'acme-services'), exact);
  const other = dir('elsewhere', { notes: 'text' });
  assert.equal(await intoProject(other, 'acme-services'), other);
});

test('a project folder with a subfolder of its own name stays the project', async () => {
  const foo = dir('foo', { ...project('foo', 'Foo'), foo: { 'readme.txt': 'inner' } });
  assert.equal(await intoProject(foo, 'foo'), foo);
});

test('a project folder under another name stays the project, even with a subfolder of the name', async () => {
  const renamed = dir('Acme-Services', { ...project('services', 'Client'), 'acme-services': { 'readme.txt': 'inner' } });
  assert.equal(await intoProject(renamed, 'acme-services'), renamed);
});

test('a project name that is a file in the folder above keeps the folder', async () => {
  const above = dir('projects', { 'acme-services': 'a file' });
  assert.equal(await intoProject(above, 'acme-services'), above);
});

test('denied access to the project inside gives no folder, not the one above', async () => {
  const above = dir('projects', { 'acme-services': project('services', 'Client') }, ['acme-services']);
  assert.equal(await intoProject(above, 'acme-services'), null);
});

test('granting access to a project with the folder above it remembers the project inside', async () => {
  const handles: Record<string, unknown> = {};
  fakeIndexedDb(handles);
  const w = globalThis as unknown as { window?: unknown };
  const realWindow = w.window;
  w.window = { showDirectoryPicker: async () => projects };
  try {
    assert.equal(await grantAccess({ project: { id: 'p-cards', name: 'acme-cards' } }), true);
  } finally {
    w.window = realWindow;
  }
  assert.equal((handles['project:p-cards'] as FileSystemDirectoryHandle).name, 'acme-cards');
});

test('granting access fails when the project inside the folder above is denied - nothing remembered', async () => {
  const handles: Record<string, unknown> = {};
  fakeIndexedDb(handles);
  const w = globalThis as unknown as { window?: unknown };
  const realWindow = w.window;
  const above = dir('projects', { 'acme-cards': project('cards', 'Card') }, ['acme-cards']);
  w.window = { showDirectoryPicker: async () => above };
  try {
    assert.equal(await grantAccess({ project: { id: 'p-cards', name: 'acme-cards' } }), false);
  } finally {
    w.window = realWindow;
  }
  assert.equal(handles['project:p-cards'], undefined);
});
