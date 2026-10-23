import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';

// Dev server only: serve `sample-data/` under /sample-data so that the app
// starts right away with data via `?demo` (without picking a folder).
// Directories answer with their file list as JSON.
function sampleData(): Plugin {
  const root = path.resolve(__dirname, 'sample-data');
  return {
    name: 'orch-ops:sample-data',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/sample-data', (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '/').split('?')[0]);
        const file = path.join(root, rel);
        if (!file.startsWith(root)) return next();
        let st: fs.Stats;
        try { st = fs.statSync(file); } catch { return next(); }
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        if (st.isDirectory()) return res.end(JSON.stringify(fs.readdirSync(file)));
        res.end(fs.readFileSync(file));
      });
    },
  };
}

export default defineConfig({
  base: '/orch-ops/',
  plugins: [react(), tailwindcss(), sampleData()],
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
  server: {
    // sample-data can be picked as the shared folder — the app's writes must
    // not trigger a dev server reload
    watch: { ignored: ['**/sample-data/**'] },
  },
  build: {
    rollupOptions: {
      output: { manualChunks: { msal: ['@azure/msal-browser'] } },
    },
  },
});
