import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The standalone API page as ONE self-contained html (JS, CSS, fonts and the favicon inlined):
// `npm run build:single` -> dist-single/api.html. Orchescala's company `update` copies it into
// the company helper as resource `OrchDocApi.html`; every project's `update` then writes it as
// `03-api/OpenApi.html` and `03-api/PostmanOpenApi.html` (the page derives the yml from its own
// file name) - replacing the Redoc shells, no assets folder to ship or upload.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), viteSingleFile()],
  // nothing from public/ - the favicon is imported (inlined), the rest is not needed here
  publicDir: false,
  build: {
    outDir: 'dist-single',
    emptyOutDir: true,
    // everything inline - fonts (bpmn / dmn icon fonts), images, the favicon
    assetsInlineLimit: 100 * 1024 * 1024,
    cssCodeSplit: false,
    rollupOptions: {
      input: path.resolve(__dirname, 'api.html'),
    },
  },
});
