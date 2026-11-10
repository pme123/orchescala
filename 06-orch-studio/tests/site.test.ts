// The site of the studio - the cases of SiteRoutesSpec (Scala) before the studio became TypeScript (E28,
// step 3); the apps come from a folder now (04-orch-doc/bundle/orch-doc-site), no longer from a jar.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { studioApp } from '../src/app.ts';
import { memoryLog } from '../src/log.ts';
import { appsSource, cacheControl, folderHints, folderSource, isCompanyData, memorySource, siteOf, type Resolved } from '../src/site.ts';

const write = (root: string, rel: string, text: string) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
};
const temp = (prefix: string) => mkdtempSync(join(tmpdir(), prefix));

/** The apps as Orchescala builds them - with their index; a catalog that is not listed, one that is. */
function apps(): string {
  const dir = temp('apps-');
  const files = { 'index.html': 'orch-doc', 'assets/index-abc.js': 'js', 'spec/index.html': 'orch-spec', 'spec/assets/main-x.js': 'spec-js', 'ops/index.html': 'orch-ops', 'spec/catalog.generated.json': '["of the developer"]' };
  Object.entries(files).forEach(([rel, text]) => write(dir, rel, text));
  write(dir, 'unlisted.txt', 'not in files.txt');
  write(dir, 'files.txt', `${Object.keys(files).join('\n')}\n`);
  return dir;
}

/** The company's documentation. */
function data(): string {
  const dir = temp('site-');
  write(dir, 'index.json', '{"companies":[{"id":"democompany"}]}');
  write(dir, 'index.html', "old orch-doc of the company's site");
  write(dir, 'democompany/docs.json', '{}');
  write(dir, 'democompany/customer/OpenApi.yml', 'openapi: 3.1.0');
  write(dir, 'democompany/2026-04/index.html', 'classic');
  write(dir, 'spec/catalog.generated.json', '[]');
  return dir;
}

function withSite(run: (s: { site: ReturnType<typeof siteOf>; dir: string; get: (path: string, method?: string) => Promise<Response> }) => Promise<void> | void) {
  return async () => {
    const appsDir = apps();
    const dir = data();
    try {
      const site = siteOf([memorySource({}), appsSource(appsDir), folderSource(dir)]);
      const app = studioApp({ site, skills: [], log: memoryLog() });
      await run({ site, dir, get: async (path, method = 'GET') => app.request(path, { method }) });
    } finally {
      rmSync(appsDir, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

const textOf = (r: Resolved) => (r.kind === 'file' ? r.bytes.toString('utf8') : r.kind);

test('the apps under /site/, /site/spec/ and /site/ops/', withSite(async ({ get }) => {
  const doc = await get('/site/');
  assert.equal(await doc.text(), 'orch-doc');
  assert.equal(await (await get('/site/spec/')).text(), 'orch-spec');
  assert.equal(await (await get('/site/ops/')).text(), 'orch-ops');
  assert.equal(doc.headers.get('content-type'), 'text/html; charset=utf-8');
}));

test("the app wins over the old copy in the company's site", withSite(({ site }) => {
  assert.equal(textOf(site.resolve('/index.html')), 'orch-doc');
}));

test("the company's documentation from its folder", withSite(async ({ get }) => {
  assert.equal((await get('/site/index.json')).status, 200);
  assert.equal((await get('/site/democompany/customer/OpenApi.yml')).headers.get('content-type'), 'text/yaml; charset=utf-8');
  assert.equal((await get('/site/spec/catalog.generated.json')).status, 200);
  assert.equal(await (await get('/site/democompany/2026-04/')).text(), 'classic');
}));

test('redirects: folders get their slash, a company its page, short ways', withSite(async ({ get }) => {
  const location = async (path: string) => {
    const r = await get(path);
    assert.equal(r.status, 302, path);
    return r.headers.get('location');
  };
  assert.equal(await location('/site'), '/site/');
  assert.equal(await location('/site/spec'), '/site/spec/');
  assert.equal(await location('/site/democompany'), '/site/#/democompany');
  assert.equal(await location('/site/democompany/index.html'), '/site/#/democompany');
  assert.equal(await location('/'), '/site/');
  assert.equal(await location('/spec'), '/site/spec/');
  assert.equal(await location('/ops'), '/site/ops/');
}));

test('HEAD answers like GET, without the body', withSite(async ({ get }) => {
  const there = await get('/site/index.html', 'HEAD');
  assert.equal(there.status, 200);
  assert.equal(await there.text(), '');
  assert.equal((await get('/site/missing.html', 'HEAD')).status, 404);
}));

test('hashed assets are kept, the rest asked again', () => {
  assert.match(cacheControl('spec/assets/main-x.js'), /immutable/);
  assert.equal(cacheControl('spec/index.html'), 'no-cache');
  assert.equal(cacheControl('democompany/docs.json'), 'no-cache');
});

test('nothing outside the site, nothing that is not there', withSite(async ({ site, get }) => {
  for (const path of ['/../secret.txt', '/%2E%2E/secret.txt', '/democompany%2F..%2F..%2Fsecret.txt', '/missing.json', '/democompany/customer', '/a%00b'])
    assert.equal(site.resolve(path).kind, 'notFound', path);
  assert.equal((await get('/site/%2e%2e/%2e%2e/etc/passwd')).status, 404);
}));

test('the company folders of orch-spec and orch-ops', () => {
  const folder = temp('spec-');
  try {
    const hints = folderHints([{ app: 'spec', dir: folder }, { app: 'ops', dir: join(folder, 'missing') }]);
    assert.equal(hints.read('spec/folder.json')?.toString('utf8'), JSON.stringify({ path: folder }));
    assert.equal(hints.read('ops/folder.json'), undefined);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('the apps: only what their index lists, never a file of the company, not the index itself', () => {
  const dir = apps();
  try {
    const s = appsSource(dir)!;
    assert.equal(s.read('spec/index.html')?.toString('utf8'), 'orch-spec');
    assert.equal(s.read('unlisted.txt'), undefined);
    assert.equal(s.read('files.txt'), undefined);
    // the catalog of orch-spec is the company's - never one the build of the apps brings
    assert.equal(s.read('spec/catalog.generated.json'), undefined);
    assert.equal(appsSource(join(dir, 'missing')), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the company data - the catalog and the folders, not the apps', () => {
  assert.ok(isCompanyData('spec/catalog.generated.json'));
  assert.ok(isCompanyData('spec/folder.json'));
  assert.ok(!isCompanyData('spec/index.html'));
});

test("a symbolic link out of the company's folder is not served", () => {
  const dir = data();
  const outside = temp('outside-');
  try {
    write(outside, 'secret.txt', 'secret');
    symlinkSync(join(outside, 'secret.txt'), join(dir, 'democompany', 'leak.txt'));
    symlinkSync(outside, join(dir, 'democompany', 'out'));
    symlinkSync(join(dir, 'democompany', 'docs.json'), join(dir, 'democompany', 'inside.json'));
    const folder = folderSource(dir);
    assert.equal(folder.read('democompany/leak.txt'), undefined);
    assert.equal(folder.read('democompany/out/secret.txt'), undefined);
    // a link that stays inside is fine
    assert.equal(folder.read('democompany/inside.json')?.toString('utf8'), '{}');
    // a folder is no file
    assert.equal(folder.read('democompany'), undefined);
    // a name that starts with dots is a name, not a way out
    write(dir, '..notes.md', 'dots');
    assert.equal(folder.read('..notes.md')?.toString('utf8'), 'dots');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('the folder of orch-spec as JSON - also with a control character in its path', () => {
  const folder = temp('spec\nnew "line"');
  try {
    const json = folderHints([{ app: 'spec', dir: folder }]).read('spec/folder.json')?.toString('utf8');
    assert.equal((JSON.parse(json!) as { path: string }).path, folder);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('without the documentation of a company: the apps only', async () => {
  const appsDir = apps();
  try {
    const app = studioApp({ site: siteOf([appsSource(appsDir), undefined]), skills: [], log: memoryLog() });
    assert.equal(await (await app.request('/site/')).text(), 'orch-doc');
    assert.equal((await app.request('/site/index.json')).status, 404);
  } finally {
    rmSync(appsDir, { recursive: true, force: true });
  }
});
