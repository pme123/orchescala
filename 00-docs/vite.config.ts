import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import {defineConfig} from 'vite';

// The Orchescala version (root `version` file) - replaces `@VERSION@` in the markdown.
const version = fs.readFileSync(path.resolve(__dirname, '../version'), 'utf-8').trim();

// The content folder: its files (images, example APIs …) are served unchanged under their path,
// e.g. /orchescala/images/design.png - so relative references between them keep working.
const contentDir = path.resolve(__dirname, 'src/docs');
const contentFiles = (fs.readdirSync(contentDir, {recursive: true}) as string[])
  .map(f => f.split(path.sep).join('/'))
  .filter(f => !f.endsWith('.md') && fs.statSync(path.join(contentDir, f)).isFile());

export default defineConfig({
  // served by GitHub Pages under https://pme123.github.io/orchescala/
  base: process.env.DOCS_BASE ?? '/orchescala/',
  plugins: [react(), tailwindcss()],
  // the bundle holds all pages (markdown) and the markdown renderer
  build: {chunkSizeWarningLimit: 1200},
  publicDir: contentDir,
  define: {
    __ORCH_VERSION__: JSON.stringify(version),
    __CONTENT_FILES__: JSON.stringify(contentFiles),
  },
});
