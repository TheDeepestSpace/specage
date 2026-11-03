import { createPrivateKey, createSign } from 'node:crypto';

/** Accepts PEM with real newlines, literal \n, collapsed spaces, or base64 of the PEM. */
export function normalizePem(raw: string): string {
  let k = raw.trim().replace(/^["']|["']$/g, '');
  if (!k.includes('-----BEGIN')) k = Buffer.from(k, 'base64').toString('utf8');
  k = k.replace(/\\n/g, '\n');
  const m = k.match(/-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----/);
  if (!m) return k;
  const body = m[2].replace(/\s+/g, '');
  return `-----BEGIN ${m[1]}-----\n${body.match(/.{1,64}/g)!.join('\n')}\n-----END ${m[1]}-----\n`;
}

export class Conflict extends Error {}
export class NotFound extends Error {}
/** The App lacks a permission or access to a repo; the message says what to grant. */
export class PermissionError extends Error {}

export interface RepoInfo {
  full_name: string;
  private: boolean;
  default_branch: string;
}

export const specBranch = (project: string) => `specages/${project}/spec`;
export const trailBranch = (project: string) => `specages/${project}/trail`;

/** All git data lives in the one data repo the client is bound to. */
export interface GitHub {
  /** project names with a specages/<project>/spec branch in the data repo */
  listProjects(): Promise<string[]>;
  /** throws NotFound unless the specage App is installed on the data repo */
  assertInstalled(): Promise<void>;
  getFile(path: string, ref: string): Promise<string | null>;
  /** commit sha at a ref such as "heads/specages/x/spec" */
  getRef(ref: string): Promise<string | null>;
  /** last dispatched spec commit for a project (ref specage/dispatched/<project>), or null */
  getCursor(project: string): Promise<string | null>;
  /** repos the App installation can see (not limited to the data repo) */
  listInstallationRepos(): Promise<RepoInfo[]>;
  getRepo(repo: string): Promise<RepoInfo | null>;
  /** creates missing labels on a project repo; throws PermissionError without Issues access */
  ensureLabels(repo: string, labels: string[]): Promise<void>;
  /** creates an orphan branch specages/<project>/<kind> with one commit; throws Conflict if it exists */
  createOrphanBranch(
    project: string,
    kind: 'spec' | 'trail',
    files: Record<string, string>,
    message: string,
  ): Promise<string>;
  /** non-force commit onto the project's spec branch; throws Conflict if the branch moved */
  commitSpec(
    project: string,
    o: {
      path: string;
      content: string;
      message: string;
      parentSha: string;
    },
  ): Promise<string>;
}

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const SEG = '[\\w.-]+';
/** The complete set of GitHub operations the server may perform. Anything else is refused. */
export const ALLOWED: { method: string; auth: 'jwt' | 'install'; re: RegExp }[] = [
  { method: 'GET', auth: 'jwt', re: new RegExp(`^/repos/${SEG}/${SEG}/installation$`) },
  { method: 'POST', auth: 'jwt', re: /^\/app\/installations\/\d+\/access_tokens$/ },
  {
    method: 'GET',
    auth: 'install',
    re: new RegExp(`^/repos/${SEG}/${SEG}/contents/[^?]+\\?ref=[^&]+$`),
  },
  {
    method: 'GET',
    auth: 'install',
    re: new RegExp(`^/repos/${SEG}/${SEG}/git/ref/(heads|tags|specage/dispatched)/[^?]+$`),
  },
  { method: 'GET', auth: 'install', re: /^\/installation\/repositories\?per_page=\d+$/ },
  { method: 'GET', auth: 'install', re: new RegExp(`^/repos/${SEG}/${SEG}$`) },
  { method: 'POST', auth: 'install', re: new RegExp(`^/repos/${SEG}/${SEG}/labels$`) },
  {
    method: 'GET',
    auth: 'install',
    re: new RegExp(`^/repos/${SEG}/${SEG}/git/matching-refs/heads/specages/$`),
  },
  {
    method: 'GET',
    auth: 'install',
    re: new RegExp(`^/repos/${SEG}/${SEG}/git/commits/[0-9a-f]{40}$`),
  },
  {
    method: 'POST',
    auth: 'install',
    re: new RegExp(`^/repos/${SEG}/${SEG}/git/(blobs|trees|commits)$`),
  },
  {
    method: 'PATCH',
    auth: 'install',
    re: new RegExp(`^/repos/${SEG}/${SEG}/git/refs/heads/specages/${SEG}/spec$`),
  },
  { method: 'POST', auth: 'install', re: new RegExp(`^/repos/${SEG}/${SEG}/git/refs$`) },
  { method: 'PUT', auth: 'install', re: new RegExp(`^/repos/${SEG}/${SEG}/contents/README\\.md$`) },
];

export class RealGitHub implements GitHub {
  private tokens = new Map<string, { token: string; exp: number }>();
  constructor(
    private o: {
      /** owner/repo of the data repo */
      dataRepo: string;
      appId?: string;
      privateKey?: string;
      devToken?: string;
      fetch?: Fetch;
      now?: () => number;
    },
  ) {}
  private f: Fetch = (u, i) => (this.o.fetch ?? fetch)(u, i);
  private now = () => (this.o.now ?? Date.now)();
  private get repo() {
    return this.o.dataRepo.split('/')[1];
  }

  private jwt(): string {
    const b64 = (x: object) => Buffer.from(JSON.stringify(x)).toString('base64url');
    const t = Math.floor(this.now() / 1000);
    const data = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iat: t - 30, exp: t + 540, iss: this.o.appId })}`;
    const sig = createSign('RSA-SHA256')
      .update(data)
      .sign(createPrivateKey(normalizePem(this.o.privateKey!)))
      .toString('base64url');
    return `${data}.${sig}`;
  }

  private async req(
    method: string,
    path: string,
    auth: { kind: 'jwt' } | { kind: 'install'; token: string },
    body?: unknown,
  ): Promise<Response> {
    const rule = ALLOWED.find(
      (r) =>
        r.method === method &&
        r.re.test(path) &&
        r.auth === (auth.kind === 'jwt' ? 'jwt' : 'install'),
    );
    if (!rule) throw new Error(`GitHub operation not allowlisted: ${method} ${path}`);
    const token = this.o.devToken ?? (auth.kind === 'jwt' ? this.jwt() : auth.token);
    return this.f(`https://api.github.com${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'specage-server',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  private async installationId(): Promise<number> {
    if (this.o.devToken) return 0;
    const r = await this.req('GET', `/repos/${this.o.dataRepo}/installation`, { kind: 'jwt' });
    if (r.status === 404) throw new NotFound('specage App is not installed on the data repo');
    if (!r.ok) throw new Error(`GitHub ${r.status}`);
    return ((await r.json()) as any).id;
  }

  /** 1 h installation token limited to the data repo; cached until 5 minutes before expiry. Never leaves the server. */
  private async repoToken(perm: 'write' | 'read' = 'write'): Promise<string> {
    if (this.o.devToken) return this.o.devToken;
    const c = this.tokens.get(perm);
    if (c && c.exp - 5 * 60_000 > this.now()) return c.token;
    const id = await this.installationId();
    const r = await this.req(
      'POST',
      `/app/installations/${id}/access_tokens`,
      { kind: 'jwt' },
      { repositories: [this.repo], permissions: { contents: perm } },
    );
    if (!r.ok) throw new Error(`GitHub token mint failed: ${r.status}`);
    const j = (await r.json()) as any;
    this.tokens.set(perm, { token: j.token, exp: Date.parse(j.expires_at) });
    return j.token;
  }

  /**
   * Token for project repos: Issues write + metadata read across the installation (not the data repo's
   * contents). Fails with PermissionError when the App was not granted Issues access.
   */
  private async wideToken(): Promise<string> {
    if (this.o.devToken) return this.o.devToken;
    const c = this.tokens.get('wide');
    if (c && c.exp - 5 * 60_000 > this.now()) return c.token;
    const id = await this.installationId();
    const r = await this.req(
      'POST',
      `/app/installations/${id}/access_tokens`,
      { kind: 'jwt' },
      { permissions: { issues: 'write', metadata: 'read' } },
    );
    if (r.status === 422 || r.status === 403)
      throw new PermissionError(
        'specage App needs "Issues: read & write" (and Metadata: read) to be granted on the installation',
      );
    if (!r.ok) throw new Error(`GitHub token mint failed: ${r.status}`);
    const j = (await r.json()) as any;
    this.tokens.set('wide', { token: j.token, exp: Date.parse(j.expires_at) });
    return j.token;
  }

  private async wideReq(method: string, path: string, body?: unknown) {
    return this.req(method, path, { kind: 'install', token: await this.wideToken() }, body);
  }

  private async repoReq(method: string, sub: string, body?: unknown) {
    const token = await this.repoToken();
    return this.req(method, `/repos/${this.o.dataRepo}${sub}`, { kind: 'install', token }, body);
  }

  async assertInstalled() {
    await this.installationId();
  }

  async listProjects(): Promise<string[]> {
    const r = await this.repoReq('GET', '/git/matching-refs/heads/specages/');
    if (r.status === 409) return []; // empty repo: no commits/refs yet
    if (!r.ok) throw new Error(`GitHub ${r.status}`);
    return ((await r.json()) as any[])
      .map((x) => /^refs\/heads\/specages\/(.+)\/spec$/.exec(x.ref)?.[1])
      .filter((p): p is string => !!p)
      .sort();
  }

  async getFile(path: string, ref: string): Promise<string | null> {
    const r = await this.repoReq(
      'GET',
      `/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`,
    );
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`GitHub ${r.status}`);
    const j = (await r.json()) as any;
    return Buffer.from(j.content, 'base64').toString('utf8');
  }

  async getRef(ref: string): Promise<string | null> {
    const r = await this.repoReq('GET', `/git/ref/${ref}`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`GitHub ${r.status}`);
    const j = (await r.json()) as any;
    return j.object.sha;
  }

  async getCursor(project: string) {
    return this.getRef(`specage/dispatched/${project}`);
  }

  async listInstallationRepos(): Promise<RepoInfo[]> {
    const r = await this.wideReq('GET', '/installation/repositories?per_page=100');
    if (!r.ok) throw new Error(`GitHub ${r.status}`);
    return ((await r.json()) as any).repositories.map((x: any) => ({
      full_name: x.full_name,
      private: !!x.private,
      default_branch: x.default_branch,
    }));
  }

  async getRepo(repo: string): Promise<RepoInfo | null> {
    const r = await this.wideReq('GET', `/repos/${repo}`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`GitHub ${r.status}`);
    const x = (await r.json()) as any;
    return { full_name: x.full_name, private: !!x.private, default_branch: x.default_branch };
  }

  async ensureLabels(repo: string, labels: string[]) {
    for (const name of labels) {
      const r = await this.wideReq('POST', `/repos/${repo}/labels`, { name, color: '5319e7' });
      if (r.status === 422) continue; // already exists
      if (r.status === 403 || r.status === 404)
        throw new PermissionError(`specage App cannot write labels on ${repo}: grant Issues write`);
      if (!r.ok) throw new Error(`GitHub ${r.status}`);
    }
  }

  async createOrphanBranch(
    project: string,
    kind: 'spec' | 'trail',
    files: Record<string, string>,
    message: string,
  ) {
    const branch = kind === 'spec' ? specBranch(project) : trailBranch(project);
    if (await this.getRef(`heads/${branch}`)) throw new Conflict('branch exists');
    const must = async (r: Response) => {
      if (!r.ok) throw new Error(`GitHub ${r.status}`);
      return (await r.json()) as any;
    };
    // git data API refuses an empty repo (409); seed it with a README commit via the contents API
    const probe = await this.repoReq('POST', '/git/blobs', { content: '', encoding: 'utf-8' });
    if (probe.status === 409) {
      await must(
        await this.repoReq('PUT', '/contents/README.md', {
          message: 'Initialise specage data repo',
          content: Buffer.from('# specage data\n').toString('base64'),
        }),
      );
    }
    const tree: { path: string; mode: string; type: string; sha: string }[] = [];
    for (const [path, content] of Object.entries(files)) {
      const blob = await must(
        await this.repoReq('POST', '/git/blobs', { content, encoding: 'utf-8' }),
      );
      tree.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    const t = await must(await this.repoReq('POST', '/git/trees', { tree }));
    const commit = await must(
      await this.repoReq('POST', '/git/commits', {
        message,
        tree: t.sha,
        parents: [],
      }),
    );
    const u = await this.repoReq('POST', '/git/refs', {
      ref: `refs/heads/${branch}`,
      sha: commit.sha,
    });
    if (u.status === 422) throw new Conflict('branch exists');
    await must(u);
    return commit.sha as string;
  }

  async commitSpec(
    project: string,
    o: {
      path: string;
      content: string;
      message: string;
      parentSha: string;
    },
  ) {
    const must = async (r: Response) => {
      if (!r.ok) throw new Error(`GitHub ${r.status}`);
      return (await r.json()) as any;
    };
    const parent = await must(await this.repoReq('GET', `/git/commits/${o.parentSha}`));
    const blob = await must(
      await this.repoReq('POST', '/git/blobs', { content: o.content, encoding: 'utf-8' }),
    );
    const tree = await must(
      await this.repoReq('POST', '/git/trees', {
        base_tree: parent.tree.sha,
        tree: [{ path: o.path, mode: '100644', type: 'blob', sha: blob.sha }],
      }),
    );
    const commit = await must(
      await this.repoReq('POST', '/git/commits', {
        message: o.message,
        tree: tree.sha,
        parents: [o.parentSha],
      }),
    );
    const u = await this.repoReq('PATCH', `/git/refs/heads/${specBranch(project)}`, {
      sha: commit.sha,
      force: false,
    });
    if (u.status === 422) throw new Conflict('spec moved');
    await must(u);
    return commit.sha as string;
  }
}
