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
  work: { items: [] },
  questions: [],
  report: null,
};

export interface MockOpts {
  repos?: string[];
  spec?: string;
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
    if (/\/api\/r\/[^/]+\/[^/]+\/spec$/.test(u)) {
      if (r.request().method() === 'PUT') return r.fulfill(json({ head_sha: 'b'.repeat(40) }));
      return r.fulfill(
        json({ content: o.spec ?? SPEC, head_sha: 'a'.repeat(40), path: 'tbgwaf.specage' }),
      );
    }
    if (/\/api\/r\/[^/]+\/[^/]+\/state$/.test(u)) return r.fulfill(json(STATE));
    return r.fulfill(json({ error: 'not mocked' }, 404));
  });
}
