// Real server + in-memory GitHub, for Playwright e2e and local UI work. Refuses to run in production.
import { serve } from '@hono/node-server';
import { parse, flatten, parseYaml } from '@specage/core';
import { stringify } from 'yaml';
import { createApp } from './app.js';
import { openDb } from './db.js';
import { loadEnv } from './env.js';
import { FakeGitHub } from './fake-github.js';

if (process.env.NODE_ENV !== 'development')
  throw new Error('e2e-server requires NODE_ENV=development');
const env = loadEnv();
const gh = new FakeGitHub();
gh.files['specages/r/trail:trace.yaml'] = `retired_ids: [old.id]
nodes:
  shoot.burst:
    spec_hash: 000000000000
    status: implemented
    evidence:
      - {kind: code, ref: src/Weapon.h#L1-L9, commit: 9ff2e3a0000000000000000000000000000000aa, tier: located}
`;
const cap = flatten(parse(gh.head().spec)).find((n) => n.id === 'shoot.cap')!.hash;
gh.files['specages/r/trail:trace.yaml'] += `  shoot.cap:
    spec_hash: ${cap}
    status: implemented
    verified: {by: owner, at: 2026-10-30T14:02Z, hash: ${cap}}
`;

// planner questions: one on a node (gates issue #7), one top-level (its node was removed; gates #8)
gh.files['specages/r/trail:questions.yaml'] = `- id: q-0001
  node: shoot.cap
  node_hash: ${cap}
  dispatch: dispatch/r/2026-10-30T02-11Z
  kind: reconcile
  text: "The magazine cap changed. Should issue #7 (Limit magazine) still be implemented?"
  state: open
  answer: null
  issue: 7
- id: q-0002
  node: ""
  dispatch: dispatch/r/2026-10-30T02-11Z
  kind: reconcile
  text: "Node shoot.reload was removed with no surviving ancestor. Withdraw issue #8?"
  options: ["yes: carry trace/claims, retire \`s-43c9243d\`", "no: keep it"]
  state: open
  answer: null
  issue: 8
`;
// stand-in planner: answers to a question get an agent follow-up, or a resolution once the human says "done"
const commitTrail = gh.commitTrail.bind(gh);
gh.commitTrail = async (p, o) => {
  if (o.path === 'questions.yaml') {
    const qs = parseYaml(o.content) as any[];
    for (const q of qs) {
      const last = q.thread?.at(-1);
      if (q.state !== 'open' || !last || last.author === 'planner') continue;
      const done = /done/i.test(last.body);
      q.thread.push({
        author: 'planner',
        at: new Date().toISOString(),
        body: done
          ? 'Thanks, recorded the decision on the issue.'
          : 'Noted. Anything else I should know?',
      });
      if (done) q.state = 'resolved';
    }
    o = { ...o, content: stringify(qs) };
  }
  return commitTrail(p, o);
};
const db = openDb(':memory:');
serve({ fetch: createApp({ env, db, github: gh }).fetch, port: env.port, hostname: '127.0.0.1' });
console.log(`e2e server on ${env.publicUrl}`);
