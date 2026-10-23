import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';
import { conditionProblem } from './src/pages/runtime/expr';
import { appProblem, pageProblem } from './src/pages/runtime/validate';

// The pages of an app at runtime (E15): one renderer for all projects - the bundle is always
// the same, the pages come at runtime from pages.json, built from the folder `pages/` of the spec
// of a project (the same JSON the designer of orch-spec edits). The bundle goes into the
// classpath of the worker app (`src/main/resources/ui`); the gateway serves it under /app/{project}/.
//
//   UI_BASE    the path under which the browser sees the app (gateway: /app/{project}/)
//   UI_PAGES   the folder with app.json and one file per page (spec/pages of the project)
//   UI_CONFIG  config.json of the environment (identity provider) - optional
//   UI_OUT     where the bundle goes - e.g. 03-worker/src/main/resources/ui of the project
//   GATEWAY    the gateway for the dev server (npm run dev:pages)
const base = process.env.UI_BASE ?? '/app/';
const pagesDir = process.env.UI_PAGES ? path.resolve(process.env.UI_PAGES) : path.resolve(__dirname, 'sample-data/pages');
const configFile = process.env.UI_CONFIG ? path.resolve(process.env.UI_CONFIG) : undefined;
const gateway = process.env.GATEWAY ?? 'http://localhost:8889';
const outDir = path.resolve(process.env.UI_OUT ?? path.resolve(__dirname, 'dist-pages'));

/** app.json and every other *.json of the folder (one page per file) as one document. */
function bundlePages(dir: string, strict: boolean): string {
  if (!fs.existsSync(dir)) throw new Error(`UI_PAGES: ${dir} does not exist`);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  const read = (f: string) => {
    let data: unknown;
    try {
      data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
    } catch (e) {
      throw new Error(`UI_PAGES: ${path.join(dir, f)} is no valid JSON - ${e instanceof Error ? e.message : String(e)}`);
    }
    // the renderer relies on the shape - a page that does not fit aborts the build
    const problem = f === 'app.json' ? appProblem(data) : pageProblem(data);
    if (problem) throw new Error(`UI_PAGES: ${path.join(dir, f)} - ${problem}`);
    return data as { path: string; body: Array<Record<string, unknown>> };
  };
  const app = files.includes('app.json') ? read('app.json') : {};
  // what only the specification knows (project, epics, comments) does not go into the app
  const pages = files.filter((f) => f !== 'app.json').map(read).map(({ spec: _spec, ...page }: { spec?: unknown } & ReturnType<typeof read>) => page);
  // a condition that does not fit hides silently - a hand-written file needs checking too
  // in the build an abort, in the dev server a warning (the page is work in progress there)
  const problems = pages.flatMap((page) => conditionsOf(page.body).flatMap((cond) => {
    const problem = conditionProblem(cond);
    return problem ? [`pages: ${page.path} - sichtbar, wenn «${cond}»: ${problem}`] : [];
  }));
  if (strict && problems.length > 0) throw new Error(problems.join('\n'));
  for (const p of problems) console.warn(`  ${p}`);
  return JSON.stringify({ app, pages }, null, 2);
}

/** All conditions of the blocks (also in sections, fields, rows). */
function conditionsOf(body: Array<Record<string, unknown>>): string[] {
  return body.flatMap((b) => [
    ...(typeof b.visible === 'string' ? [b.visible] : []),
    ...(Array.isArray(b.fields) ? b.fields.map((f: { visible?: string }) => f.visible).filter((v): v is string => !!v) : []),
    ...(Array.isArray(b.items) ? b.items.map((i: { visible?: string }) => i.visible).filter((v): v is string => !!v) : []),
    ...(Array.isArray(b.body) ? conditionsOf(b.body) : []),
  ]);
}

function pagesPlugin(): Plugin {
  return {
    name: 'orch-pages',
    configureServer(server) {
      // in the dev server anew on every load - a change to a page shows immediately
      server.middlewares.use((req, res, next) => {
        const p = req.url?.split('?')[0];
        if (p === `${base}pages.json`) {
          res.setHeader('Content-Type', 'application/json');
          try {
            res.end(bundlePages(pagesDir, false));
          } catch (e) {
            // a broken page - the app shows the message, not a bare 500
            res.statusCode = 500;
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
          }
        } else if (p === `${base}config.json`) {
          // without UI_CONFIG a 404 - otherwise the SPA fallback would serve index.html with 200
          if (!configFile) {
            res.statusCode = 404;
            res.end();
            return;
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(fs.readFileSync(configFile, 'utf-8'));
        } else next();
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'pages.json', source: bundlePages(pagesDir, true) });
      if (configFile) this.emitFile({ type: 'asset', fileName: 'config.json', source: fs.readFileSync(configFile, 'utf-8') });
    },
  };
}

export default defineConfig({
  root: path.resolve(__dirname, 'src/pages/runtime'),
  base,
  // a cache of its own - otherwise `npm run dev:pages` overwrites the pre-bundled dependencies of
  // `npm run dev` (both in the same folder), and orch-spec stays white with «504 Outdated Optimize Dep»
  cacheDir: path.resolve(__dirname, 'node_modules/.vite-pages'),
  plugins: [react(), tailwindcss(), pagesPlugin()],
  build: {
    outDir,
    // only a dedicated folder is emptied (`…/ui`, `dist-pages`) - a wrong UI_OUT
    // (e.g. src/main/resources) would otherwise delete everything in it
    emptyOutDir: ['ui', 'dist-pages'].includes(path.basename(outDir)),
  },
  server: {
    // in the dev server the API calls go to the gateway
    proxy: Object.fromEntries(['/public', '/worker', '/process', '/message', '/userTask'].map((p) => [p, gateway])),
  },
});
