import { describe, expect, it } from 'vitest';
import { RealGitHub, ALLOWED } from '../src/github.js';
import { seal, unseal } from '../src/seal.js';
import { challengeText, verifySshsig, signupNamespace, SshsigError } from '../src/sshsig.js';
import { loadEnv } from '../src/env.js';
import { FakeGitHub, ORIGIN, SPEC0, SoftAuthenticator, harness, sshKey } from './helpers.js';
import { generateKeyPairSync } from 'node:crypto';

const auth = () => new SoftAuthenticator(ORIGIN, 'specage.test');

describe('seal', () => {
  const key = Buffer.alloc(32, 1);
  it('round-trips', () => expect(unseal(key, seal(key, { a: 1 }))).toEqual({ a: 1 }));
  it('rejects tampering and wrong keys', () => {
    const t = seal(key, { a: 1 });
    const b = Buffer.from(t, 'base64url');
    b[b.length - 1] ^= 1;
    expect(unseal(key, b.toString('base64url'))).toBeNull();
    expect(unseal(Buffer.alloc(32, 2), t)).toBeNull();
    expect(unseal(key, 'garbage')).toBeNull();
    expect(unseal(key, undefined)).toBeNull();
  });
});

describe('SSHSIG (real ssh-keygen signatures)', () => {
  const k = sshKey();
  const ch = (over: Partial<{ host: string; expires: string }> = {}) =>
    challengeText({
      purpose: 'specage-signup',
      host: 'specage.test',
      nonce: 'a'.repeat(64),
      expires: new Date(Date.now() + 1e5).toISOString(),
      ...over,
    });
  const ns = signupNamespace('specage.test');
  const ok = (armored: string, message: string, namespace = ns, pub = k.pub) =>
    verifySshsig({ armored, message, namespace, ownerPubkey: pub });
  it('accepts a valid signature', () => {
    const m = ch();
    ok(k.sign(m, ns), m);
  });
  it('rejects a tampered message', () => {
    const m = ch();
    expect(() => ok(k.sign(m, ns), m + 'x')).toThrow(SshsigError);
  });
  it('rejects a wrong namespace', () => {
    const m = ch();
    expect(() => ok(k.sign(m, 'other@specage.test'), m)).toThrow(/namespace/);
  });
  it('rejects another key', () => {
    const m = ch();
    expect(() => ok(k.sign(m, ns), m, ns, sshKey().pub)).toThrow(/different key/);
  });
  it('rejects garbage', () => expect(() => ok('nope', ch())).toThrow(SshsigError));
});

describe('signup and passkeys', () => {
  it('opens only via the owner key, once, and /signup disappears', async () => {
    const h = harness();
    const a = auth();
    expect((await h.signup(a)).status).toBe(200);
    expect((await h.req('GET', '/signup', undefined, { accept: 'application/json' })).status).toBe(
      404,
    );
    expect((await h.req('POST', '/auth/signup/verify', { signature: 'x' })).status).toBe(404);
    expect((await h.req('GET', '/api/me')).status).toBe(200);
  });
  it('rejects a signature from a different key', async () => {
    const h = harness();
    const ch = (await (
      await h.req('GET', '/signup', undefined, { accept: 'application/json' })
    ).json()) as any;
    const r = await h.req('POST', '/auth/signup/verify', {
      signature: sshKey().sign(ch.challenge, ch.namespace),
    });
    expect(r.status).toBe(400);
    expect((await h.req('POST', '/auth/register/options', {})).status).toBe(403);
  });
  it('rejects a tampered challenge, wrong namespace and an expired challenge', async () => {
    let t = Date.now();
    const h = harness({ now: () => t });
    const ch = (await (
      await h.req('GET', '/signup', undefined, { accept: 'application/json' })
    ).json()) as any;
    expect(
      (
        await h.req('POST', '/auth/signup/verify', {
          signature: h.key.sign(ch.challenge + ' ', ch.namespace),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await h.req('POST', '/auth/signup/verify', {
          signature: h.key.sign(ch.challenge, 'x@specage.test'),
        })
      ).status,
    ).toBe(400);
    t += 6 * 60_000;
    const r = await h.req('POST', '/auth/signup/verify', {
      signature: h.key.sign(ch.challenge, ch.namespace),
    });
    expect(r.status).toBe(400);
    expect(((await r.json()) as any).error).toMatch(/expired/);
  });
  it('rejects a replayed nonce', async () => {
    const h = harness();
    const ch = (await (
      await h.req('GET', '/signup', undefined, { accept: 'application/json' })
    ).json()) as any;
    const sig = h.key.sign(ch.challenge, ch.namespace);
    const cookie = h.jar.get('specage_signup')!;
    expect((await h.req('POST', '/auth/signup/verify', { signature: sig })).status).toBe(200);
    h.jar.set('specage_signup', cookie); // attacker replays the old cookie + signature
    const r = await h.req('POST', '/auth/signup/verify', { signature: sig });
    expect(r.status).toBe(400);
    expect(((await r.json()) as any).error).toMatch(/already used/);
  });
  it('only one passkey can be registered from the window', async () => {
    const h = harness();
    expect((await h.signup(auth())).status).toBe(200);
    expect((await h.req('POST', '/auth/register/options', {})).status).toBe(403);
  });
  it('login works; unknown credential rejected', async () => {
    const h = harness();
    const a = auth();
    await h.signup(a);
    await h.req('POST', '/auth/logout', {});
    expect((await h.req('GET', '/api/me')).status).toBe(401);
    expect((await h.login(a)).status).toBe(200);
    expect((await h.req('GET', '/api/me')).status).toBe(200);
    const other = auth();
    const opts = await (await h.req('POST', '/auth/login/options', {})).json();
    expect((await h.req('POST', '/auth/login/verify', { response: other.get(opts) })).status).toBe(
      401,
    );
  });
  it('rejects a signature-counter regression', async () => {
    const h = harness();
    const a = auth();
    await h.signup(a);
    expect((await h.login(a, 5)).status).toBe(200);
    expect((await h.login(a, 3)).status).toBe(401);
    expect((await h.login(a, 5)).status).toBe(401);
    expect((await h.login(a, 6)).status).toBe(200);
  });
  it('tolerates authenticators that always report counter 0', async () => {
    const h = harness();
    const a = auth();
    await h.signup(a);
    expect((await h.login(a, 0)).status).toBe(200);
    expect((await h.login(a, 0)).status).toBe(200);
  });
  it('add-device link is single use and needs step-up to mint', async () => {
    let t = Date.now();
    const h = harness({ now: () => t });
    const a = auth();
    await h.signup(a);
    const link = (await (await h.req('POST', '/auth/device/link', {})).json()) as any;
    const token = link.url.split('#')[1];
    t += 6 * 60_000;
    expect((await h.req('POST', '/auth/device/link', {})).status).toBe(403); // stale step-up
    await h.login(a);
    expect((await h.req('POST', '/auth/device/link', {})).status).toBe(200);
    const h2 = { ...h, jar: new Map<string, string>() };
    void h2;
    expect((await h.req('POST', '/auth/device/redeem', { token })).status).toBe(200);
    expect((await h.req('POST', '/auth/device/redeem', { token })).status).toBe(403);
    t += 11 * 60_000;
    const l2 = (await (await h.req('POST', '/auth/device/link', {})).json()) as any;
    void l2;
  });
});

describe('CSRF', () => {
  it('rejects missing/mismatched origin, missing header, bad token', async () => {
    const h = harness();
    await h.signup(auth());
    const body = { content: SPEC0, base_sha: h.github.head().sha };
    expect(
      (await h.req('PUT', '/api/r/o/r/spec', body, { origin: 'https://evil.test' })).status,
    ).toBe(403);
    expect((await h.req('PUT', '/api/r/o/r/spec', body, { 'x-specage': '' })).status).toBe(403);
    expect((await h.req('PUT', '/api/r/o/r/spec', body, { 'x-csrf-token': 'nope' })).status).toBe(
      403,
    );
    expect((await h.req('PUT', '/api/r/o/r/spec', body)).status).toBe(200);
    expect(
      (await h.req('POST', '/auth/login/options', {}, { origin: 'https://evil.test' })).status,
    ).toBe(403);
  });
  it('sets hardening headers and secure cookies', async () => {
    const h = harness();
    const r = await h.req('GET', '/healthz');
    expect(r.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(r.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(r.headers.get('strict-transport-security')).toBeTruthy();
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('referrer-policy')).toBe('no-referrer');
    const s = await h.req('GET', '/signup', undefined, { accept: 'application/json' });
    const c = s.headers.getSetCookie()[0];
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(/Secure/i);
    expect(c).toMatch(/SameSite=Strict/i);
  });
});

describe('API', () => {
  it('requires a session', async () => {
    const h = harness();
    for (const [m, p] of [
      ['GET', '/api/me'],
      ['GET', '/api/repos'],
      ['GET', '/api/r/o/r/spec'],
      ['POST', '/api/init'],
    ])
      expect((await h.req(m, p, m === 'POST' ? {} : undefined)).status).toBe(401);
  });
  it('reads spec and state; refuses repos without the App', async () => {
    const h = harness();
    await h.signup(auth());
    const s = (await (await h.req('GET', '/api/r/o/r/spec')).json()) as any;
    expect(s).toMatchObject({ content: SPEC0, path: 'r.specage' });
    const st = (await (await h.req('GET', '/api/r/o/r/state')).json()) as any;
    expect(st.trace.retired_ids).toEqual(['old.id']);
    expect((await h.req('GET', '/api/r/o/other/spec')).status).toBe(404);
    expect((await h.req('GET', '/api/r/o/..%2Fx/spec')).status).toBe(400);
  });
  it('save: 422 on lint errors, 409 on conflict, ok otherwise, author header', async () => {
    const h = harness();
    await h.signup(auth());
    const base = h.github.head().sha;
    const bad = await h.req('PUT', '/api/r/o/r/spec', { content: 'no id here;', base_sha: base });
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as any).diagnostics[0].code).toBe('E002');
    expect(
      (await h.req('PUT', '/api/r/o/r/spec', { content: 'x @old.id;', base_sha: base })).status,
    ).toBe(422); // E004 via trace
    const ok = await h.req('PUT', '/api/r/o/r/spec', {
      content: SPEC0 + 'New thing @shoot.new;\n',
      base_sha: base,
    });
    expect(ok.status).toBe(200);
    expect(h.github.lastMessage).toBe('spec: shoot.new');
    const stale = await h.req('PUT', '/api/r/o/r/spec', {
      content: SPEC0 + 'Other @shoot.other;\n',
      base_sha: base,
    });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as any).content).toContain('shoot.new');
  });
  it('a save files a dispatch issue with the diff from the cursor, then advances the cursor', async () => {
    const h = harness();
    await h.signup(auth());
    const pv = (await (await h.req('GET', '/api/r/o/r/dispatch/preview')).json()) as any;
    expect(pv.cursor).toBeNull();
    expect(pv.diff.entries.map((e: any) => e.kind)).toEqual(['added', 'added']);
    const r1 = await h.req('PUT', '/api/r/o/r/spec', {
      content: SPEC0 + 'New thing @shoot.new;\n',
      base_sha: pv.head_sha,
    });
    const j1 = (await r1.json()) as any;
    expect(j1.dispatch.issue).toBe(1);
    expect(h.github.cursor).toBe(j1.head_sha);
    expect(h.github.issues[0]).toMatchObject({ repo: 'o/r', labels: ['specage-dispatch'] });
    expect(h.github.issues[0].title).toBe(`specage dispatch ${j1.head_sha.slice(0, 7)}`);
    expect(h.github.issues[0].body).toContain('none, diff from empty');
    // second save: cursor is the previous commit
    const r2 = await h.req('PUT', '/api/r/o/r/spec', {
      content: SPEC0 + 'New thing @shoot.new;\nMore @shoot.more;\n',
      base_sha: j1.head_sha,
    });
    expect(((await r2.json()) as any).dispatch.issue).toBe(2);
    expect(h.github.issues[1].body).toContain(`cursor: \`${j1.head_sha}\``);
    // a save that changes no nodes (whitespace) files nothing but still moves the cursor
    const j2 = (await (
      await h.req('PUT', '/api/r/o/r/spec', {
        content: SPEC0 + 'New thing @shoot.new;\nMore @shoot.more;\n\n',
        base_sha: h.github.head().sha,
      })
    ).json()) as any;
    expect(j2.dispatch).toBeNull();
    expect(h.github.issues).toHaveLength(2);
    expect(h.github.cursor).toBe(j2.head_sha);
  });
  it('a failing issue does not fail the save and does not move the cursor', async () => {
    const h = harness();
    await h.signup(auth());
    h.github.noIssuesPermission = true;
    const r = await h.req('PUT', '/api/r/o/r/spec', {
      content: SPEC0 + 'X @shoot.x;\n',
      base_sha: h.github.head().sha,
    });
    expect(r.status).toBe(200);
    expect(((await r.json()) as any).dispatch).toBeNull();
    expect(h.github.cursor).toBeNull();
  });
  it('init: lists repos, previews, creates idempotently, needs step-up and the right repo', async () => {
    let t = Date.parse('2026-10-30T02:11:30Z');
    const h = harness({ now: () => t });
    const a = auth();
    await h.signup(a);
    const repos = (await (await h.req('GET', '/api/init/repos')).json()) as any[];
    expect(repos).toEqual([
      { repo: 'o/r', private: true, initialised: true },
      { repo: 'o/new', private: false, initialised: false },
    ]);
    const pv = (await (await h.req('POST', '/api/init/preview', { repo: 'o/new' })).json()) as any;
    expect(pv.branches.map((b: any) => b.action)).toEqual(['create', 'create']);
    expect(pv.warnings[0]).toMatch(/public/);
    expect(h.github.created).toEqual({}); // preview writes nothing
    expect((await h.req('POST', '/api/init/preview', { repo: 'o/nope' })).status).toBe(403);
    expect((await h.req('POST', '/api/init/preview', { repo: 'bad' })).status).toBe(400);
    expect(
      (await h.req('POST', '/api/init/preview', { repo: 'o/new', project: 'other' })).status,
    ).toBe(400);
    const ok = await h.req('POST', '/api/init', { repo: 'o/new', backend: 'claude' });
    expect(ok.status).toBe(200);
    const spec = h.github.created['specages/new/spec'];
    expect(Object.keys(spec)).toEqual(
      expect.arrayContaining([
        'new.specage',
        'GRAMMAR.md',
        '.specage/config.yaml',
        '.specage/policy.yaml',
        '.specage/PROTOCOL.md',
      ]),
    );
    expect(Object.keys(spec).some((f) => f.startsWith('.github/'))).toBe(false);
    expect(spec['.specage/config.yaml']).toContain('repo: o/new');
    expect(spec['.specage/config.yaml']).toContain('data_repo: o/specage-data');
    expect(spec['.specage/config.yaml']).not.toMatch(/\{\{/);
    expect(Object.keys(h.github.created['specages/new/trail'])).toEqual(
      expect.arrayContaining(['trace.yaml', 'work.yaml', 'questions.yaml']),
    );
    expect(h.github.labels).toEqual(['specage-dispatch', 'specage']);
    // idempotent: the existing project reports "exists" and nothing is overwritten
    const again = (await (await h.req('POST', '/api/init', { repo: 'o/new' })).json()) as any;
    expect(again.branches.map((b: any) => b.action)).toEqual(['exists', 'exists']);
    t += 6 * 60_000; // step-up stale
    expect((await h.req('POST', '/api/init', { repo: 'o/new' })).status).toBe(403);
  });
  it('init: missing Issues permission is a clear 403 and nothing is written', async () => {
    const h = harness();
    await h.signup(auth());
    h.github.noIssuesPermission = true;
    const r = await h.req('POST', '/api/init', { repo: 'o/new' });
    expect(r.status).toBe(403);
    expect(((await r.json()) as any).error).toMatch(/Issues/);
    expect(h.github.created).toEqual({});
  });
  it('init routes need a session', async () => {
    const h = harness();
    expect((await h.req('GET', '/api/init/repos')).status).toBe(401);
    expect((await h.req('POST', '/api/init', { repo: 'o/new' })).status).toBe(401);
  });
  it('credentials: cannot delete the last passkey', async () => {
    const h = harness();
    await h.signup(auth());
    const list = (await (await h.req('GET', '/api/credentials')).json()) as any[];
    expect((await h.req('DELETE', `/api/credentials/${list[0].id}`)).status).toBe(409);
  });
  it('rate-limits writes per session', async () => {
    const h = harness();
    await h.signup(auth());
    let last = 200;
    for (let i = 0; i < 61; i++)
      last = (
        await h.req('PUT', '/api/r/o/r/spec', { content: SPEC0, base_sha: h.github.head().sha })
      ).status;
    expect(last).toBe(429);
  });
  it('never logs or returns secrets from the audit table', async () => {
    const h = harness();
    await h.signup(auth());
    expect(JSON.stringify(h.db.auditRows())).not.toContain('signature');
  });
});

describe('GitHub access', () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  function mock() {
    const log: { method: string; path: string; auth: string; body?: any }[] = [];
    const fetch = async (url: string, init: RequestInit = {}) => {
      const u = new URL(url);
      const path = u.pathname + u.search;
      log.push({
        method: init.method ?? 'GET',
        path,
        auth: String((init.headers as any).authorization),
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      });
      const j = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
      if (u.pathname.endsWith('/installation')) return j({ id: 42 });
      if (u.pathname === '/app/installations/42/access_tokens')
        return j({
          token: 'ghs_SECRET_TOKEN',
          expires_at: new Date(Date.now() + 3600e3).toISOString(),
        });
      if (u.pathname.includes('/contents/'))
        return j({ content: Buffer.from('hello').toString('base64') });
      if (
        u.pathname.includes('/git/ref/specage/dispatched/') ||
        u.pathname.includes('/specages/new/')
      )
        return j({}, 404);
      if (u.pathname.endsWith('/git/ref/heads/specages/r/spec'))
        return j({ object: { sha: 'a'.repeat(40) } });
      if (u.pathname.includes('/git/commits/')) return j({ tree: { sha: 't' } });
      if (u.pathname.endsWith('/git/blobs')) return j({ sha: 'b' });
      if (u.pathname.endsWith('/git/trees')) return j({ sha: 't2' });
      if (u.pathname.endsWith('/git/commits')) return j({ sha: 'c'.repeat(40) });
      if (u.pathname.endsWith('/git/refs/heads/specages/r/spec')) return j({});
      if (u.pathname.endsWith('/git/refs')) return j({});
      if (u.pathname.includes('matching-refs/heads/specages/'))
        return j([{ ref: 'refs/heads/specages/r/spec' }, { ref: 'refs/heads/specages/r/trail' }]);
      if (u.pathname.includes('matching-refs')) return j([]);
      if (u.pathname === '/installation/repositories')
        return j({ repositories: [{ full_name: 'o/x', private: true, default_branch: 'main' }] });
      if (u.pathname === '/repos/o/x')
        return j({ full_name: 'o/x', private: true, default_branch: 'main' });
      if (u.pathname.endsWith('/labels')) return j({}, 201);
      if (u.pathname.endsWith('/issues')) return j({ number: 7 }, 201);
      return j({ message: 'unexpected' }, 500);
    };
    return {
      log,
      gh: new RealGitHub({
        dataRepo: 'o/specage-data',
        appId: '1',
        privateKey: pem,
        fetch: fetch as any,
      }),
    };
  }
  it('mints a data-repo-scoped, contents-only installation token and caches it', async () => {
    const { log, gh } = mock();
    await gh.getFile('a.specage', 'specages/r/spec');
    await gh.getFile('a.specage', 'specages/r/spec');
    const mints = log.filter((l) => l.path.endsWith('/access_tokens'));
    expect(mints).toHaveLength(1);
    expect(mints[0].body).toEqual({
      repositories: ['specage-data'],
      permissions: { contents: 'write' },
    });
  });
  it('every request made by every operation is on the allowlist', async () => {
    const { log, gh } = mock();
    await gh.assertInstalled();
    await gh.listProjects();
    await gh.getFile('dir/a.specage', 'a'.repeat(40));
    await gh.getRef('heads/specages/r/spec');
    await gh.getCursor('r');
    await gh.setCursor('r', 'a'.repeat(40));
    await gh.listInstallationRepos();
    await gh.getRepo('o/x');
    await gh.ensureLabels('o/x', ['specage']);
    expect(await gh.createIssue('o/x', { title: 't', body: 'b', labels: [] })).toBe(7);
    await gh.createOrphanBranch('new', 'spec', { 'a.txt': 'x' }, 'm');
    await gh.commitSpec('r', {
      path: 'a.specage',
      content: 'x',
      message: 'm',
      parentSha: 'a'.repeat(40),
      author: { name: 'n', email: 'e' },
    });
    expect(log.length).toBeGreaterThan(8);
    for (const l of log)
      expect(
        ALLOWED.some((r) => r.method === l.method && r.re.test(l.path)),
        `${l.method} ${l.path}`,
      ).toBe(true);
    const ref = log.find((l) => l.method === 'PATCH')!;
    expect(ref.body.force).toBe(false);
  });
  it('the request wrapper refuses anything off the allowlist', async () => {
    const { gh } = mock();
    await expect((gh as any).req('DELETE', '/repos/o/r', { kind: 'jwt' })).rejects.toThrow(
      /not allowlisted/,
    );
    await expect(
      (gh as any).req(
        'PATCH',
        '/repos/o/r/git/refs/heads/main',
        { kind: 'install', token: 't' },
        {},
      ),
    ).rejects.toThrow(/not allowlisted/);
    await expect(
      (gh as any).req(
        'PATCH',
        '/repos/o/specage-data/git/refs/heads/specages/r/trail',
        { kind: 'install', token: 't' },
        {},
      ),
    ).rejects.toThrow(/not allowlisted/);
    await expect(
      (gh as any).req('DELETE', '/repos/o/r/issues/1', { kind: 'install', token: 't' }),
    ).rejects.toThrow(/not allowlisted/);
    await expect(
      (gh as any).req('PATCH', '/repos/o/r/git/refs/specage/dispatched/x/y', {
        kind: 'install',
        token: 't',
      }),
    ).rejects.toThrow(/not allowlisted/);
    await expect(
      (gh as any).req('PUT', '/repos/o/r/contents/x', { kind: 'install', token: 't' }, {}),
    ).rejects.toThrow(/not allowlisted/);
  });
  it('installation tokens never reach the client', async () => {
    const { gh } = mock();
    const h = harness();
    const bodies: string[] = [];
    const real = new FakeGitHub();
    void real;
    await h.signup(auth());
    // Drive every API route through a server backed by the token-minting client.
    const { createApp } = await import('../src/app.js');
    const app = createApp({ env: h.env, db: h.db, github: gh });
    const jar = [...h.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const hdr = {
      origin: ORIGIN,
      'x-specage': '1',
      'x-csrf-token': h.csrf,
      cookie: jar,
      'content-type': 'application/json',
    };
    for (const [m, p] of [
      ['GET', '/api/r/o/r/spec'],
      ['GET', '/api/r/o/r/state'],
      ['GET', '/api/r/o/r/dispatch/preview'],
      ['GET', '/api/me'],
      ['GET', '/api/credentials'],
    ]) {
      const r = await app.request(p, { method: m, headers: hdr });
      bodies.push(await r.text(), JSON.stringify([...r.headers]));
    }
    expect(bodies.join('\n')).not.toContain('ghs_SECRET_TOKEN');
  });
});

describe('env', () => {
  const base = {
    SESSION_SECRET: Buffer.alloc(32, 1).toString('base64'),
    OWNER_PUBKEY: 'x',
    GITHUB_APP_ID: '1',
    GITHUB_APP_PRIVATE_KEY: 'k',
    PUBLIC_URL: 'https://x.fly.dev',
  };
  it('refuses DEV_GITHUB_TOKEN outside development', () => {
    expect(() => loadEnv({ ...base, DEV_GITHUB_TOKEN: 't' })).toThrow(/NODE_ENV=development/);
    expect(
      loadEnv({ ...base, NODE_ENV: 'development', DEV_GITHUB_TOKEN: 't' }).devGithubToken,
    ).toBe('t');
  });
  it('requires https and a 32 byte secret in production', () => {
    expect(() => loadEnv({ ...base, PUBLIC_URL: 'http://x.fly.dev' })).toThrow(/https/);
    expect(() => loadEnv({ ...base, SESSION_SECRET: 'AAAA' })).toThrow(/32 bytes/);
  });
});
