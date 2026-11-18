// The runs of the studio over REST (E28, step 6.2) - the routes without a port (app.request), with real
// git against the repo of runFixture.ts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { studioApp } from '../src/app.ts';
import { MAX_SPEC } from '../src/run/routes.ts';
import { readJson, writeJson, type RunStatus } from '../src/run/status.ts';
import { siteOf } from '../src/site.ts';
import { BRANCH, fixture, RE } from './runFixture.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The studio with the project of a fixture - or without runs. */
const studio = (f?: ReturnType<typeof fixture>) =>
  studioApp({ site: siteOf([]), skills: [], log: f?.log ?? { info: () => undefined, warn: () => undefined, error: () => undefined }, ...(f ? { platform: { projects: [f.project], deps: f.deps } } : {}) });
const post = (path: string, body?: unknown) => new Request(`http://studio${path}`, { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }) });
const files = (model: string, extra: Json[] = []) => [{ path: 'config/model.json', text: model }, ...extra];

/** Asks the status until the run is no longer running. */
async function settled(app: ReturnType<typeof studio>): Promise<Json> {
  const { status } = (await (await app.request('/platform/app/status')).json()) as Json;
  if (status?.state !== 'running') return status as Json;
  await new Promise((later) => setTimeout(later, 20));
  return settled(app);
}

test('GET /platform/config - the projects with a run, or off; an unknown project is 404', async () => {
  const f = fixture();
  try {
    assert.equal(await (await studio(f).request('/platform/config')).text(), '{"enabled":true,"projects":[{"name":"app","testUrl":"http://localhost:8889/app/app","handOver":true}]}');
    assert.equal(await (await studio().request('/platform/config')).text(), '{"enabled":false}');
    const off = await studio().request('/platform/app/status');
    assert.deepEqual([off.status, await off.json()], [404, { error: 'Die Läufe des Studios sind aus (STUDIO_PROJECTS).' }]);
    const unknown = await studio(f).request(post('/platform/other/cancel'));
    assert.deepEqual([unknown.status, await unknown.json()], [404, { error: 'Das Studio kennt kein Projekt «other».' }]);
    assert.deepEqual(await (await studio(f).request('/platform/app/status')).json(), { status: null, work: null });
  } finally {
    f.done();
  }
});

test('preview, «Auf Testumgebung», status, «Übergeben» - the run goes on in the background, a second one is refused', async () => {
  const f = fixture();
  try {
    const app = studio(f);
    // the preview: the plan of the merge and the spec as it is on develop - nothing on the branch yet
    const first = await app.request(post('/platform/app/preview', { files: files('{"v":2}\n', [{ path: 'pages/logo.bin', base64: '/wD+' }]) }));
    assert.equal(first.status, 200);
    const preview = (await first.json()) as Json;
    assert.match(preview.previewId, /^p20261118-0900\d\d$/);
    assert.deepEqual([preview.work, preview.plan.summary, preview.plan.conflicts], [null, { update: 2, conflict: 0 }, []]);
    assert.deepEqual(preview.plan.files, [{ path: 'a', action: 'update' }]);
    assert.deepEqual(preview.before, [{ path: 'config/model.json', text: '{"v":1}\n' }]);
    assert.throws(() => f.onBranch('projects/app/spec/config/model.json'));
    assert.deepEqual(f.calls(), ['check']);

    // the first run of a work needs its name
    const noName = await app.request(post('/platform/app/test', { previewId: preview.previewId }));
    assert.deepEqual([noName.status, await noName.json()], [409, { error: 'Der erste Lauf einer Arbeit braucht ihren Namen.' }]);
    const started = await app.request(post('/platform/app/test', { previewId: preview.previewId, work: 'filiale', summary: 'Feld Filiale', author: RE }));
    assert.equal(started.status, 202);
    const running = (await started.json()) as Json;
    assert.deepEqual([running.status.state, running.status.workBranch, running.work.work], ['running', BRANCH, 'filiale']);
    // while it runs: no second run, no preview, no hand-over
    const second = await app.request(post('/platform/app/test', { previewId: preview.previewId }));
    assert.equal(second.status, 409);
    assert.match(((await second.json()) as Json).error, /ist gerade an der Arbeit \(ein Lauf\)/);
    assert.equal((await app.request(post('/platform/app/preview', { files: files('{}') }))).status, 409);
    assert.equal((await app.request(post('/platform/app/cancel'))).status, 409);

    const done = await settled(app);
    assert.deepEqual([done.state, done.version, done.startedBy, done.tests], ['ok', `0.1.0-${done.runId}`, 're@democompany.ch', { passed: 3, failed: 0 }]);
    assert.equal(f.onBranch('projects/app/spec/config/model.json'), '{"v":2}');
    assert.equal(f.onBranch('projects/app/spec/pages/logo.bin').length > 0, true);

    // the next preview knows the work and compares with its branch
    f.clock.t += 3600_000;
    const next = (await (await app.request(post('/platform/app/preview', { files: files('{"v":3}\n') }))).json()) as Json;
    assert.equal(next.work, 'filiale');
    assert.equal(next.before.find((x: Json) => x.path === 'config/model.json').text, '{"v":2}\n');
    // the earlier preview is gone
    const gone = await app.request(post('/platform/app/test', { previewId: preview.previewId }));
    assert.deepEqual([gone.status, await gone.json()], [409, { error: 'Die Vorschau ist nicht mehr da – nochmals «Auf Testumgebung».' }]);

    const handed = await app.request(post('/platform/app/hand-over'));
    assert.equal(handed.status, 200);
    assert.deepEqual(((await handed.json()) as Json).status.pullRequest, { url: 'https://github.com/democompany/company/pull/14', number: 14, merged: false });
    assert.equal(f.prs.length, 1);
  } finally {
    f.done();
  }
});

test('a run that waits - continue goes on in the background, cancel gives it up; conflicts show in the preview', async () => {
  const f = fixture();
  try {
    const app = studio(f);
    const start = async (model: string, extra: Json[] = []) => {
      const preview = (await (await app.request(post('/platform/app/preview', { files: files(model, extra) }))).json()) as Json;
      await app.request(post('/platform/app/test', { previewId: preview.previewId, work: 'filiale' }));
      return preview;
    };
    await start('{"broken":true}\n');
    const waiting = await settled(app);
    assert.deepEqual([waiting.state, waiting.waitingFor, waiting.error.step], ['waiting', 'developer', 'Kompilieren und testen']);
    // the spec is locked: no preview while the run is open
    const locked = await app.request(post('/platform/app/preview', { files: files('{}') }));
    assert.deepEqual([locked.status, await locked.json()], [409, { error: `Das Projekt «app» hat den Lauf ${waiting.runId} offen – die Spez ist gesperrt.` }]);

    f.fix({ 'projects/app/src/Fix.scala': 'object Fix\n' });
    const going = await app.request(post('/platform/app/continue'));
    assert.deepEqual([going.status, ((await going.json()) as Json).status.state], [202, 'running']);
    assert.equal((await settled(app)).state, 'ok');
    const nothing = await app.request(post('/platform/app/continue'));
    assert.deepEqual([nothing.status, await nothing.json()], [409, { error: 'Das Projekt «app» hat keinen Lauf, der wartet.' }]);

    // conflicts: the preview names them before the run
    f.clock.t += 3600_000;
    const preview = await start('{"v":4}\n', [{ path: 'conflict', text: 'x' }]);
    assert.deepEqual(preview.plan.conflicts, ['projects/app/src/Main.scala']);
    assert.equal((await settled(app)).error.step, 'Merge');
    const cancelled = await app.request(post('/platform/app/cancel'));
    assert.deepEqual([cancelled.status, ((await cancelled.json()) as Json).status.state], [200, 'error']);
  } finally {
    f.done();
  }
});

test('a run of this studio that it does not know any more was interrupted - it shows as waiting and goes on', async () => {
  const f = fixture();
  try {
    const app = studio(f);
    const preview = (await (await app.request(post('/platform/app/preview', { files: files('{"v":2}\n') }))).json()) as Json;
    await app.request(post('/platform/app/test', { previewId: preview.previewId, work: 'filiale' }));
    const done = (await settled(app)) as unknown as RunStatus;
    // as if the studio had lost the run in step 7: `running` with its own pid, but no run at work
    writeJson(f.p.status, { ...done, state: 'running', pid: process.pid, step: { index: 7, of: 8, name: 'Deploy auf Test', since: '2026-11-18T09:00:09Z' } });
    const shown = ((await (await app.request('/platform/app/status')).json()) as Json).status;
    assert.deepEqual([shown.state, shown.waitingFor, shown.resumeAt], ['waiting', 'developer', 6]);
    assert.equal((await app.request(post('/platform/app/continue'))).status, 202);
    assert.equal((await settled(app)).state, 'ok');
    assert.deepEqual(f.calls().slice(-2), [`deploy ${done.version}`, `checkImport ${BRANCH}`]);
    assert.equal(readJson<RunStatus>(f.p.status)?.state, 'ok');
  } finally {
    f.done();
  }
});

test('a body that does not fit - no JSON, no files, a path outside the spec, too large', async () => {
  const f = fixture();
  try {
    const app = studio(f);
    const raw = (body: string, headers: Record<string, string> = {}) => app.request(new Request('http://studio/platform/app/preview', { method: 'POST', body, headers }));
    const noJson = await raw('{');
    assert.deepEqual([noJson.status, await noJson.json()], [400, { error: 'Die Anfrage ist kein JSON.' }]);
    assert.equal((await raw('[1]')).status, 400);
    const noFiles = await raw('{"files":"x"}');
    assert.deepEqual([noFiles.status, await noFiles.json()], [400, { error: 'Die Anfrage hat keine Liste «files».' }]);
    for (const path of ['../outside.json', '/etc/passwd', 'a//b', 'a\\b', '']) {
      const outside = await app.request(post('/platform/app/preview', { files: [{ path, text: 'x' }] }));
      assert.equal(outside.status, 409, path);
      assert.match(((await outside.json()) as Json).error, /hat keinen Pfad im Ordner/);
    }
    const noContent = await app.request(post('/platform/app/preview', { files: [{ path: 'a.json' }] }));
    assert.equal(noContent.status, 409);
    assert.equal((await raw('{}', { 'content-length': String(MAX_SPEC + 1) })).status, 413);
    // a spec that is none: the preview says so
    const none = await app.request(post('/platform/app/preview', { files: [{ path: 'readme.txt', text: 'x' }] }));
    assert.match(((await none.json()) as Json).error, /weder config\/model\.json noch processes/);
    assert.deepEqual(f.calls(), []);
  } finally {
    f.done();
  }
});
