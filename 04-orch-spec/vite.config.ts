import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { defineConfig, loadEnv, type Plugin } from 'vite';

// Nur im Dev-Server: `sample-data/` unter /sample-data ausliefern, damit die
// App mit `?demo` sofort mit echten Daten startet (ohne Ordnerauswahl).
// Verzeichnisse antworten mit der Dateiliste als JSON.
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

// Nur im Dev-Server: der mitgelieferte Katalog. Im Build legt ihn der Helper
// neben die App (`spec/catalog.generated.json` der Doku-Site); im Dev-Server
// fehlt er — ohne ihn fehlen alle Service- und Firmentypen. Er kommt aus
// `public/` oder aus `ORCH_SPEC_CATALOG` (Datei oder Site-Ordner, z. B. in
// `.env.local`). Fehlt er, antwortet der Server 404 statt mit der index.html.
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
        res.end(fs.readFileSync(file)); // bei jedem Abruf frisch — ein neues publishDocs gilt nach einem Reload
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
    // sample-data kann als geteilter Ordner gewählt werden — Schreibzugriffe
    // der App dürfen keinen Dev-Server-Reload auslösen
    watch: { ignored: ['**/sample-data/**'] },
  },
  build: {
    // Der Modeler (bpmn-js) ist gross, wird aber nur geladen, wenn jemand das
    // Diagramm aufklappt — die Warnung dazu ist hier kein Signal.
    chunkSizeWarningLimit: 700,
    // Die Bibliotheken bekommen eigene Chunks: sie ändern sich nur mit einem
    // Update und bleiben so über Releases der App im Browser-Cache.
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
          // der DMN-Editor (dmn-js) — erst geladen, wenn eine Tabelle aufgeht;
          // aufgeteilt nach Ansicht, sonst wäre er ein Chunk über der Grenze
          if (pkg === 'dmn-js-decision-table' || pkg === 'table-js') return 'dmn-table';
          if (pkg === 'dmn-js-drd') return 'dmn-drd';
          if (pkg.startsWith('dmn-js') || pkg === 'dmn-moddle' || pkg === 'camunda-dmn-moddle' || pkg.startsWith('inferno')) return 'dmn';
          // die Zeichenfläche — gemeinsam für BPMN- und DMN-Editor
          if (pkg === 'diagram-js' || pkg === 'diagram-js-direct-editing') return 'diagram';
          return undefined;
        },
      },
    },
  },
}));
