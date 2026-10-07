import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';

// The pages of an app at runtime (E15): one renderer for all projects - the bundle is always the
// same, the pages come at runtime from pages.json, built from the folder `pages/` of a project's
// spec (the same JSON the designer of orch-spec edits). The bundle goes into the classpath of the
// worker app (`src/main/resources/ui`); the gateway serves it at /app/{project}/.
//
//   UI_BASE    the path the browser sees the app at (gateway: /app/{project}/)
//   UI_PAGES   the folder with app.json and one file per page (spec/pages of the project)
//   UI_CONFIG  config.json of the environment (identity provider) - optional
//   UI_OUT     where the bundle goes - e.g. 03-worker/src/main/resources/ui of the project
//   GATEWAY    the gateway for the dev server (npm run dev:pages)
const base = process.env.UI_BASE ?? '/app/';
const pagesDir = process.env.UI_PAGES ? path.resolve(process.env.UI_PAGES) : path.resolve(__dirname, 'sample-data/pages');
const configFile = process.env.UI_CONFIG ? path.resolve(process.env.UI_CONFIG) : undefined;
const gateway = process.env.GATEWAY ?? 'http://localhost:8889';

/** app.json and every other *.json of the folder (one page per file) as one document. */
function bundlePages(dir: string): string {
  if (!fs.existsSync(dir)) throw new Error(`UI_PAGES: ${dir} does not exist`);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  const read = (f: string) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
    } catch (e) {
      throw new Error(`UI_PAGES: ${path.join(dir, f)} is no valid JSON - ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const app = files.includes('app.json') ? read('app.json') : {};
  const pages = files.filter((f) => f !== 'app.json').map(read);
  return JSON.stringify({ app, pages }, null, 2);
}

function pagesPlugin(): Plugin {
  return {
    name: 'orch-pages',
    configureServer(server) {
      // in the dev server new on every load - a change of a page shows at once
      server.middlewares.use((req, res, next) => {
        const p = req.url?.split('?')[0];
        if (p === `${base}pages.json`) {
          res.setHeader('Content-Type', 'application/json');
          res.end(bundlePages(pagesDir));
        } else if (p === `${base}config.json` && configFile) {
          res.setHeader('Content-Type', 'application/json');
          res.end(fs.readFileSync(configFile, 'utf-8'));
        } else next();
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'pages.json', source: bundlePages(pagesDir) });
      if (configFile) this.emitFile({ type: 'asset', fileName: 'config.json', source: fs.readFileSync(configFile, 'utf-8') });
    },
  };
}

export default defineConfig({
  root: path.resolve(__dirname, 'src/pages/runtime'),
  base,
  plugins: [react(), tailwindcss(), pagesPlugin()],
  build: {
    outDir: path.resolve(process.env.UI_OUT ?? path.resolve(__dirname, 'dist-pages')),
    emptyOutDir: true,
  },
  server: {
    // in the dev server the API calls go to the gateway
    proxy: Object.fromEntries(['/public', '/worker', '/process', '/message', '/userTask'].map((p) => [p, gateway])),
  },
});
