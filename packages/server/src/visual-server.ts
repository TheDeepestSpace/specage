// Real server for the visual Playwright run. Same app as production; only the outermost edges are
// stubbed: GitHub (in-memory, no `gh`/network) and the session (minted by /__visual/scenario instead
// of a passkey). Refuses to run outside development.
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import { stringifyComments } from '@specage/core';
import { stringify } from 'yaml';
import { createApp } from './app.js';
import { openDb } from './db.js';
import { loadEnv } from './env.js';
import {
  Conflict,
  NotFound,
  specBranch,
  trailBranch,
  type GitHub,
  type RepoInfo,
} from './github.js';
import { seal } from './seal.js';
import type { MergeFacts } from './setup.js';

if (process.env.NODE_ENV !== 'development')
  throw new Error('visual-server requires NODE_ENV=development');
const env = loadEnv();

type Check = 'ok' | 'missing' | 'unverified';
export interface Scenario {
  spec: string;
  /** trace/work/invocations files of the trail branch, as plain objects */
  trail: Record<string, unknown>;
  threads?: unknown[];
  repos?: string[];
  setup?: { auto_merge: Check; gate: Check };
  initRepos?: { repo: string; private: boolean }[];
  /** project-repo files, keyed `repo:sha:path` */
  repoFiles?: Record<string, string>;
}

const sha = (n: number) => String.fromCharCode(97 + (n % 6)).repeat(40); // aaaa…, bbbb…, cccc…

class VisualGitHub implements GitHub {
  s: Scenario = { spec: '', trail: {} };
  commits: string[] = [];
  extra: Record<string, string> = {};
  dispatches: unknown[] = [];
  reset(s: Scenario) {
    this.s = s;
    this.commits = [s.spec];
    this.extra = {};
    this.dispatches = [];
  }
  private project(ref: string) {
    return /^specages\/([^/]+)\//.exec(ref)?.[1] ?? '';
  }
  private cfg(p: string) {
    return `specage_version: v0\nproject: ${p}\nrepo: acme/${p}\ndata_repo: acme/specage-data\nspec_file: ${p}.specage\nreviewer: owner\nintern: {repo: acme/the-intern}\npages: {mode: off, path: specage}\n`;
  }
  async listProjects() {
    return (this.s.repos ?? ['acme/tbgwaf', 'acme/other']).map((r) => r.split('/')[1]);
  }
  async assertInstalled() {}
  async getFile(path: string, ref: string) {
    const p = this.project(ref);
    if (!(await this.listProjects()).includes(p)) return null;
    if (ref === specBranch(p)) {
      if (path === '.specage/config.yaml') return this.cfg(p);
      if (path === `${p}.specage`) return this.commits[this.commits.length - 1];
      if (path === 'comments.yaml')
        return (
          this.extra['comments.yaml'] ??
          (this.s.threads?.length ? stringifyComments(this.s.threads as never) : null)
        );
      return null;
    }
    if (ref === trailBranch(p) && path.endsWith('.yaml') && path in this.s.trail)
      return stringify(this.s.trail[path]);
    return null;
  }
  async getRef(ref: string) {
    return /^heads\/specages\/[^/]+\/spec$/.test(ref) ? sha(this.commits.length - 1) : null;
  }
  async commitSpec(
    _p: string,
    o: { path: string; content: string; message: string; parentSha: string },
  ) {
    if (o.parentSha !== sha(this.commits.length - 1)) throw new Conflict('moved');
    if (o.path === 'comments.yaml') this.extra[o.path] = o.content;
    else this.commits.push(o.content);
    return sha(this.commits.length - 1);
  }
  async commitTrail(): Promise<string> {
    throw new NotFound('read-only');
  }
  async getCursor() {
    return null;
  }
  async listInstallationRepos(): Promise<RepoInfo[]> {
    const init = this.s.initRepos ?? [{ repo: 'acme/new', private: false }];
    return init.map((r) => ({ full_name: r.repo, private: r.private, default_branch: 'main' }));
  }
  async getRepo(repo: string): Promise<RepoInfo | null> {
    return { full_name: repo, private: false, default_branch: 'main' };
  }
  async getRepoFile(repo: string, path: string, at: string) {
    return this.s.repoFiles?.[`${repo}:${at}:${path}`] ?? null;
  }
  async getMergeFacts(): Promise<MergeFacts> {
    const { auto_merge, gate } = this.s.setup ?? { auto_merge: 'ok', gate: 'ok' };
    return {
      allow_auto_merge: auto_merge === 'unverified' ? null : auto_merge === 'ok',
      required_checks: gate === 'unverified' ? null : gate === 'ok' ? ['ci-gate'] : [],
    };
  }
  async getActivePrs() {
    return [];
  }
  async ensureLabels() {}
  async createOrphanBranch(): Promise<string> {
    throw new Conflict('exists');
  }
  async dispatchAgent(_i: string, _w: string, d: Record<string, unknown>) {
    this.dispatches.push(d); // stub of the agent dispatch: nothing is executed
  }
}

const gh = new VisualGitHub();
const db = openDb(':memory:');
db.addCred({
  id: 'visual',
  public_key: Buffer.alloc(1),
  counter: 0,
  transports: null,
  created: Date.now(),
  label: 'owner',
});
const app = createApp({ env, db, github: gh });

const outer = new Hono();
// POST /__visual/scenario {Scenario}: install the scenario and sign the caller in.
outer.post('/__visual/scenario', async (c) => {
  gh.reset((await c.req.json()) as Scenario);
  const now = Date.now();
  setCookie(
    c,
    'specage_session',
    seal(env.sessionSecret, {
      cid: 'visual',
      issued: now,
      expires: now + 3600_000,
      csrf: 'csrf',
      stepup: now,
    }),
    { httpOnly: true, sameSite: 'Strict', path: '/', maxAge: 3600 },
  );
  return c.json({ ok: true });
});
outer.route('/', app);

serve({ fetch: outer.fetch, port: env.port, hostname: '127.0.0.1' });
console.log(`visual server on ${env.publicUrl}`);
