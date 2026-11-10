import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { flatten, parse } from '@specage/core';

export const SPEC = readFileSync(
  fileURLToPath(new URL('../../../fixtures/tbgwaf/tbgwaf.specage', import.meta.url)),
  'utf8',
);

const hashOf = (id: string) => flatten(parse(SPEC)).find((n) => n.id === id)!.hash;

export const STATE = {
  trace: {
    retired_ids: [],
    consumed_lineage: [],
    nodes: {
      'shoot.burst': {
        spec_hash: '000000000000',
        status: 'implemented',
        evidence: [],
      },
      'shoot.burst.cap': {
        spec_hash: hashOf('shoot.burst.cap'),
        status: 'implemented',
        evidence: [],
        verified: {
          by: 'owner',
          at: '2026-10-30T14:02Z',
          hash: hashOf('shoot.burst.cap'),
        },
      },
    },
  },
  work: {
    items: [
      {
        id: 'w-burst-cap',
        issue: 12,
        pr: 34,
        state: 'in_review',
        relations: [],
        claims: { 'shoot.burst.cap': { hash: hashOf('shoot.burst.cap'), status: 'pending' } },
      },
    ],
  },
  questions: [],
  report: null,
};

export const THREADS = [
  {
    id: 't-0001',
    node: 'shoot.burst.cap',
    node_hash: hashOf('shoot.burst.cap'),
    state: 'open',
    comments: [
      { id: 't-0001.1', author: 'owner', at: '2026-10-30T14:02:00Z', body: 'Is 3 the right cap?' },
      {
        id: 't-0001.2',
        author: 'the-intern',
        at: '2026-10-30T14:05:00Z',
        body: 'Matches GameLogic.h.',
      },
    ],
  },
  {
    id: 't-0002',
    node: 'shoot.burst.cap',
    node_hash: hashOf('shoot.burst.cap'),
    state: 'resolved',
    resolved_by: 'owner',
    resolved_at: '2026-10-30T15:00:00Z',
    comments: [
      { id: 't-0002.1', author: 'owner', at: '2026-10-30T14:30:00Z', body: 'Typo in text.' },
    ],
  },
];

export interface MockOpts {
  threads?: unknown[];
  repos?: string[];
  spec?: string;
  setup?: { auto_merge: string; gate: string; fix: string[]; ready: boolean };
  initRepos?: { repo: string; private: boolean; initialised: boolean }[];
}

/** Mock every /api and /auth call so the built SPA runs without Fly, GitHub or a passkey. */
export async function mockApi(page: Page, o: MockOpts = {}) {
  const json = (body: unknown, status = 200) => ({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
  const repos = o.repos ?? ['acme/tbgwaf', 'acme/other'];
  await page.route('**/data.json', (r) => r.fulfill({ status: 404, body: 'no' }));
  await page.route('**/api/**', (r) => {
    const u = new URL(r.request().url()).pathname;
    if (u === '/api/me') return r.fulfill(json({ label: 'owner', expires: 9e12, csrf: 'csrf' }));
    if (u === '/api/repos') return r.fulfill(json(repos));
    if (u === '/api/init/repos')
      return r.fulfill(
        json(o.initRepos ?? [{ repo: 'acme/new', private: false, initialised: false }]),
      );
    if (/\/api\/r\/[^/]+\/[^/]+\/setup$/.test(u))
      return r.fulfill(json(o.setup ?? { auto_merge: 'ok', gate: 'ok', fix: [], ready: true }));
    if (/\/api\/r\/[^/]+\/[^/]+\/spec$/.test(u)) {
      if (r.request().method() === 'PUT') return r.fulfill(json({ head_sha: 'b'.repeat(40) }));
      return r.fulfill(
        json({ content: o.spec ?? SPEC, head_sha: 'a'.repeat(40), path: 'tbgwaf.specage' }),
      );
    }
    if (/\/api\/r\/[^/]+\/[^/]+\/state$/.test(u))
      return r.fulfill(json({ ...STATE, threads: o.threads ?? [] }));
    if (/\/api\/r\/[^/]+\/[^/]+\/comments$/.test(u)) {
      const op = r.request().postDataJSON();
      const ts = JSON.parse(JSON.stringify(o.threads ?? [])) as any[];
      const t = ts.find((x) => x.id === op.thread);
      if (op.op === 'resolve') t.state = 'resolved';
      if (op.op === 'reopen') t.state = 'open';
      if (op.op === 'reply')
        t.comments.push({ id: 'x', author: 'owner', at: '2026-10-31T00:00:00Z', body: op.body });
      if (op.op === 'create')
        ts.push({
          id: 't-9',
          node: op.node,
          node_hash: 'a'.repeat(12),
          state: 'open',
          comments: [{ id: 't-9.1', author: 'owner', at: '2026-10-31T00:00:00Z', body: op.body }],
        });
      o.threads = ts;
      return r.fulfill(json({ threads: ts }));
    }
    return r.fulfill(json({ error: 'not mocked' }, 404));
  });
}
