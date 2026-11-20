import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const root = fileURLToPath(new URL('../../..', import.meta.url));
// Local runs against a different Chromium build can set this; CI uses the pinned Playwright image.
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}-{projectName}{ext}',
  workers: 1, // one real backend whose scenario state is per test
  timeout: 30_000,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  expect: { toHaveScreenshot: { maxDiffPixels: 50, animations: 'disabled' } },
  use: {
    baseURL: 'http://127.0.0.1:4174',
    colorScheme: 'light',
    launchOptions: { executablePath },
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
    {
      name: 'mobile',
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
  webServer: {
    // the real @specage/server serving the built SPA (npm run build first); GitHub is its in-memory stub
    command: 'node packages/server/dist/visual-server.js',
    cwd: root,
    url: 'http://127.0.0.1:4174/healthz',
    reuseExistingServer: false,
    env: {
      NODE_ENV: 'development',
      PORT: '4174',
      PUBLIC_URL: 'http://127.0.0.1:4174',
      OWNER_PUBKEY: 'ssh-ed25519 AAAA unused',
      WEB_DIST: `${root}/packages/web/dist`,
    },
  },
});
