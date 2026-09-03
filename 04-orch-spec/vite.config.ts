import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';

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

export default defineConfig({
  base: '/orch-spec/',
  plugins: [react(), tailwindcss(), sampleData()],
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
    rollupOptions: {
      output: { manualChunks: { msal: ['@azure/msal-browser'] } },
    },
  },
});
