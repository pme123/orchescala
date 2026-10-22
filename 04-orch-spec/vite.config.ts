import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { defineConfig, loadEnv, type Plugin } from 'vite';

// Dev server only: serve `sample-data/` under /sample-data, so that the
// app starts right away with real data via `?demo` (without choosing a folder).
// Directories respond with the file list as JSON.
function sampleData(): Plugin {
  const root = path.resolve(__dirname, 'sample-data');
  return {
    name: 'orch-spec:sample-data',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/sample-data', (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '/').split('?')[0]);
        const file = path.join(root, rel);
        if (!file.startsWith(root)) return next();
        let st: fs.Stats;
        try { st = fs.statSync(file); } catch { return next(); }
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        if (st.isDirectory()) return res.end(JSON.stringify(fs.readdirSync(file)));
        res.end(fs.readFileSync(file));
      });
    },
  };
}

// Dev server only: the bundled catalog. In the build the helper puts it
// next to the app (`spec/catalog.generated.json` of the docs site); in the dev server
// it is missing — without it all service and company types are missing. It comes from
// `public/` or from `ORCH_SPEC_CATALOG` (file or site folder, e.g. in
// `.env.local`). If it is missing, the server responds 404 instead of with the index.html.
function devCatalog(catalogEnv: string | undefined): Plugin {
  const inPublic = path.resolve(__dirname, 'public', 'catalog.generated.json');
  const fromEnv = (): string | null => {
    if (!catalogEnv) return null;
    const p = path.resolve(__dirname, catalogEnv.replace(/^~(?=$|\/)/, process.env.HOME ?? '~'));
    if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) return p;
    return [path.join(p, 'spec', 'catalog.generated.json'), path.join(p, 'catalog.generated.json')]
      .find(f => fs.existsSync(f)) ?? path.join(p, 'spec', 'catalog.generated.json');
  };
  return {
    name: 'orch-spec:dev-catalog',
    apply: 'serve',
    configureServer(server) {
      const log = server.config.logger;
      const file = fs.existsSync(inPublic) ? inPublic : fromEnv();
      if (!file) log.warn('  Kein Katalog: public/catalog.generated.json fehlt und ORCH_SPEC_CATALOG ist nicht gesetzt.');
      else if (!fs.existsSync(file)) log.warn(`  Kein Katalog: ${file} fehlt (ORCH_SPEC_CATALOG).`);
      else log.info(`  Katalog: ${file}`);
      server.middlewares.use(`${server.config.base}catalog.generated.json`, (_req, res, next) => {
        if (file === inPublic) return next();
        if (!file || !fs.existsSync(file)) { res.statusCode = 404; return res.end(); }
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(fs.readFileSync(file)); // fresh on every request — a new publishDocs applies after a reload
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  base: '/orch-spec/',
  plugins: [react(), tailwindcss(), sampleData(), devCatalog(loadEnv(mode, __dirname, '').ORCH_SPEC_CATALOG)],
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
  server: {
    // sample-data can be chosen as a shared folder — the app's write accesses
    // must not trigger a dev server reload
    watch: { ignored: ['**/sample-data/**'] },
  },
  build: {
    // The modeler (bpmn-js) is large, but is only loaded when someone expands the
    // diagram — the warning about it is no signal here. The main chunk
    // was already just under 700 kB; the pages (designer, renderer) are a separate
    // chunk, only their storage in the store stays in the main chunk.
    chunkSizeWarningLimit: 720,
    // The libraries get their own chunks: they only change with an
    // update and thus stay in the browser cache across releases of the app.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules/')) return undefined;
          const pkg = id.split('node_modules/').pop()!.split('/')[0];
          if (pkg === '@azure') return 'msal';
          if (['react', 'react-dom', 'scheduler'].includes(pkg)) return 'react';
          if (pkg === 'feelin' || pkg.startsWith('@lezer') || pkg === 'lezer-feel') return 'feel';
          if (pkg === 'lucide-react') return 'icons';
          if (['marked', 'js-yaml', 'fflate'].includes(pkg)) return 'text';
          // the DMN editor (dmn-js) only comes when a table opens — as one
          // chunk it would be over the limit. Only the table view gets its
          // own; Rollup splits the rest itself. More fixed assignments
          // (DRD, shared parts) make the chunks depend on each other in a cycle.
          if (pkg === 'dmn-js-decision-table') return 'dmn-table';
          return undefined;
        },
      },
    },
  },
}));
