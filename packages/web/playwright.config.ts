import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const root = fileURLToPath(new URL('../..', import.meta.url));

const dir = '/tmp/specage-e2e';
mkdirSync(dir, { recursive: true });
if (!existsSync(`${dir}/k`)) execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', `${dir}/k`]);
const pub = readFileSync(`${dir}/k.pub`, 'utf8').trim();

// Render the tbgwaf fixture with its sample state into the folder the static server serves.
// (Config is re-evaluated in workers; only render in the main process.)
if (!process.env.TEST_WORKER_INDEX) {
  rmSync(`${dir}/site`, { recursive: true, force: true });
  execFileSync('node', [
    'packages/cli/dist/bin.js', 'render', '--spec', 'fixtures/tbgwaf/tbgwaf.specage', '--state', 'fixtures/tbgwaf/state',
    '--out', `${dir}/site`, '--repo', 'TheDeepestSpace/tbgwaf', '--edit-url', 'https://specage.fly.dev',
  ], { cwd: root, stdio: 'inherit' });
}

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  timeout: 30_000,
  use: { baseURL: 'http://localhost:8788', trace: 'retain-on-failure' },
  webServer: [
    {
      command: 'node scripts/serve-static.mjs /tmp/specage-e2e/site 4173',
      cwd: root,
      url: 'http://127.0.0.1:4173/index.html',
      reuseExistingServer: false,
    },
    {
      command: 'node packages/server/dist/e2e-server.js',
      cwd: root,
      url: 'http://127.0.0.1:8788/healthz',
      reuseExistingServer: false,
      env: { NODE_ENV: 'development', PORT: '8788', PUBLIC_URL: 'http://localhost:8788', OWNER_PUBKEY: pub, WEB_DIST: `${root}/packages/web/dist` },
    },
  ],
});
