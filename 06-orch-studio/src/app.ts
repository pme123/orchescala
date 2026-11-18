// The routes of the studio:
//   - `/site/…`  orch-doc with the company's documentation, orch-spec under `/site/spec/`, orch-ops under
//                `/site/ops/` - as the gateway of Orchescala; HEAD as GET without the body (orch-spec and
//                orch-ops ask so whether the documentation app is there, for their link back)
//   - `/`, `/spec`, `/ops`  short ways there
//   - `/ai/…`    the AI of orch-spec (ai.ts)
// Without login for now (PoC, the studio listens on localhost); later Entra.
import { Hono } from 'hono';
import { aiRoutes } from './ai.ts';
import type { AiConfig } from './config.ts';
import type { Log } from './log.ts';
import { cacheControl, contentType, type Site } from './site.ts';
import type { Skill } from './skills.ts';

export type StudioParts = { site: Site; ai?: AiConfig; skills: Skill[]; log: Log; aiTimeoutMs?: number };

export function studioApp({ site, ai, skills, log, aiTimeoutMs }: StudioParts): Hono {
  const app = new Hono();
  const found = (location: string) => new Response(null, { status: 302, headers: { location } });

  app.get('/', () => found('/site/'));
  app.get('/spec', () => found('/site/spec/'));
  app.get('/ops', () => found('/site/ops/'));

  const serve = (url: string) => {
    const rest = new URL(url).pathname.slice('/site'.length);
    try {
      const r = site.resolve(rest);
      if (r.kind === 'redirect') return found(r.location);
      if (r.kind === 'notFound') return new Response(null, { status: 404 });
      return new Response(new Uint8Array(r.bytes), { headers: { 'content-type': contentType(r.rel), 'cache-control': cacheControl(r.rel) } });
    } catch (e) {
      log.warn(`/site${rest} failed: ${e instanceof Error ? e.message : String(e)}`);
      return new Response(null, { status: 500 });
    }
  };
  // Hono answers HEAD with the GET route, without the body
  app.get('/site', (c) => serve(c.req.url));
  app.get('/site/*', (c) => serve(c.req.url));

  aiRoutes(app, ai, skills, log, aiTimeoutMs);
  return app;
}
