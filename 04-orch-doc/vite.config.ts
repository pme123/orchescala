import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';

// Dev-Server only: serve `sample-data/site/` at the app root, so the app starts
// with real data (generated from a 00-docs folder via `npm run sample`).
function sampleData(): Plugin {
  const root = path.resolve(__dirname, 'sample-data/site');
  const types: Record<string, string> = {
    '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
    '.png': 'image/png', '.svg': 'image/svg+xml', '.html': 'text/html; charset=utf-8',
  };
  return {
    name: 'orch-doc:sample-data',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '/').split('?')[0]);
        const file = path.join(root, rel);
        if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return next();
        res.setHeader('Content-Type', types[path.extname(file)] ?? 'application/octet-stream');
        res.end(fs.readFileSync(file));
      });
    },
  };
}

export default defineConfig({
  // Relative base: the build works at any location (e.g. https://host/site/)
  base: './',
  plugins: [react(), tailwindcss(), sampleData()],
  server: { port: Number(process.env.PORT) || 3003, watch: { ignored: ['**/sample-data/**'] } },
  build: {
    rollupOptions: {
      input: {
        // the full documentation app …
        main: path.resolve(__dirname, 'index.html'),
        // … and the standalone API page a single project deploys as its OpenApi.html
        api: path.resolve(__dirname, 'api.html'),
      },
    },
  },
});
