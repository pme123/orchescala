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
    if (m.text().startsWith('Failed to load resource') && /\/(ai|platform)\/config$/.test(m.location().url)) return;
    w.errors.push(`console: ${m.text()}`);
  });
  page.on('request', (r) => {
    const p = new URL(r.url()).pathname;
    if (p.startsWith('/ai/') || p.startsWith('/spec/') || p.startsWith('/worker/') || p.startsWith('/platform/')) w.studio.push(`${r.method()} ${p}`);
  });
  return w;
}

/** The fixture folder into the browser's file system, then orch-spec opens it as its folder. */
async function openFolder(page: Page, edit: (files: Record<string, string>) => Record<string, string> = (f) => f, query = '') {
  const files = edit(Object.fromEntries(folderFiles.map((f) => [f, fs.readFileSync(path.join(FOLDER, f), 'utf8')])));
  await page.goto(`/?opfs${query}`);
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

// the step in the list of the flow - not its label in the BPMN diagram (an SVG <tspan>): which of
// the two comes first depends on when the diagram is drawn, and in the diagram bpmn-js' hit
// area takes the click
const approveOrderStep = (page: Page) =>
  page.getByText('approve order').and(page.locator('span')).first();

async function openProcess(page: Page) {
  await page.getByText('acme-demo-orderV1').click();
  await expect(approveOrderStep(page)).toBeVisible();
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

/** The fixture with «check order» as a DMN decision of the process instead of a worker. */
function withDecision(files: Record<string, string>): Record<string, string> {
  const spec = JSON.parse(files['processes/order.json']);
  spec.interactions = spec.interactions.map((i: { id: string }) => (i.id === 'ia-check' ? { ...i, kind: 'decision' } : i));
  spec.steps = spec.steps.map((s: { id: string; topic?: string }) => {
    if (s.id !== 'CheckOrderTask') return s;
    const { topic: _, ...rest } = s;
    return { ...rest, kind: 'rule' };
  });
  const bpmn = files['processes/order.bpmn']
    .replace(/<bpmn:serviceTask id="CheckOrderTask"[^>]*>/,
      '<bpmn:businessRuleTask id="CheckOrderTask" name="check order" camunda:decisionRef="acme-demo-orderV1-checkOrder" camunda:mapDecisionResult="singleEntry">')
    .replace('</bpmn:serviceTask>', '</bpmn:businessRuleTask>');
  // a changed fixture fails here, not later as a timeout in the UI
  if (!bpmn.includes('<bpmn:businessRuleTask id="CheckOrderTask"') || bpmn.includes('<bpmn:serviceTask id="CheckOrderTask"'))
    throw new Error('withDecision: the fixture has no service task CheckOrderTask to turn into a decision');
  if (!spec.interactions.some((i: { kind: string }) => i.kind === 'decision'))
    throw new Error('withDecision: the fixture has no interaction ia-check');
  return { ...files, 'processes/order.json': JSON.stringify(spec), 'processes/order.bpmn': bpmn };
}

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
  // asked once whether there is a studio, and once whether it has runs - nothing else went to it; no
  // button of a run
  await expect(page.getByRole('button', { name: 'Auf Testumgebung' })).toHaveCount(0);
  expect(w.studio).toEqual(['GET /ai/config', 'GET /platform/config']);
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

test('while Claude works on a draft, the process stays as it is - editing again after it', async ({ page }) => {
  await page.route('**/ai/config', (route) => route.fulfill({
    json: { enabled: true, provider: 'anthropic', model: 'claude-opus-5-5', tasks: ['processCreator'], skills: { processCreator: { name: 'processCreator-anthropic', version: 2 } } },
  }));
  // Claude does not answer: the turn runs until it is stopped
  const asked = page.waitForRequest('**/ai/processCreator/turn');
  await page.route('**/ai/processCreator/turn', () => {});
  await openFolder(page);
  await openProcess(page);
  const title = page.getByPlaceholder('Fachlicher Titel');
  await expect(title).toBeEnabled();

  await page.locator(AI.process).click();
  await page.getByPlaceholder('Was soll sich am Ablauf ändern?').fill('Nach der Freigabe den Kunden informieren');
  await page.getByTitle('Senden (Enter)').click();
  await asked;
  await expect(page.getByText('Claude arbeitet')).toBeVisible();
  // an edit now would make the draft refuse to be taken over
  await expect(title).toBeDisabled();

  await page.getByTitle('Anhalten').click();
  await expect(page.getByText('Claude arbeitet')).toBeHidden();
  await expect(title).toBeEnabled();
});

test('the loop on the studio: one request /ai/<task>/turn, its events and its draft', async ({ page }) => {
  const w = watch(page);
  await page.route('**/ai/config', (route) => route.fulfill({
    json: { enabled: true, provider: 'anthropic', model: 'claude-opus-5-5', tasks: ['processCreator'], skills: { processCreator: { name: 'processCreator-anthropic', version: 2 } } },
  }));
  const sent: Record<string, unknown>[] = [];
  await page.route('**/ai/processCreator/turn', (route) => {
    const body = route.request().postDataJSON() as { history: unknown[]; prompt: string; draft: { spec: { title: string } } };
    sent.push(body);
    const draft = { ...body.draft, spec: { ...body.draft.spec, title: 'Bestellung freigeben' } };
    const usage = { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, requests: 1, fallbacks: [] };
    const lines = [
      { kind: 'usage', usage },
      { kind: 'text', text: 'Ich habe den Titel geändert.' },
      { kind: 'result', result: {
        history: [...body.history, { role: 'user', content: body.prompt }, { role: 'assistant', content: [{ type: 'text', text: 'Ich habe den Titel geändert.' }] }],
        draft, usage, stop: 'done', text: 'Ich habe den Titel geändert.', errors: [],
      } },
    ];
    return route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: lines.map((l) => JSON.stringify(l)).join('\n') + '\n' });
  });
  await openFolder(page);
  await openProcess(page);
  await page.locator(AI.process).click();
  await page.getByPlaceholder('Was soll sich am Ablauf ändern?').fill('Nenne den Prozess «Bestellung freigeben»');
  await page.getByTitle('Senden (Enter)').click();
  await expect(page.getByText('Ich habe den Titel geändert.').first()).toBeVisible();
  await expect(page.getByText('Entwurf – Unterschiede')).toBeVisible();
  // the context of the tools went along - the catalog of the folder; nothing else went to the studio
  expect(Object.keys(sent[0])).toEqual(['context', 'system', 'history', 'prompt', 'draft']);
  expect(Object.keys(sent[0].context as object)).toEqual(['model', 'services']);
  expect(w.studio).toEqual(['GET /ai/config', 'GET /platform/config', 'POST /ai/processCreator/turn']);
  expect(w.errors).toEqual([]);
});

/** A page of the folder as saved - its JSON. */
const savedPage = (page: Page, slug: string) =>
  page.evaluate(async (s) => {
    const root = await navigator.storage.getDirectory();
    const file = await (await (await root.getDirectoryHandle('pages')).getFileHandle(`${s}.json`)).getFile();
    return JSON.parse(await file.text()) as { title: string; path: string; body: { type: string; actions?: { do: string; taskKey?: string }[] }[] };
  }, slug);
const completes = (p: Awaited<ReturnType<typeof savedPage>>) =>
  p.body.flatMap((b) => b.actions ?? []).filter((a) => a.do === 'completeTask').map((a) => a.taskKey);

test('a user task gets its page: a new one from the dialog «Neu» filled in, or one that is there', async ({ page }) => {
  const w = watch(page);
  await openFolder(page);
  // one page that is there - without the task
  await createPage(page);
  await expect.poll(() => savedPages(page)).toContain('termin.json');

  await page.getByRole('button', { name: 'Prozesse', exact: true }).first().click();
  await openProcess(page);
  await approveOrderStep(page).click();

  // an existing page: it gets a button «Abschliessen» for the task
  await page.getByTitle(/Eine bestehende Seite schliesst «ApproveOrderUT» ab/).selectOption({ label: 'Termin buchen' });
  await expect(page.getByText(/schliesst jetzt «ApproveOrderUT» ab/)).toBeVisible();
  expect(completes(await savedPage(page, 'termin'))).toEqual(['ApproveOrderUT']);

  // a new page: the dialog «Neu» with the title of the step and a path for the task
  await page.getByRole('button', { name: 'Seite anlegen' }).click();
  await expect(page.getByPlaceholder('Termin buchen')).toHaveValue('approve order');
  await expect(page.getByPlaceholder('appointments/book')).toHaveValue('tasks/approve-order-ut');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await expect.poll(() => savedPages(page)).toContain('approve-order-ut.json');
  const created = await savedPage(page, 'approve-order-ut');
  expect([created.title, created.body.map((b) => b.type), completes(created)]).toEqual(['approve order', ['heading', 'fields', 'button'], ['ApproveOrderUT']]);
  expect(w.errors).toEqual([]);
});

// The DMN editor (dmn-js) is a lazy chunk - the build succeeds even when the bundler puts its
// modules in the wrong order; it only fails when a table opens (`Class extends value undefined`).
// The runs of the studio (E25): the studio is faked - its config, the preview, the status as it moves.
test('the runs of the studio: «Auf Testumgebung» with the preview, the spec locked while the run is open, go on, «Übergeben»', async ({ page }) => {
  const w = watch(page);
  const run = (over: Record<string, unknown>) => ({
    runId: '20261118-0900', kind: 'test', project: 'acme-demo', state: 'running', startedBy: 're@acme.ch', work: 'filiale', workBranch: 'orch-spec/acme-demo/filiale',
    step: { index: 5, of: 8, name: 'Kompilieren und testen', since: '2026-11-18T09:00:10Z' },
    steps: ['Projekt', 'Auschecken', 'Branch', 'Merge', 'Kompilieren und testen', 'Release', 'Deploy auf Test', 'Simulationen, Import prüfen']
      .map((name, i) => ({ name, state: i < 4 ? 'ok' : i === 4 ? 'running' : 'pending', ...(i < 4 ? { durationMs: 1000 } : {}), expectedMs: i === 4 ? 180000 : 4000 })),
    version: null, testUrl: null, pullRequest: null, tests: null, simulations: null, merge: { merged: 3, create: 1 }, waitingFor: null, error: null, ...over,
  });
  const work = { work: 'filiale', branch: 'orch-spec/acme-demo/filiale', rounds: [] as unknown[], pullRequest: null as unknown };
  // what the studio answers on `status` - the routes below move it on
  const studio: { status: unknown; work: unknown } = { status: null, work: null };
  const sent: Record<string, { files?: { path: string; text: string }[]; previewId?: string; work?: string; summary?: string }> = {};
  const files = Object.fromEntries(folderFiles.map((f) => [f, fs.readFileSync(path.join(FOLDER, f), 'utf8')]));
  await page.route('**/platform/config', (route) => route.fulfill({ json: { enabled: true, projects: [{ name: 'acme-demo', testUrl: 'http://localhost:8889/app/acme-demo/', handOver: true }] } }));
  await page.route('**/platform/acme-demo/status', (route) => route.fulfill({ json: studio }));
  await page.route('**/platform/acme-demo/preview', (route) => {
    sent.preview = route.request().postDataJSON();
    // on the branch the process still has its old title
    const before = Object.entries(files).map(([file, text]) => ({ path: file, text: file === 'processes/order.json' ? JSON.stringify({ ...JSON.parse(text), title: 'Bestellung' }) : text }));
    return route.fulfill({ json: { previewId: 'p20261118-090001', work: null, plan: { summary: { create: 1, merged: 3, unchanged: 12, conflict: 0 }, conflicts: [], files: [{ path: 'src/Order.scala', action: 'merged' }, { path: 'src/CheckOrder.scala', action: 'merged', drift: 'only' }] }, before } });
  });
  await page.route('**/platform/acme-demo/test', (route) => {
    sent.test = route.request().postDataJSON();
    Object.assign(studio, { status: run({}), work });
    return route.fulfill({ status: 202, json: studio });
  });
  await page.route('**/platform/acme-demo/continue', (route) => {
    Object.assign(studio, {
      status: run({ state: 'ok', step: null, version: '0.1.0-20261118-0900', testUrl: 'http://localhost:8889/app/acme-demo/', tests: { passed: 32, failed: 0 }, simulations: { passed: 4, failed: 0 },
        steps: run({}).steps.map((s) => ({ ...s, state: 'ok', durationMs: 2000 })) }),
      work: { ...work, rounds: [{ runId: '20261118-0900', version: '0.1.0-20261118-0900' }] },
    });
    return route.fulfill({ status: 202, json: studio });
  });
  await page.route('**/platform/acme-demo/hand-over', (route) => {
    const pullRequest = { url: 'https://github.com/acme/demo/pull/14', number: 14, merged: false };
    Object.assign(studio, { status: { ...(studio.status as object), pullRequest }, work: { ...(studio.work as object), pullRequest } });
    return route.fulfill({ json: studio });
  });

  await openFolder(page, (f) => f, '&runpoll=200');
  const header = page.getByRole('button', { name: 'Auf Testumgebung' });
  const dialog = page.getByRole('dialog');
  await expect(header).toBeVisible();
  await expect(page.getByRole('button', { name: 'Übergeben' })).toHaveCount(0);

  // the preview: what is new for the RE, what the merge does - and the name of the work, as it is the first run
  await header.click();
  await expect(dialog.locator('[data-run="plan"]')).toHaveText('1 neu · 3 gemergt');
  await expect(dialog.locator('[data-run="diff"]')).toContainText('Prozess Order');
  await expect(dialog.locator('[data-run="diff"]')).toContainText('Bestellung');
  // and what the merge changes although the RE did not: the code differed from the spec before
  await expect(dialog.locator('[data-run="drift"]')).toContainText('Eine Datei ändert sich nicht wegen dieser Änderung');
  const start = dialog.getByRole('button', { name: 'Auf Testumgebung' });
  await expect(start).toBeDisabled();
  await dialog.getByPlaceholder('termin-filiale').fill('Meine Arbeit');
  await expect(start).toBeDisabled();
  await dialog.getByPlaceholder('termin-filiale').fill('filiale');
  await start.click();
  // the whole folder went to the studio, then the start with the preview
  expect(sent.preview.files!.map((f) => f.path)).toEqual(['config/model.json', 'processes/order.bpmn', 'processes/order.json']);
  expect([sent.test.previewId, sent.test.work]).toEqual(['p20261118-090001', 'filiale']);
  expect(sent.test.summary).toMatch(/^Orch Spec: filiale\n\n[~+-] Prozess Order/);
  expect(sent.test.summary).toMatch(/\n\nNicht von dieser Änderung – der Code wich schon vorher von der Spez ab:\n- src\/CheckOrder\.scala$/);

  // the run: its steps in the dialog, in the header the step it is in - and the spec is locked
  await expect(dialog).toContainText('Auf die Testumgebung – läuft');
  await expect(dialog.locator('[data-step="running"]')).toHaveText(/Kompilieren und testen/);
  await dialog.getByRole('button', { name: 'Schliessen' }).last().click();
  const chip = page.locator('[data-run-state]');
  await expect(chip).toHaveText(/5\/8 Kompilieren und testen/);
  await expect(header).toHaveCount(0);
  await openProcess(page);
  const title = page.getByPlaceholder('Fachlicher Titel');
  await expect(title).toBeDisabled();

  // a test fails: the run waits, the spec stays locked; after the fix it goes on
  studio.status = run({
    state: 'waiting', waitingFor: 'developer', tests: { passed: 31, failed: 1 },
    steps: run({}).steps.map((s, i) => (i === 4 ? { ...s, state: 'failed', durationMs: 13000 } : s)),
    error: { step: 'Kompilieren und testen', message: 'Ein Test ist fehlgeschlagen.', log: 'OrderWorkerTest failed', conflicts: [] },
  });
  await expect(chip).toHaveAttribute('data-run-state', 'waiting');
  await expect(title).toBeDisabled();
  await chip.click();
  await expect(dialog).toContainText('Kompilieren und testen: Ein Test ist fehlgeschlagen.');
  await expect(dialog).toContainText('31 Tests ok, 1 fehlgeschlagen');
  await dialog.getByRole('button', { name: 'Fortsetzen' }).click();
  await expect(dialog.locator('[data-run="facts"]')).toHaveText('32 Tests ok · 4 Simulationen ok · Version 0.1.0-20261118-0900');
  await expect(dialog.getByRole('link', { name: 'Test-Umgebung' })).toHaveAttribute('href', 'http://localhost:8889/app/acme-demo/');

  // «Übergeben»: the pull request
  await dialog.getByRole('button', { name: 'Übergeben' }).click();
  await dialog.getByRole('button', { name: 'Übergeben' }).click();
  await expect(dialog.getByRole('link', { name: /Pull Request #14/ })).toHaveAttribute('href', 'https://github.com/acme/demo/pull/14');
  await dialog.getByRole('button', { name: 'Schliessen' }).last().click();
  // the run is over: the spec is free again, the buttons are back
  await expect(title).toBeEnabled();
  await expect(chip).toHaveText(/Auf Test: 0\.1\.0-20261118-0900/);
  await expect(header).toBeVisible();
  await expect(page.getByRole('button', { name: 'Übergeben' })).toBeVisible();
  expect(w.errors).toEqual([]);
});

// Any change to the chunk rules in vite.config.ts must keep this green.
test('a DMN table opens in the built app: the chunks of the DMN editor load in order', async ({ page }) => {
  const w = watch(page);
  await openFolder(page, withDecision);
  await openProcess(page);
  await page.getByText('check order').and(page.locator('span')).first().click();
  await page.getByRole('button', { name: 'Neu anlegen' }).click();
  await expect(page.getByText('Hit policy:')).toBeVisible();
  await page.getByRole('button', { name: 'View DRD' }).click();
  await expect(page.locator('.djs-container').last()).toBeVisible();
  expect(w.errors).toEqual([]);
});
