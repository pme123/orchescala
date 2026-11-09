// orch-spec works without a server (E28): every later step of the studio in TypeScript must keep
// this green. The built app, served statically, opens a local folder (the browser's own file
// system, OPFS - the same LocalBackend as a folder on disk), shows a process and creates a page.
// Without a studio there is no AI and no request to the studio besides `GET /ai/config`.
//
// The cross-check fakes the studio's answer: then the AI shows - so «no AI» above is not just a
// selector that never matches.
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const FOLDER = path.resolve(import.meta.dirname, '../tests/fixtures/spec-folder');
const folderFiles = ['config/model.json', 'processes/order.json', 'processes/order.bpmn'];

/** What orch-spec shows of the AI - the header, the process view, the page designer. */
const AI = {
  header: 'button[title^="KI-Modus an"]',
  process: 'button[title^="Claude – den Ablauf"]',
  page: 'button[title^="Claude - die Seite"]',
};

type Watch = { errors: string[]; studio: string[] };

/** Uncaught errors and console errors of the page, and every request to the studio's paths. A
  * missing studio answers 404 on /ai/config - the browser logs that, it is no error of orch-spec. */
function watch(page: Page): Watch {
  const w: Watch = { errors: [], studio: [] };
  page.on('pageerror', (e) => w.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (m.text().startsWith('Failed to load resource') && m.location().url.endsWith('/ai/config')) return;
    w.errors.push(`console: ${m.text()}`);
  });
  page.on('request', (r) => {
    const p = new URL(r.url()).pathname;
    if (p.startsWith('/ai/') || p.startsWith('/spec/') || p.startsWith('/worker/')) w.studio.push(`${r.method()} ${p}`);
  });
  return w;
}

/** The fixture folder into the browser's file system, then orch-spec opens it as its folder. */
async function openFolder(page: Page) {
  const files = Object.fromEntries(folderFiles.map((f) => [f, fs.readFileSync(path.join(FOLDER, f), 'utf8')]));
  await page.goto('/?opfs');
  await page.evaluate(async (files) => {
    const root = await navigator.storage.getDirectory();
    for (const [file, text] of Object.entries(files)) {
      const parts = file.split('/');
      let dir = root;
      for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p, { create: true });
      const w = await (await dir.getFileHandle(parts.at(-1)!, { create: true })).createWritable();
      await w.write(text);
      await w.close();
    }
  }, files);
  await page.getByRole('button', { name: 'Ordner wählen' }).click();
  await expect(page.getByText('acme-demo-orderV1')).toBeVisible();
}

async function openProcess(page: Page) {
  await page.getByText('acme-demo-orderV1').click();
  await expect(page.getByText('approve order').first()).toBeVisible();
}

async function createPage(page: Page) {
  await page.getByRole('button', { name: 'Seiten', exact: true }).click();
  await page.getByRole('button', { name: 'Neu', exact: true }).click();
  await page.getByPlaceholder('Termin buchen').fill('Termin buchen');
  await page.getByPlaceholder('appointments/book').fill('termin');
  await page.getByRole('button', { name: 'Anlegen' }).click();
}

/** The files in pages/ of the browser's file system - what orch-spec saved. */
const savedPages = (page: Page) =>
  page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const names: string[] = [];
    try {
      for await (const [name] of (await root.getDirectoryHandle('pages')).entries()) names.push(name);
    } catch { /* no pages/ yet */ }
    return names;
  });

test('without a studio: folder, process and page work, no AI', async ({ page }) => {
  const w = watch(page);
  const config = page.waitForResponse('**/ai/config');
  await openFolder(page);
  // the checks for «no AI» below come after orch-spec read the answer - a static server has no studio
  expect((await config).status()).toBe(404);

  await openProcess(page);
  await expect(page.locator(AI.process)).toHaveCount(0);

  await createPage(page);
  await expect.poll(() => savedPages(page)).toContain('termin.json');
  await expect(page.locator(AI.page)).toHaveCount(0);

  await expect(page.locator(AI.header)).toHaveCount(0);
  expect(w.errors).toEqual([]);
  // asked once whether there is a studio - nothing else went to it
  expect(w.studio).toEqual(['GET /ai/config']);
});

test('a studio that does not answer does not hold orch-spec up', async ({ page }) => {
  // /ai/config never answers - the folder opens and the process shows while it is still pending.
  // An orch-spec that waits for the studio never gets there and fails on the test's timeout.
  const w = watch(page);
  await page.route('**/ai/config', () => { /* left pending */ });
  const asked = page.waitForRequest('**/ai/config');
  await openFolder(page);
  await asked;
  await openProcess(page);
  await expect(page.locator(AI.process)).toHaveCount(0);
  await expect(page.locator(AI.header)).toHaveCount(0);
  expect(w.errors).toEqual([]);
});

test('cross-check: with a studio the AI shows', async ({ page }) => {
  await page.route('**/ai/config', (route) => route.fulfill({
    json: {
      enabled: true, provider: 'anthropic', model: 'claude-opus-5-5',
      tasks: ['uiCreator', 'processCreator'],
      skills: { uiCreator: { name: 'uiCreator-anthropic', version: 1 }, processCreator: { name: 'processCreator-anthropic', version: 2 } },
    },
  }));
  await openFolder(page);
  await expect(page.locator(AI.header)).toBeVisible();

  await openProcess(page);
  await expect(page.locator(AI.process)).toBeVisible();

  await createPage(page);
  await expect(page.locator(AI.page)).toBeVisible();
});
