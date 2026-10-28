import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {execSync} from 'node:child_process';
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

// When the site was built (= published - GitHub Actions builds on each deploy) and from which commit - for the footer.
const commit = (() => {
  try {
    return execSync('git rev-parse --short HEAD', {stdio: ['ignore', 'pipe', 'ignore']}).toString().trim();
  } catch {
    return '';
  }
})();

export default defineConfig({
  // served by GitHub Pages under https://pme123.github.io/orchescala/
  base: process.env.DOCS_BASE ?? '/orchescala/',
  plugins: [react(), tailwindcss()],
  // the bundle holds all pages (markdown) and the markdown renderer
  build: {chunkSizeWarningLimit: 1200},
  publicDir: contentDir,
  define: {
    __ORCH_VERSION__: JSON.stringify(version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __BUILD_COMMIT__: JSON.stringify(commit),
    __CONTENT_FILES__: JSON.stringify(contentFiles),
  },
});
