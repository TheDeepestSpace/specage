import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const root = fileURLToPath(new URL('../../..', import.meta.url));
// Local runs against a different Chromium build can set this; CI uses the pinned Playwright image.
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}-{projectName}{ext}',
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
    // serves the built SPA (npm run build first); every API call is mocked in the tests.
    command: 'node packages/web/visual/serve.mjs packages/web/dist 4174',
    cwd: root,
    url: 'http://127.0.0.1:4174/',
    reuseExistingServer: false,
  },
});
