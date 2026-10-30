import { createPrivateKey, createSign } from 'node:crypto';

export class Conflict extends Error {}
export class NotFound extends Error {}

export interface GitHub {
  /** repos where the specage App is installed and which have spec:.specage/config.yaml */
  listEnabledRepos(): Promise<string[]>;
  /** throws NotFound unless the App is installed on the repo */
  assertInstalled(owner: string, repo: string): Promise<void>;
  getFile(owner: string, repo: string, path: string, ref: string): Promise<string | null>;
  /** commit sha at a ref such as "heads/spec" or "tags/dispatch/x" */
  getRef(owner: string, repo: string, ref: string): Promise<string | null>;
  listDispatchTags(owner: string, repo: string): Promise<string[]>;
  /** non-force commit onto spec; throws Conflict if the branch moved */
  commitSpec(
    owner: string,
    repo: string,
    o: {
      path: string;
      content: string;
      message: string;
      parentSha: string;
      author: { name: string; email: string };
    },
  ): Promise<string>;
  createTag(owner: string, repo: string, tag: string, sha: string): Promise<void>;
}

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const SEG = '[\\w.-]+';
/** The complete set of GitHub operations the server may perform. Anything else is refused. */
export const ALLOWED: { method: string; auth: 'jwt' | 'install'; re: RegExp }[] = [
  { method: 'GET', auth: 'jwt', re: new RegExp(`^/repos/${SEG}/${SEG}/installation$`) },
  { method: 'GET', auth: 'jwt', re: /^\/app\/installations$/ },
  { method: 'POST', auth: 'jwt', re: /^\/app\/installations\/\d+\/access_tokens$/ },
  { method: 'GET', auth: 'install', re: /^\/installation\/repositories(\?per_page=\d+)?$/ },
  {
    method: 'GET',
    auth: 'install',
    re: new RegExp(`^/repos/${SEG}/${SEG}/contents/[^?]+\\?ref=[^&]+$`),
  },
  {
    method: 'GET',
    auth: 'install',
    re: new RegExp(`^/repos/${SEG}/${SEG}/git/ref/(heads|tags)/[^?]+$`),
  },
  {
    method: 'GET',
    auth: 'install',
    re: new RegExp(`^/repos/${SEG}/${SEG}/git/matching-refs/tags/dispatch/$`),
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
    re: new RegExp(`^/repos/${SEG}/${SEG}/git/refs/heads/spec$`),
  },
  { method: 'POST', auth: 'install', re: new RegExp(`^/repos/${SEG}/${SEG}/git/refs$`) },
];

export class RealGitHub implements GitHub {
  private tokens = new Map<string, { token: string; exp: number }>();
  constructor(
    private o: {
      appId?: string;
      privateKey?: string;
      devToken?: string;
      fetch?: Fetch;
      now?: () => number;
    },
  ) {}
  private f: Fetch = (u, i) => (this.o.fetch ?? fetch)(u, i);
  private now = () => (this.o.now ?? Date.now)();

  private jwt(): string {
    const b64 = (x: object) => Buffer.from(JSON.stringify(x)).toString('base64url');
    const t = Math.floor(this.now() / 1000);
    const data = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iat: t - 30, exp: t + 540, iss: this.o.appId })}`;
    const sig = createSign('RSA-SHA256')
      .update(data)
      .sign(createPrivateKey(this.o.privateKey!))
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

  private async installationFor(owner: string, repo: string): Promise<number> {
    if (this.o.devToken) return 0;
    const r = await this.req('GET', `/repos/${owner}/${repo}/installation`, { kind: 'jwt' });
    if (r.status === 404) throw new NotFound('specage App is not installed on this repo');
    if (!r.ok) throw new Error(`GitHub ${r.status}`);
    return ((await r.json()) as any).id;
  }

  /** 1 h installation token limited to this repo; cached until 5 minutes before expiry. Never leaves the server. */
  private async repoToken(
    owner: string,
    repo: string,
    perm: 'write' | 'read' = 'write',
  ): Promise<string> {
    if (this.o.devToken) return this.o.devToken;
    const key = `${owner}/${repo}:${perm}`;
    const c = this.tokens.get(key);
    if (c && c.exp - 5 * 60_000 > this.now()) return c.token;
    const id = await this.installationFor(owner, repo);
    const r = await this.req(
      'POST',
      `/app/installations/${id}/access_tokens`,
      { kind: 'jwt' },
      { repositories: [repo], permissions: { contents: perm } },
    );
    if (!r.ok) throw new Error(`GitHub token mint failed: ${r.status}`);
    const j = (await r.json()) as any;
    this.tokens.set(key, { token: j.token, exp: Date.parse(j.expires_at) });
    return j.token;
  }

  private async repoReq(owner: string, repo: string, method: string, sub: string, body?: unknown) {
    const token = await this.repoToken(owner, repo);
    return this.req(method, `/repos/${owner}/${repo}${sub}`, { kind: 'install', token }, body);
  }

  async assertInstalled(owner: string, repo: string) {
    await this.installationFor(owner, repo);
  }

  async listEnabledRepos(): Promise<string[]> {
    if (this.o.devToken) return [];
    const r = await this.req('GET', '/app/installations', { kind: 'jwt' });
    if (!r.ok) throw new Error(`GitHub ${r.status}`);
    const out: string[] = [];
    for (const inst of (await r.json()) as any[]) {
      const t = await this.req(
        'POST',
        `/app/installations/${inst.id}/access_tokens`,
        { kind: 'jwt' },
        { permissions: { contents: 'read' } },
      );
      if (!t.ok) continue;
      const tok = ((await t.json()) as any).token as string;
      const rr = await this.req('GET', '/installation/repositories?per_page=100', {
        kind: 'install',
        token: tok,
      });
      if (!rr.ok) continue;
      for (const repo of ((await rr.json()) as any).repositories as any[]) {
        const c = await this.req(
          'GET',
          `/repos/${repo.full_name}/contents/.specage/config.yaml?ref=spec`,
          { kind: 'install', token: tok },
        );
        if (c.ok) out.push(repo.full_name);
      }
    }
    return out;
  }

  async getFile(owner: string, repo: string, path: string, ref: string): Promise<string | null> {
    const r = await this.repoReq(
      owner,
      repo,
      'GET',
      `/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`,
    );
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`GitHub ${r.status}`);
    const j = (await r.json()) as any;
    return Buffer.from(j.content, 'base64').toString('utf8');
  }

  async getRef(owner: string, repo: string, ref: string): Promise<string | null> {
    const r = await this.repoReq(owner, repo, 'GET', `/git/ref/${ref}`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`GitHub ${r.status}`);
    const j = (await r.json()) as any;
    return j.object.sha;
  }

  async listDispatchTags(owner: string, repo: string): Promise<string[]> {
    const r = await this.repoReq(owner, repo, 'GET', '/git/matching-refs/tags/dispatch/');
    if (!r.ok) throw new Error(`GitHub ${r.status}`);
    return ((await r.json()) as any[]).map((x) => x.ref.replace(/^refs\/tags\//, '')).sort();
  }

  async commitSpec(
    owner: string,
    repo: string,
    o: {
      path: string;
      content: string;
      message: string;
      parentSha: string;
      author: { name: string; email: string };
    },
  ) {
    const must = async (r: Response) => {
      if (!r.ok) throw new Error(`GitHub ${r.status}`);
      return (await r.json()) as any;
    };
    const parent = await must(
      await this.repoReq(owner, repo, 'GET', `/git/commits/${o.parentSha}`),
    );
    const blob = await must(
      await this.repoReq(owner, repo, 'POST', '/git/blobs', {
        content: o.content,
        encoding: 'utf-8',
      }),
    );
    const tree = await must(
      await this.repoReq(owner, repo, 'POST', '/git/trees', {
        base_tree: parent.tree.sha,
        tree: [{ path: o.path, mode: '100644', type: 'blob', sha: blob.sha }],
      }),
    );
    const commit = await must(
      await this.repoReq(owner, repo, 'POST', '/git/commits', {
        message: o.message,
        tree: tree.sha,
        parents: [o.parentSha],
        author: { ...o.author, date: new Date(this.now()).toISOString() },
      }),
    );
    const u = await this.repoReq(owner, repo, 'PATCH', '/git/refs/heads/spec', {
      sha: commit.sha,
      force: false,
    });
    if (u.status === 422) throw new Conflict('spec moved');
    await must(u);
    return commit.sha as string;
  }

  async createTag(owner: string, repo: string, tag: string, sha: string) {
    const r = await this.repoReq(owner, repo, 'POST', '/git/refs', {
      ref: `refs/tags/${tag}`,
      sha,
    });
    if (r.status === 422) throw new Conflict('tag exists');
    if (!r.ok) throw new Error(`GitHub ${r.status}`);
  }
}
