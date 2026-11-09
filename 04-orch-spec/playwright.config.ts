// orch-spec without a server (E28): the built app - as orch-doc ships it (`--base=./`) - served
// statically, without a studio. `npm run test:standalone` builds it to dist-standalone/ first.
import { defineConfig, devices } from '@playwright/test';

// not 4173, the default of `vite preview` - another app there would be taken for this one
const port = 4319;

export default defineConfig({
  testDir: 'e2e',
  // a failing test leaves its trace - on CI the only way to see what the page showed
  use: { baseURL: `http://localhost:${port}`, trace: 'retain-on-failure' },
  // the File System Access API (the local folder) is Chrome and Edge only
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  webServer: {
    // a static server and nothing else - no proxy, no /ai/, no /spec/
    command: `npx vite preview --outDir dist-standalone --base / --port ${port} --strictPort`,
    url: `http://localhost:${port}/`,
    reuseExistingServer: false,
  },
});
