// The runs of the studio over REST - what the buttons of orch-spec call (E25, step 6.2):
//
//   GET  /platform/config                 `{"enabled": true, "projects": [{"name", "testUrl", "handOver"}]}` or
//                                         `{"enabled": false}` - orch-spec shows its buttons only for a project here
//   GET  /platform/<project>/status       `{"status": <the last run> | null, "work": <the open work> | null}`
//   POST /platform/<project>/preview      `{"files": [{"path", "text" | "base64"}]}` - the spec of orch-spec; answers
//                                         with the plan of the merge and the spec on the branch (P12)
//   POST /platform/<project>/test         `{"previewId", "work"?, "summary"?, "author"?: {"name", "email"}}` -
//                                         «Auf Testumgebung» with the spec of that preview; 202, the run goes on
//   POST /platform/<project>/continue     a run that waits goes on; 202
//   POST /platform/<project>/cancel       a run that waits is given up
//   POST /platform/<project>/hand-over    «Übergeben»: the pull request
//
// What is refused answers `{"error": "<text for the RE>"}`: 404 no such project (or the runs are off), 400 a
// body that does not fit, 409 not now (a run is open, nothing waits, the preview is gone), 413 too large.
// Without login for now (PoC, the studio listens on localhost); later the role `spec.edit`.
import type { Hono } from 'hono';
import { readBody } from '../ai.ts';
import type { Log } from '../log.ts';
import type { Project } from './project.ts';
import type { Platform } from './setup.ts';
import { alive, pathsOf, readJson, type RunStatus, type Work } from './status.ts';
import { cancelRun, continueRun, handOver, previewTest, runStatus, specDirOf, startTest, type Deps, type Person, type SpecFile } from './testRun.ts';

/** A spec with its diagrams and pages - a few MB at most. */
export const MAX_SPEC = 32 * 1024 * 1024;

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const refused = (status: number, error: string) => json(status, { error });

export function platformRoutes(app: Hono, platform: Platform | undefined, log: Log) {
  /** the projects at work: with a preview, or with a run this studio started */
  const busy = new Map<string, 'preview' | 'run'>();
  const deps: Deps | undefined = platform && {
    ...platform.deps,
    // a run of this studio that it does not know (any more) was interrupted; another process: does it live
    running: (s: RunStatus) => (s.pid === process.pid ? busy.get(s.project) === 'run' : alive(s.pid)),
  };
  const config = JSON.stringify(platform
    ? { enabled: true, projects: platform.projects.map((p) => ({ name: p.name, ...(p.testUrl ? { testUrl: p.testUrl } : {}), handOver: !!p.gitHost })) }
    : { enabled: false });

  app.get('/platform/config', () => new Response(config, { headers: { 'content-type': 'application/json' } }));

  /** The project of the route - or the answer that refuses. */
  const find = (name: string): { project: Project; d: Deps } | Response => {
    const project = platform?.projects.find((p) => p.name === name);
    return project && deps ? { project, d: deps } : refused(404, platform ? `Das Studio kennt kein Projekt «${name}».` : 'Die Läufe des Studios sind aus (STUDIO_PROJECTS).');
  };
  const body = async (req: Request): Promise<Json | Response> => {
    if (Number(req.headers.get('content-length') ?? 0) > MAX_SPEC) return refused(413, `Die Spez ist grösser als ${MAX_SPEC / 1024 / 1024} MB.`);
    const bytes = await readBody(req, MAX_SPEC).catch(() => null);
    if (bytes === null) return refused(400, 'Die Anfrage lässt sich nicht lesen.');
    if (bytes === undefined) return refused(413, `Die Spez ist grösser als ${MAX_SPEC / 1024 / 1024} MB.`);
    if (!bytes.length) return {};
    try {
      const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
      return isObject(value) ? value : refused(400, 'Die Anfrage ist kein JSON-Objekt.');
    } catch {
      return refused(400, 'Die Anfrage ist kein JSON.');
    }
  };
  const statusOf = (d: Deps, project: Project) => ({ status: runStatus(d, project) ?? null, work: readJson<Work>(pathsOf(d.workspace, project).work) ?? null });

  /** A run in the background: the answer is its status right after the start - or why it does not start. */
  const background = async (d: Deps, project: Project, start: () => Promise<RunStatus | string>): Promise<Response> => {
    if (busy.has(project.name)) return refused(409, `Das Projekt «${project.name}» ist gerade an der Arbeit (${busy.get(project.name) === 'run' ? 'ein Lauf' : 'eine Vorschau'}).`);
    // first its checks, then the mark: a run that says `running` and is not marked was interrupted - also
    // for the `continue` that takes it up again
    const begun = start();
    busy.set(project.name, 'run');
    const run = begun
      .catch((e: unknown) => {
        // a defect of the studio: the status stays `running` without a run - it shows as interrupted
        log.error(`${project.name} - the run failed in the studio: ${e instanceof Error ? e.message : String(e)}`);
        return undefined;
      })
      .finally(() => busy.delete(project.name));
    // what does not start is known at once - a run has written its status by then
    const first = await Promise.race([run, new Promise<'started'>((go) => setImmediate(() => go('started')))]);
    return typeof first === 'string' && first !== 'started' ? refused(409, first) : json(202, statusOf(d, project));
  };

  app.get('/platform/:project/status', (c) => {
    const found = find(c.req.param('project'));
    return found instanceof Response ? found : json(200, statusOf(found.d, found.project));
  });

  app.post('/platform/:project/preview', async (c) => {
    const found = find(c.req.param('project'));
    if (found instanceof Response) return found;
    const b = await body(c.req.raw);
    if (b instanceof Response) return b;
    if (!Array.isArray(b.files) || !b.files.every(isObject)) return refused(400, 'Die Anfrage hat keine Liste «files».');
    const { project, d } = found;
    if (busy.has(project.name)) return refused(409, `Das Projekt «${project.name}» ist gerade an der Arbeit.`);
    busy.set(project.name, 'preview');
    try {
      const preview = await previewTest(d, project, b.files as SpecFile[]);
      return typeof preview === 'string' ? refused(409, preview) : json(200, preview);
    } finally {
      busy.delete(project.name);
    }
  });

  app.post('/platform/:project/test', async (c) => {
    const found = find(c.req.param('project'));
    if (found instanceof Response) return found;
    const b = await body(c.req.raw);
    if (b instanceof Response) return b;
    const { project, d } = found;
    const specDir = specDirOf(d, project, text(b.previewId) ?? '');
    if (!specDir) return refused(409, 'Die Vorschau ist nicht mehr da – nochmals «Auf Testumgebung».');
    const author: Person | undefined = isObject(b.author) && text(b.author.name) && text(b.author.email)
      ? { name: text(b.author.name)!, email: text(b.author.email)! }
      : undefined;
    return background(d, project, () => startTest(d, project, { specDir, work: text(b.work), summary: text(b.summary), author }));
  });

  app.post('/platform/:project/continue', async (c) => {
    const found = find(c.req.param('project'));
    return found instanceof Response ? found : background(found.d, found.project, () => continueRun(found.d, found.project));
  });

  app.post('/platform/:project/cancel', (c) => {
    const found = find(c.req.param('project'));
    if (found instanceof Response) return found;
    const cancelled = cancelRun(found.d, found.project);
    return typeof cancelled === 'string' ? refused(409, cancelled) : json(200, statusOf(found.d, found.project));
  });

  app.post('/platform/:project/hand-over', async (c) => {
    const found = find(c.req.param('project'));
    if (found instanceof Response) return found;
    const pr = await handOver(found.d, found.project);
    return typeof pr === 'string' ? refused(409, pr) : json(200, statusOf(found.d, found.project));
  });
}
