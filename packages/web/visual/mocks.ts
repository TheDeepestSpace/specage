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
  invocations: [
    {
      id: 'inv-1',
      kind: 'worker',
      status: 'in_progress',
      nodes: ['shoot.burst.cap'],
      run_url: 'https://github.com/acme/tbgwaf/actions/runs/1',
    },
    { id: 'inv-2', kind: 'reviewer', status: 'success', nodes: ['shoot.burst.cap'] },
  ],
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

export interface BackendOpts {
  threads?: unknown[];
  /** evidence attached to shoot.burst.cap */
  evidence?: unknown[];
  repos?: string[];
  spec?: string;
  setup?: { auto_merge: string; gate: string };
  initRepos?: { repo: string; private: boolean }[];
}

/**
 * Seed the real @specage/server (visual-server.ts, in-memory GitHub) with a scenario and sign this
 * page's browser context in. All API traffic then goes to the real backend.
 */
export async function useBackend(page: Page, o: BackendOpts = {}) {
  const st = JSON.parse(JSON.stringify(STATE));
  if (o.evidence) st.trace.nodes['shoot.burst.cap'].evidence = o.evidence;
  const repoFiles: Record<string, string> = {};
  for (const e of (o.evidence ?? []) as { kind: string; ref: string; commit: string }[]) {
    const path = e.ref.split('#')[0];
    if (path.includes('missing')) continue;
    repoFiles[`acme/tbgwaf:${e.commit}:${path}`] = Array.from(
      { length: 30 },
      (_, i) => `// ${path} line ${i + 1}`,
    ).join('\n');
  }
  const r = await page.request.post('/__visual/scenario', {
    data: {
      spec: o.spec ?? SPEC,
      trail: {
        'trace.yaml': st.trace,
        'work.yaml': st.work,
        'invocations.yaml': { items: st.invocations },
      },
      threads: o.threads,
      repos: o.repos,
      setup: o.setup,
      initRepos: o.initRepos,
      repoFiles,
    },
  });
  if (!r.ok()) throw new Error(`scenario failed: ${r.status()}`);
}
