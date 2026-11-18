// «Auf Testumgebung» as a library (E28, step 6.1) - with real git against a bare repo in a temp folder;
// the commands of the project (merge, test, release, deploy, simulate) are small shell scripts that
// behave like the real ones: they copy the spec, write a plan and JUnit reports, and can fail.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { describe, main, personOf } from '../src/run/cli.ts';
import { commandEnvOf, exec, MAX_OUTPUT } from '../src/run/exec.ts';
import { gitHub, type GitHost, type PullRequest } from '../src/run/gitHost.ts';
import { parseProject, parseProjects, repoName, workBranch, type Project } from '../src/run/project.ts';
import { BRANCH, fixture, git, ME, ok, RE, write } from './runFixture.ts';
import { readJson, writeJson, type RunStatus, type Work } from '../src/run/status.ts';
import { baseVersion, cancelRun, continueRun, countReports, handOver, reportTimes, runStatus, startTest, STEPS } from '../src/run/testRun.ts';

test('two rounds on the same work branch - both on the test environment, one pull request', async () => {
  const f = fixture();
  try {
    const first = ok(await startTest(f.deps, f.project, { specDir: f.spec('one', '{"v":2}\n'), work: 'filiale', summary: 'Feld Filiale', author: RE }));
    assert.equal(first.state, 'ok');
    assert.deepEqual(first.steps.map((s) => s.state), STEPS.map(() => 'ok'));
    assert.deepEqual(first.steps.map((s) => s.name), [...STEPS]);
    assert.deepEqual(
      [first.runId, first.version, first.workBranch, first.startedBy, first.testUrl],
      ['20261118-0900', '0.1.0-20261118-0900', BRANCH, 're@democompany.ch', 'http://localhost:8889/app/app'],
    );
    assert.deepEqual([first.tests, first.simulations, first.merge], [{ passed: 3, failed: 0 }, { passed: 2, failed: 0 }, { update: 2, conflict: 0 }]);
    assert.deepEqual([first.step, first.error, first.waitingFor], [null, null, null]);
    // the work branch on the Git platform: the spec and the code generated from it, the RE as the author
    assert.equal(f.onBranch('projects/app/spec/config/model.json'), '{"v":2}');
    assert.equal(f.onBranch('projects/app/src/Generated.json'), '{"v":2}');
    assert.equal(git(f.origin, 'log', '-1', '--format=%an <%ae> / %cn / %s', BRANCH), 'Rita RE <re@democompany.ch> / Orch Studio / Feld Filiale');
    // the version of the release is not committed
    assert.throws(() => f.onBranch('projects/app/project/version.txt'));
    assert.deepEqual(f.calls(), ['merge', 'release 0.1.0-20261118-0900', 'deploy 0.1.0-20261118-0900', `checkImport ${BRANCH}`]);

    // the next round: the work is known, a commit more on the same branch, the durations of the last run expected
    f.clock.t += 3600_000;
    const second = ok(await startTest(f.deps, f.project, { specDir: f.spec('two', '{"v":3}\n'), summary: 'Filiale ist Pflicht', author: RE }));
    assert.deepEqual([second.state, second.version, second.workBranch], ['ok', '0.1.0-20261118-1000', BRANCH]);
    assert.ok(second.steps.every((s) => typeof s.expectedMs === 'number'));
    assert.deepEqual(git(f.origin, 'log', '--format=%s', `develop..${BRANCH}`).split('\n'), ['Filiale ist Pflicht', 'Feld Filiale']);
    // one work per project
    assert.match(String(await startTest(f.deps, f.project, { specDir: f.spec('two', '{"v":3}\n'), work: 'other' })), /offene Arbeit «filiale»/);

    // «Übergeben»: one pull request for the work, with its rounds - brought up to date the next time
    const pr = (await handOver(f.deps, f.project)) as PullRequest;
    assert.deepEqual(pr, { url: 'https://github.com/democompany/company/pull/14', number: 14, merged: false });
    assert.deepEqual([f.prs[0].head, f.prs[0].base, f.prs[0].title], [BRANCH, 'develop', 'Orch Spec: filiale']);
    assert.match(f.prs[0].body, /\*\*0\.1\.0-20261118-0900\*\*, 3 Tests ok, 2 Simulationen ok\n  Feld Filiale\n- \*\*0\.1\.0-20261118-1000\*\*/);
    assert.equal(runStatus(f.deps, f.project)?.pullRequest?.number, 14);
    assert.equal(readJson<Work>(f.p.work)?.rounds.length, 2);
    assert.deepEqual(f.merged, []);
    // the log of the studio: no content of the spec
    assert.ok(f.log.lines.some((l) => l === 'INFO app 20261118-0900 - ok: version 0.1.0-20261118-0900'));
  } finally {
    f.done();
  }
});

test('a test fails - the run waits with the log, a second run is refused; after the fix on the branch it goes on at step 5', async () => {
  const f = fixture();
  try {
    const waiting = ok(await startTest(f.deps, f.project, { specDir: f.spec('broken', '{"broken":true}\n'), work: 'filiale', author: RE }));
    assert.deepEqual([waiting.state, waiting.waitingFor, waiting.resumeAt], ['waiting', 'developer', 4]);
    assert.deepEqual(waiting.steps.map((s) => s.state), ['ok', 'ok', 'ok', 'ok', 'failed', 'pending', 'pending', 'pending']);
    assert.deepEqual(waiting.error, { step: 'Kompilieren und testen', message: 'Ein Test ist fehlgeschlagen.', log: 'error: 1 test failed', conflicts: [] });
    assert.deepEqual([waiting.tests, waiting.version], [{ passed: 2, failed: 1 }, null]);
    // the spec is on the branch already - development builds on it
    assert.equal(f.onBranch('projects/app/spec/config/model.json'), '{"broken":true}');
    assert.match(String(await startTest(f.deps, f.project, { specDir: f.spec('broken', '{"broken":true}\n') })), /hat den Lauf 20261118-0900 offen \(wartet\)/);
    assert.match(String(await handOver(f.deps, f.project)), /ist noch offen/);

    f.fix({ 'projects/app/src/Fix.scala': 'object Fix\n' });
    const done = ok(await continueRun(f.deps, f.project));
    assert.deepEqual([done.state, done.error, done.waitingFor, done.runId], ['ok', null, null, waiting.runId]);
    assert.deepEqual(done.tests, { passed: 3, failed: 0 });
    // the Git part did not run again; the release is of this run
    assert.deepEqual(f.calls(), ['merge', 'release 0.1.0-20261118-0900', 'deploy 0.1.0-20261118-0900', `checkImport ${BRANCH}`]);
    assert.equal(done.steps[0].durationMs, waiting.steps[0].durationMs);
    assert.match(String(await continueRun(f.deps, f.project)), /keinen Lauf, der wartet/);
  } finally {
    f.done();
  }
});

test('conflicts of the merge - committed with their markers, the run waits and names them; it goes on at step 5, the merge not again', async () => {
  const f = fixture();
  try {
    const waiting = ok(await startTest(f.deps, f.project, { specDir: f.spec('conflict', '{"v":2}\n', { conflict: 'x' }), work: 'filiale', author: RE }));
    assert.deepEqual([waiting.state, waiting.resumeAt, waiting.error?.step], ['waiting', 4, 'Merge']);
    assert.deepEqual(waiting.error?.conflicts, ['projects/app/src/Main.scala']);
    assert.match(waiting.error!.message, /^Der Merge hat einen Konflikt: /);
    assert.deepEqual(waiting.merge, { conflict: 1 });
    assert.equal(f.onBranch('projects/app/spec/conflict'), 'x');

    f.fix({ 'projects/app/src/Main.scala': 'object Main // resolved\n' });
    const done = ok(await continueRun(f.deps, f.project));
    assert.equal(done.state, 'ok');
    assert.deepEqual(done.steps.map((s) => s.state), STEPS.map(() => 'ok'));
    assert.equal(f.calls().filter((c) => c === 'merge').length, 1);
    assert.equal(readFileSync(join(f.p.projectDir, 'src/Main.scala'), 'utf8'), 'object Main // resolved\n');
  } finally {
    f.done();
  }
});

test('develop does not merge into the work branch - step 3 waits and runs again after development merged it', async () => {
  const f = fixture();
  try {
    ok(await startTest(f.deps, f.project, { specDir: f.spec('one', '{"v":2}\n'), work: 'filiale' }));
    // develop moves at the same place as the work branch
    git(f.dev, 'checkout', '-q', 'develop');
    write(join(f.dev, 'projects/app/spec/config/model.json'), '{"v":"develop"}\n');
    git(f.dev, 'commit', '-q', '-am', 'on develop');
    git(f.dev, 'push', '-q', 'origin', 'develop');
    f.clock.t += 3600_000;
    const waiting = ok(await startTest(f.deps, f.project, { specDir: f.spec('two', '{"v":3}\n') }));
    assert.deepEqual([waiting.state, waiting.resumeAt, waiting.error?.step], ['waiting', 2, 'Branch']);
    assert.match(waiting.error!.message, /«develop» lässt sich nicht in den Arbeits-Branch mergen/);
    assert.match(waiting.error!.log, /CONFLICT/);

    git(f.dev, 'fetch', '-q', 'origin');
    git(f.dev, 'checkout', '-q', '-B', BRANCH, `origin/${BRANCH}`);
    spawnSync('git', ['merge', 'origin/develop'], { cwd: f.dev, env: { ...process.env, ...ME } });
    write(join(f.dev, 'projects/app/spec/config/model.json'), '{"v":"both"}\n');
    git(f.dev, 'commit', '-q', '-am', 'develop merged');
    git(f.dev, 'push', '-q', 'origin', BRANCH);
    const done = ok(await continueRun(f.deps, f.project));
    assert.equal(done.state, 'ok', JSON.stringify(done.error));
    // the spec of the run is merged after it
    assert.equal(f.onBranch('projects/app/spec/config/model.json'), '{"v":3}');
  } finally {
    f.done();
  }
});

test('cancel - the lock is gone, the work branch stays; a run that was interrupted waits and goes on at its step', async () => {
  const f = fixture();
  try {
    ok(await startTest(f.deps, f.project, { specDir: f.spec('broken', '{"broken":true}\n'), work: 'filiale' }));
    const cancelled = cancelRun(f.deps, f.project) as RunStatus;
    assert.deepEqual([cancelled.state, cancelled.error?.message, cancelled.waitingFor, cancelled.step], ['error', 'Abgebrochen.', null, null]);
    assert.equal(f.onBranch('projects/app/spec/config/model.json'), '{"broken":true}');
    assert.match(String(cancelRun(f.deps, f.project)), /keinen Lauf, der wartet/);

    // the studio stops in step 6: `running`, but its process is gone
    f.clock.t += 3600_000;
    const next = ok(await startTest(f.deps, f.project, { specDir: f.spec('good', '{"v":2}\n') }));
    assert.equal(next.state, 'ok');
    const gone = spawnSync('true').pid!;
    writeJson(f.p.status, {
      ...next, state: 'running', pid: gone, version: null,
      step: { index: 6, of: 8, name: 'Release', since: '2026-11-18T10:00:05Z' },
      steps: next.steps.map((s, i) => (i === 5 ? { ...s, state: 'running' } : i > 5 ? { ...s, state: 'pending' } : s)),
    });
    assert.deepEqual([runStatus(f.deps, f.project)?.state, runStatus(f.deps, f.project)?.resumeAt], ['waiting', 5]);
    assert.match(String(await startTest(f.deps, f.project, { specDir: f.spec('good', '{"v":2}\n') })), /offen \(unterbrochen\)/);
    const before = f.calls().length;
    const done = ok(await continueRun(f.deps, f.project));
    assert.equal(done.state, 'ok');
    assert.deepEqual(f.calls().slice(before), [`release ${next.version}`, `deploy ${next.version}`, `checkImport ${BRANCH}`]);
  } finally {
    f.done();
  }
});

test('what does not start - no name for the first run, a wrong name, no folder; a spec that is none waits at step 1', async () => {
  const f = fixture();
  try {
    assert.match(String(await startTest(f.deps, f.project, { specDir: f.spec('one', '{}') })), /braucht ihren Namen/);
    assert.match(String(await startTest(f.deps, f.project, { specDir: f.spec('one', '{}'), work: 'Meine Arbeit' })), /nicht klein geschrieben/);
    assert.match(String(await startTest(f.deps, f.project, { specDir: join(f.root, 'missing'), work: 'filiale' })), /ist kein Ordner/);
    assert.equal(existsSync(f.p.status), false);
    mkdirSync(join(f.root, 'empty'));
    const waiting = ok(await startTest(f.deps, f.project, { specDir: join(f.root, 'empty'), work: 'filiale' }));
    assert.deepEqual([waiting.state, waiting.resumeAt, waiting.error?.step], ['waiting', 0, 'Projekt']);
    assert.match(String(await handOver({ ...f.deps, gitHost: undefined }, f.project)), /ist noch offen/);
    cancelRun(f.deps, f.project);
    assert.match(String(await handOver(f.deps, f.project)), /noch nie ok/);
  } finally {
    f.done();
  }
});

test('autoMerge - «Übergeben» merges itself; without a Git platform it says so', async () => {
  const f = fixture({ autoMerge: true });
  try {
    ok(await startTest(f.deps, f.project, { specDir: f.spec('one', '{"v":2}\n'), work: 'filiale' }));
    assert.match(String(await handOver({ ...f.deps, gitHost: () => 'Das Studio hat kein Token für die Git-Plattform (STUDIO_GIT_TOKEN).' }, f.project)), /kein Token/);
    assert.deepEqual(await handOver(f.deps, f.project), { url: 'https://github.com/democompany/company/pull/14', number: 14, merged: true });
    assert.deepEqual(f.merged, [14]);
    const failing: GitHost = { pullRequest: async () => { throw new Error('GitHub POST /pulls: 422 Validation Failed'); }, merge: async () => undefined };
    assert.match(String(await handOver({ ...f.deps, gitHost: () => failing }, f.project)), /liess sich nicht anlegen: GitHub POST \/pulls: 422/);
  } finally {
    f.done();
  }
});

test('a command that takes too long is stopped with what it started; one that is not there ends with 127', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'exec-'));
  try {
    const start = Date.now();
    const slow = await exec('sh', ['-c', 'echo begun; sleep 20 & wait'], { cwd: dir, timeoutMs: 200, logFile: join(dir, 'a.log') });
    assert.deepEqual([slow.timedOut, slow.output], [true, 'begun\n']);
    assert.ok(Date.now() - start < 5000);
    assert.equal(readFileSync(join(dir, 'a.log'), 'utf8'), 'begun\n');
    const missing = await exec('no-such-command-of-orch', [], { cwd: dir });
    assert.equal(missing.code, 127);
    assert.match(missing.output, /no-such-command-of-orch/);
    const env = await exec('sh', ['-c', 'echo "$ORCH_X"; exit 3'], { cwd: dir, env: { ORCH_X: 'yes' } });
    assert.deepEqual(env, { code: 3, output: 'yes\n', timedOut: false });
    // the settings of the studio - its token, its key of the AI - are not for the commands of a project
    assert.deepEqual(commandEnvOf({ ORCH_X: 'yes', GONE: undefined }, { PATH: '/bin', STUDIO_GIT_TOKEN: 'ghp_secret', STUDIO_AI_ANTHROPIC_API_KEY: 'sk-ant-secret' }), { PATH: '/bin', ORCH_X: 'yes' });
    process.env.STUDIO_GIT_TOKEN = 'ghp_secret';
    const seen = await exec('sh', ['-c', 'env'], { cwd: dir });
    delete process.env.STUDIO_GIT_TOKEN;
    assert.ok(seen.output.includes('PATH=') && !seen.output.includes('ghp_secret'));
    // only the end of a long output is kept; a log that cannot be written does not end the studio
    const long = await exec('sh', ['-c', `head -c ${3 * MAX_OUTPUT} /dev/zero | tr '\\0' a; echo; echo the-end`], { cwd: dir, logFile: join(dir, 'missing', 'a.log') });
    assert.deepEqual([long.code, long.output.length, long.output.endsWith('the-end\n')], [0, MAX_OUTPUT, true]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the reports and the version of a project', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reports-'));
  try {
    assert.equal(countReports(dir), null);
    write(join(dir, 'target/out/jvm/u/app-worker/test-reports/TEST-a.xml'), '<testsuite name="a" tests="5" errors="1" failures="1" skipped="1" time="0.1">\n<testcase/></testsuite>');
    write(join(dir, '03-worker/target/test-reports/TEST-b.xml'), '<testsuites><testsuite tests="2" failures="0" errors="0"></testsuite><testsuite tests="1"></testsuite></testsuites>');
    write(join(dir, 'node_modules/x/test-reports/c.xml'), '<testsuite tests="100">');
    write(join(dir, 'target/test-reports/notes.txt'), '<testsuite tests="100">');
    assert.deepEqual(countReports(dir), { passed: 5, failed: 2 });
    // only what this step wrote: the reports that are new or rewritten
    const before = reportTimes(dir);
    assert.equal(countReports(dir, before), null);
    write(join(dir, 'target/out/jvm/u/app-simulation/test-reports/TEST-s.xml'), '<testsuite tests="4" failures="0" errors="0" skipped="0">');
    assert.deepEqual(countReports(dir, before), { passed: 4, failed: 0 });
    assert.equal(baseVersion(dir), undefined);
    write(join(dir, 'project/ProjectDef.scala'), 'object ProjectDef {\n  val name = "app"\n  val version = "1.12.3-SNAPSHOT"\n  lazy val otherVersion = "9.9.9"\n}');
    assert.equal(baseVersion(dir), '1.12.3');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the projects of the company - the defaults of an Orchescala project, what is wrong is named', () => {
  const p = parseProject({ name: 'democompany-customer', repo: 'git@github.com:pme123/orchescala-democompany.git', path: '/projects/democompany-customer/', commands: { deploy: './deploy.sh' } }) as Project;
  assert.deepEqual(
    [p.path, p.develop, p.master, p.autoMerge, p.timeoutMinutes, p.gitHost, p.testUrl],
    ['projects/democompany-customer', 'develop', 'master', false, 30, undefined, undefined],
  );
  assert.equal(p.commands.merge, './helper.scala processFromSpec --merge --from "$ORCH_SPEC_DIR" --markers --yes --json "$ORCH_PLAN_FILE"');
  assert.deepEqual([p.commands.test, p.commands.release, p.commands.deploy, p.commands.checkImport], ['sbt --server -batch "compile; worker/test"', './helper.scala publish "$ORCH_VERSION"', './deploy.sh', undefined]);
  assert.equal(repoName(p), 'orchescala-democompany');
  assert.equal(repoName({ ...p, repo: 'https://github.com/pme123/orchescala-democompany/' }), 'orchescala-democompany');
  assert.equal(workBranch(p, 'termin-filiale'), 'orch-spec/democompany-customer/termin-filiale');
  const base = { name: 'app', repo: '/repos/app.git', commands: { deploy: 'true' } };
  assert.match(String(parseProject({ ...base, name: 'My App' })), /«My App» is not lower case/);
  assert.match(String(parseProject({ ...base, repo: ' ' })), /«app» has no repo/);
  assert.match(String(parseProject({ ...base, path: '../other' })), /leaves the repo/);
  assert.match(String(parseProject({ ...base, commands: {} })), /no command «deploy»/);
  assert.match(String(parseProject({ ...base, gitHost: { kind: 'gitlab', repo: 'a/b' } })), /gitHost of the project «app»/);
  assert.match(String(parseProject({ ...base, timeoutMinutes: 0 })), /timeoutMinutes/);
  assert.match(String(parseProjects({ projects: [base, base] })), /«app» is there twice/);
  assert.match(String(parseProjects([])), /no list «projects»/);
  assert.equal((parseProjects({ projects: [base, { ...base, name: 'b', gitHost: { kind: 'github', repo: 'a/b', api: 'https://git.bank.ch/api/v3' } }] }) as Project[])[1].gitHost?.api, 'https://git.bank.ch/api/v3');
});

test('GitHub - the pull request of a branch created, or brought up to date; merged; an error without the token', async () => {
  const seen: { method: string; url: string; auth: string; body: string }[] = [];
  const open: unknown[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', auth: req.headers.authorization ?? '', body: Buffer.concat(chunks).toString('utf8') });
      const json = (status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      const pr = { html_url: 'https://github.com/democompany/company/pull/7', number: 7, merged: false };
      if (req.method === 'GET') return json(200, open);
      if (req.method === 'POST') return json(201, pr);
      if (req.method === 'PATCH') return json(200, pr);
      return json(405, { message: 'Pull Request is not mergeable' });
    });
  });
  await new Promise<void>((up) => server.listen(0, 'localhost', up));
  try {
    const host = gitHub({ repo: 'democompany/company', token: 'ghp_secret', api: `http://localhost:${(server.address() as AddressInfo).port}/` });
    const o = { head: BRANCH, base: 'develop', title: 'Orch Spec: filiale', body: 'text' };
    assert.deepEqual(await host.pullRequest(o), { url: 'https://github.com/democompany/company/pull/7', number: 7, merged: false });
    assert.deepEqual(seen.map((s) => `${s.method} ${s.url}`), [
      'GET /repos/democompany/company/pulls?state=open&head=democompany%3Aorch-spec%2Fapp%2Ffiliale&base=develop',
      'POST /repos/democompany/company/pulls',
    ]);
    assert.deepEqual(JSON.parse(seen[1].body), o);
    assert.ok(seen.every((s) => s.auth === 'Bearer ghp_secret'));
    open.push({ number: 7 });
    await host.pullRequest({ ...o, body: 'more' });
    assert.deepEqual([seen[3].method, seen[3].url, JSON.parse(seen[3].body)], ['PATCH', '/repos/democompany/company/pulls/7', { title: 'Orch Spec: filiale', body: 'more' }]);
    await assert.rejects(host.merge(7), (e: Error) => e.message === 'GitHub PUT /pulls/7/merge: 405 Pull Request is not mergeable' && !e.message.includes('ghp_'));
  } finally {
    await new Promise<void>((down) => server.close(() => down()));
  }
});

test('the command line - the projects from a file, the status as JSON, exit 2 for a run that waits', async () => {
  const f = fixture();
  try {
    const file = join(f.root, 'projects.json');
    writeFileSync(file, JSON.stringify({ projects: [f.project] }));
    const env = { STUDIO_PROJECTS: file };
    assert.deepEqual(await main(['status', '--project', 'app'], env, f.deps), { text: 'Noch kein Lauf.', code: 0 });
    assert.match((await main(['status', '--project', 'x'], env, f.deps)).text, /no project «x» - there are: app/);
    assert.match((await main(['status', '--project', 'app'], {}, f.deps)).text, /^no projects: /);
    assert.match((await main(['test', '--project', 'app'], env, f.deps)).text, /^test needs --spec/);
    assert.match((await main(['test', '--project', 'app', '--spec', f.root, '--author', 'Rita'], env, f.deps)).text, /--author is not "Name <mail>"/);
    assert.equal((await main(['nothing', '--project', 'app'], env, f.deps)).code, 1);
    assert.equal((await main(['status', '--wrong'], env, f.deps)).code, 1);

    const waiting = await main(['test', '--project', 'app', '--spec', f.spec('broken', '{"broken":true}\n'), '--work', 'filiale', '--author', 'Rita RE <re@democompany.ch>'], env, f.deps);
    assert.equal(waiting.code, 2);
    assert.match(waiting.text, /^Lauf 20261118-0900 von app, Arbeit «filiale» \(orch-spec\/app\/filiale\): waiting\n {2}1\/8 Projekt: ok \(/);
    assert.match(waiting.text, /Kompilieren und testen: Ein Test ist fehlgeschlagen\.\n {2}Nach der Korrektur/);
    assert.equal((JSON.parse((await main(['status', '--project', 'app'], env, f.deps)).text) as RunStatus).state, 'waiting');
    f.fix({ 'projects/app/src/Fix.scala': 'object Fix\n' });
    const done = await main(['continue', '--project', 'app'], env, f.deps);
    assert.equal(done.code, 0);
    assert.match(done.text, /Version: 0\.1\.0-20261118-0900\n {2}Test-Umgebung: http/);
    assert.deepEqual(await main(['hand-over', '--project', 'app'], env, f.deps), { text: 'Pull Request: https://github.com/democompany/company/pull/14', code: 0 });
    assert.equal((await main(['cancel', '--project', 'app'], env, f.deps)).code, 1);
    assert.deepEqual(personOf(' Rita RE  <re@democompany.ch> '), RE);
    assert.equal(personOf('re@democompany.ch'), undefined);
    assert.match(describe({ ...(readJson<RunStatus>(f.p.status) as RunStatus), pullRequest: { url: 'u', number: 1, merged: true } }), /Pull Request: u \(gemergt\)/);
  } finally {
    f.done();
  }
});
