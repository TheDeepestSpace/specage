// Real server + in-memory GitHub, for Playwright e2e and local UI work. Refuses to run in production.
import { serve } from '@hono/node-server';
import { parse, flatten } from '@specage/core';
import { createApp } from './app.js';
import { openDb } from './db.js';
import { loadEnv } from './env.js';
import { FakeGitHub } from './fake-github.js';

if (process.env.NODE_ENV !== 'development')
  throw new Error('e2e-server requires NODE_ENV=development');
const env = loadEnv();
const gh = new FakeGitHub();
gh.files['spec-state:trace.yaml'] = `retired_ids: [old.id]
nodes:
  shoot.burst:
    spec_hash: 000000000000
    status: implemented
    evidence:
      - {kind: code, ref: src/Weapon.h#L1-L9, commit: 9ff2e3a0000000000000000000000000000000aa, tier: located}
`;
const cap = flatten(parse(gh.head().spec)).find((n) => n.id === 'shoot.cap')!.hash;
gh.files['spec-state:trace.yaml'] += `  shoot.cap:
    spec_hash: ${cap}
    status: implemented
    verified: {by: owner, at: 2026-10-30T14:02Z, hash: ${cap}}
`;
const db = openDb(':memory:');
serve({ fetch: createApp({ env, db, github: gh }).fetch, port: env.port, hostname: '127.0.0.1' });
console.log(`e2e server on ${env.publicUrl}`);
