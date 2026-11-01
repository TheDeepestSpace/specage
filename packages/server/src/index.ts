import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { openDb } from './db.js';
import { loadEnv } from './env.js';
import { RealGitHub } from './github.js';

export { createApp } from './app.js';

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = loadEnv();
  const db = openDb(env.dbPath);
  const github = new RealGitHub({
    dataRepo: env.dataRepo,
    appId: env.appId,
    privateKey: env.appPrivateKey,
    devToken: env.devGithubToken,
  });
  serve({ fetch: createApp({ env, db, github }).fetch, port: env.port, hostname: '0.0.0.0' });
  console.log(`specage server listening on :${env.port} (${env.publicUrl})`);
}
