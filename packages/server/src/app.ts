import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { Hono, type Context, type Next } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import {
  ConfigSchema,
  diff,
  hasErrors,
  lint,
  parse,
  parseState,
  flatten,
  parseYaml,
} from '@specage/core';
import YAML from 'yaml';
import type { Db } from './db.js';
import type { Env } from './env.js';
import {
  Conflict,
  NotFound,
  PermissionError,
  specBranch,
  trailBranch,
  type GitHub,
} from './github.js';
import { BadInit, planInit, runInit } from './init.js';
import { safeEqual, seal, unseal } from './seal.js';
import {
  SIGNUP_PURPOSE,
  SshsigError,
  challengeText,
  parseChallenge,
  signupNamespace,
  verifySshsig,
  type SignupChallenge,
} from './sshsig.js';

const SESSION_MS = 12 * 3600_000;
const STEPUP_MS = 5 * 60_000;
const WINDOW_MS = 5 * 60_000;
const LINK_MS = 10 * 60_000;
const WRITES_PER_HOUR = 60;

interface Session {
  cid: string;
  issued: number;
  expires: number;
  csrf: string;
  stepup: number;
}

export interface Deps {
  env: Env;
  db: Db;
  github: GitHub;
  now?: () => number;
}

export function createApp({ env, db, github, now = Date.now }: Deps) {
  const app = new Hono();
  const rpID = env.host;
  const rpName = 'specage';
  const userID = new TextEncoder().encode('specage-owner');
  const writes = new Map<string, number[]>();

  const cookieOpts = (maxAgeSec?: number) => ({
    httpOnly: true,
    secure: env.secureCookies,
    sameSite: 'Strict' as const,
    path: '/',
    ...(maxAgeSec ? { maxAge: maxAgeSec } : {}),
  });
  const put = (c: Context, name: string, v: unknown, sec: number) =>
    setCookie(c, name, seal(env.sessionSecret, v), cookieOpts(sec));
  const take = <T>(c: Context, name: string): T | null =>
    unseal<T>(env.sessionSecret, getCookie(c, name));
  const getSession = (c: Context): Session | null => {
    const s = take<Session>(c, 'specage_session');
    return s && s.expires > now() && db.cred(s.cid) ? s : null;
  };
  const setSession = (c: Context, s: Session) =>
    put(c, 'specage_session', s, Math.ceil((s.expires - now()) / 1000));
  const newSession = (cid: string): Session => ({
    cid,
    issued: now(),
    expires: now() + SESSION_MS,
    csrf: randomBytes(24).toString('base64url'),
    stepup: now(),
  });

  // ---- headers (every response) ----
  app.use('*', async (c, next) => {
    await next();
    const h = c.res.headers;
    h.set(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        // CodeMirror (style-mod) injects <style> elements at runtime
        "style-src 'self' 'unsafe-inline'",
        "connect-src 'self'",
        "img-src 'self' https://*.githubusercontent.com https://github.com",
        "media-src 'self' https://*.githubusercontent.com",
        "frame-ancestors 'none'",
        "base-uri 'none'",
        "form-action 'self' https://github.com",
      ].join('; '),
    );
    if (env.secureCookies)
      h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    h.set('X-Content-Type-Options', 'nosniff');
    h.set('Referrer-Policy', 'no-referrer');
    h.set('Cache-Control', 'no-store');
  });

  // Log route/status only. Never bodies, cookies or tokens.
  app.use('*', async (c, next) => {
    await next();
    if (!env.dev || process.env.SPECAGE_LOG)
      console.log(`${c.req.method} ${new URL(c.req.url).pathname} ${c.res.status}`);
  });

  // ---- CSRF: Origin + custom header on every non-GET; session token on authenticated routes ----
  app.use('*', async (c, next) => {
    const m = c.req.method;
    if (m === 'GET' || m === 'HEAD') return next();
    if (c.req.header('origin') !== env.publicUrl) return c.json({ error: 'bad origin' }, 403);
    if (c.req.header('x-specage') !== '1')
      return c.json({ error: 'missing X-Specage header' }, 403);
    const p = new URL(c.req.url).pathname;
    const sessionBound = p.startsWith('/api/') || ['/auth/logout', '/auth/device/link'].includes(p);
    if (sessionBound) {
      const s = getSession(c);
      if (s && !safeEqual(c.req.header('x-csrf-token') ?? '', s.csrf))
        return c.json({ error: 'bad csrf token' }, 403);
    }
    return next();
  });

  const requireSession = async (c: Context, next: Next) => {
    const s = getSession(c);
    if (!s) return c.json({ error: 'unauthenticated' }, 401);
    c.set('session' as never, s as never);
    return next();
  };
  const sess = (c: Context) => c.get('session' as never) as Session;
  const requireStepUp = (c: Context): Response | null =>
    now() - sess(c).stepup > STEPUP_MS ? c.json({ error: 'step-up required' }, 403) : null;

  app.get('/healthz', (c) => c.text('ok'));

  // ---- sign-up gated by the owner's SSH key ----
  app.get('/signup', (c) => {
    if (db.credCount() > 0) return c.notFound();
    if (!(c.req.header('accept') ?? '').includes('application/json')) return serveIndex(c);
    const ch: SignupChallenge = {
      purpose: SIGNUP_PURPOSE,
      host: env.host,
      nonce: randomBytes(32).toString('hex'),
      expires: new Date(now() + WINDOW_MS).toISOString(),
    };
    const text = challengeText(ch);
    put(c, 'specage_signup', { text }, WINDOW_MS / 1000);
    return c.json({
      challenge: text,
      namespace: signupNamespace(env.host),
      command: `ssh-keygen -Y sign -f ~/.ssh/id_ed25519 -n ${signupNamespace(env.host)} challenge.txt`,
    });
  });

  app.post('/auth/signup/verify', async (c) => {
    if (db.credCount() > 0) return c.notFound();
    const body = await c.req.json().catch(() => ({}));
    const st = take<{ text: string }>(c, 'specage_signup');
    const ch = st && parseChallenge(st.text);
    const fail = (m: string) => {
      db.audit('signup', null, `fail: ${m}`);
      return c.json({ error: m }, 400);
    };
    if (!st || !ch) return fail('no challenge (load /signup first)');
    if (ch.host !== env.host) return fail('wrong host');
    if (Date.parse(ch.expires) < now()) return fail('challenge expired');
    if (db.nonceUsed(ch.nonce)) return fail('challenge already used');
    try {
      verifySshsig({
        armored: String(body.signature ?? ''),
        message: st.text,
        namespace: signupNamespace(env.host),
        ownerPubkey: env.ownerPubkey,
      });
    } catch (e) {
      return fail(e instanceof SshsigError ? e.message : 'bad signature');
    }
    if (!db.consumeNonce(ch.nonce)) return fail('challenge already used');
    deleteCookie(c, 'specage_signup', { path: '/' });
    put(c, 'specage_reg', { mode: 'signup', exp: now() + WINDOW_MS }, WINDOW_MS / 1000);
    db.audit('signup', null, 'owner key verified');
    return c.json({ ok: true });
  });

  // ---- passkey registration (signup window or add-device link) ----
  const regWindow = (c: Context): { mode: 'signup' | 'device' } | null => {
    const r = take<{ mode: 'signup' | 'device'; exp: number }>(c, 'specage_reg');
    if (!r || r.exp < now()) return null;
    if (r.mode === 'signup' && db.credCount() > 0) return null;
    return r;
  };

  app.post('/auth/register/options', async (c) => {
    if (!regWindow(c)) return c.json({ error: 'registration not open' }, 403);
    const opts = await generateRegistrationOptions({
      rpName,
      rpID,
      userName: 'owner',
      userID,
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
      excludeCredentials: db.creds().map((x) => ({ id: x.id })),
    });
    put(
      c,
      'specage_wa',
      { challenge: opts.challenge, purpose: 'register', exp: now() + WINDOW_MS },
      WINDOW_MS / 1000,
    );
    return c.json(opts);
  });

  app.post('/auth/register/verify', async (c) => {
    const w = regWindow(c);
    const wa = take<{ challenge: string; purpose: string; exp: number }>(c, 'specage_wa');
    if (!w || !wa || wa.purpose !== 'register' || wa.exp < now())
      return c.json({ error: 'registration not open' }, 403);
    const body = await c.req.json().catch(() => ({}));
    let v;
    try {
      v = await verifyRegistrationResponse({
        response: body.response,
        expectedChallenge: wa.challenge,
        expectedOrigin: env.publicUrl,
        expectedRPID: rpID,
        requireUserVerification: true,
      });
    } catch (e: any) {
      db.audit('register', null, `fail: ${e.message}`);
      return c.json({ error: 'registration failed' }, 400);
    }
    if (!v.verified || !v.registrationInfo) return c.json({ error: 'registration failed' }, 400);
    const info = v.registrationInfo;
    // one passkey only for the owner-key window; re-check atomically with the insert
    const insert = db.raw.transaction(() => {
      if (w.mode === 'signup' && db.credCount() > 0) throw new Error('already registered');
      db.addCred({
        id: info.credential.id,
        public_key: Buffer.from(info.credential.publicKey),
        counter: info.credential.counter,
        transports: JSON.stringify(info.credential.transports ?? []),
        created: now(),
        label:
          String(body.label ?? '').slice(0, 60) ||
          (w.mode === 'signup' ? 'first passkey' : 'device'),
      });
    });
    try {
      insert();
    } catch {
      return c.json({ error: 'registration closed' }, 403);
    }
    deleteCookie(c, 'specage_reg', { path: '/' });
    deleteCookie(c, 'specage_wa', { path: '/' });
    setSession(c, newSession(info.credential.id));
    db.audit('register', null, w.mode);
    return c.json({ ok: true });
  });

  // ---- login / step-up ----
  app.post('/auth/login/options', async (c) => {
    const creds = db.creds();
    if (!creds.length) return c.json({ error: 'no passkeys registered' }, 404);
    const opts = await generateAuthenticationOptions({
      rpID,
      userVerification: 'required',
      allowCredentials: creds.map((x) => ({ id: x.id })),
    });
    put(
      c,
      'specage_wa',
      { challenge: opts.challenge, purpose: 'login', exp: now() + WINDOW_MS },
      WINDOW_MS / 1000,
    );
    return c.json(opts);
  });

  app.post('/auth/login/verify', async (c) => {
    const wa = take<{ challenge: string; purpose: string; exp: number }>(c, 'specage_wa');
    if (!wa || wa.purpose !== 'login' || wa.exp < now())
      return c.json({ error: 'no login in progress' }, 400);
    const body = await c.req.json().catch(() => ({}));
    const row = db.cred(String(body.response?.id ?? ''));
    if (!row) return c.json({ error: 'unknown credential' }, 401);
    try {
      const v = await verifyAuthenticationResponse({
        response: body.response,
        expectedChallenge: wa.challenge,
        expectedOrigin: env.publicUrl,
        expectedRPID: rpID,
        requireUserVerification: true,
        // the library rejects a counter regression whenever either side is non-zero
        credential: {
          id: row.id,
          publicKey: new Uint8Array(row.public_key),
          counter: row.counter,
          transports: JSON.parse(row.transports ?? '[]'),
        },
      });
      if (!v.verified) throw new Error('not verified');
      db.touchCred(row.id, v.authenticationInfo.newCounter);
    } catch (e: any) {
      db.audit('login', null, `fail: ${e.message}`);
      return c.json({ error: 'login failed' }, 401);
    }
    deleteCookie(c, 'specage_wa', { path: '/' });
    const cur = getSession(c);
    const s = cur && cur.cid === row.id ? { ...cur, stepup: now() } : newSession(row.id);
    setSession(c, s);
    db.audit('login', null, 'ok');
    return c.json({ ok: true, csrf: s.csrf });
  });

  app.post('/auth/logout', (c) => {
    deleteCookie(c, 'specage_session', { path: '/' });
    return c.json({ ok: true });
  });

  // ---- add a device: link minted from a fresh session, redeemed on the new device ----
  app.post('/auth/device/link', requireSession, (c) => {
    const bad = requireStepUp(c);
    if (bad) return bad;
    const token = randomBytes(32).toString('base64url');
    db.addLink(createHash('sha256').update(token).digest('hex'), now() + LINK_MS);
    db.audit('device-link', null, 'minted');
    return c.json({ url: `${env.publicUrl}/add-device#${token}`, expires_in: LINK_MS / 1000 });
  });

  app.post('/auth/device/redeem', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const h = createHash('sha256')
      .update(String(body.token ?? ''))
      .digest('hex');
    if (!db.useLink(h)) return c.json({ error: 'link invalid, used or expired' }, 403);
    put(c, 'specage_reg', { mode: 'device', exp: now() + WINDOW_MS }, WINDOW_MS / 1000);
    return c.json({ ok: true });
  });

  // ---- API ----
  app.use('/api/*', requireSession);

  app.get('/api/me', (c) => {
    const s = sess(c);
    return c.json({
      label: db.cred(s.cid)?.label,
      expires: s.expires,
      csrf: s.csrf,
      stepup_valid_until: s.stepup + STEPUP_MS,
    });
  });

  app.get('/api/credentials', (c) =>
    c.json(
      db
        .creds()
        .map((x) => ({ id: x.id, label: x.label, created: x.created, last_used: x.last_used })),
    ),
  );

  app.delete('/api/credentials/:id', (c) => {
    const bad = requireStepUp(c);
    if (bad) return bad;
    if (db.credCount() <= 1) return c.json({ error: 'cannot delete the last passkey' }, 409);
    db.delCred(c.req.param('id'));
    db.audit('credential-delete', null, 'ok');
    return c.json({ ok: true });
  });

  // the UI lists project repos; each maps to specages/<repo-name>/{spec,trail} in the data repo
  app.get('/api/repos', async (c) => {
    const out: string[] = [];
    for (const p of await github.listProjects()) {
      const cfgText = await github.getFile('.specage/config.yaml', specBranch(p));
      if (cfgText === null) continue;
      const cfg = ConfigSchema.safeParse(YAML.parse(cfgText));
      if (cfg.success) out.push(cfg.data.repo ?? p);
    }
    return c.json(out);
  });

  // everything under /api/r/:owner/:repo: validated names, App installed on the data repo,
  // spec branch specages/<repo>/spec configured and claiming this project repo
  app.use('/api/r/:owner/:repo/*', async (c, next) => {
    const { owner, repo } = c.req.param();
    if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo))
      return c.json({ error: 'bad repo' }, 400);
    try {
      await github.assertInstalled();
      const cfgText = await github.getFile('.specage/config.yaml', specBranch(repo));
      if (cfgText === null) return c.json({ error: 'repo is not specage-enabled' }, 404);
      const cfg = ConfigSchema.safeParse(YAML.parse(cfgText));
      if (!cfg.success) return c.json({ error: 'invalid .specage/config.yaml' }, 422);
      if (cfg.data.repo && cfg.data.repo !== `${owner}/${repo}`)
        return c.json({ error: 'repo is not specage-enabled' }, 404);
      c.set('cfg' as never, cfg.data as never);
    } catch (e) {
      if (e instanceof NotFound)
        return c.json({ error: 'specage App is not installed on the data repo' }, 404);
      throw e;
    }
    return next();
  });
  const cfgOf = (c: Context) => c.get('cfg' as never) as ReturnType<typeof ConfigSchema.parse>;

  app.get('/api/r/:owner/:repo/spec', async (c) => {
    const { repo } = c.req.param();
    const path = cfgOf(c).spec_file;
    const head = await github.getRef(`heads/${specBranch(repo)}`);
    const content = head && (await github.getFile(path, specBranch(repo)));
    if (!head || content === null) return c.json({ error: 'spec file not found' }, 404);
    return c.json({ content, head_sha: head, path });
  });

  app.get('/api/r/:owner/:repo/state', async (c) => {
    const { repo } = c.req.param();
    const f = async (p: string) => {
      const t = await github.getFile(p, trailBranch(repo));
      return t === null ? undefined : parseYaml(t);
    };
    const { state } = parseState({
      trace: await f('trace.yaml'),
      work: await f('work.yaml'),
      questions: await f('questions.yaml'),
    });
    return c.json({ ...state, report: null });
  });

  const rateLimit = (c: Context): Response | null => {
    const s = sess(c);
    const k = `${s.cid}:${s.issued}`;
    const recent = (writes.get(k) ?? []).filter((t) => t > now() - 3600_000);
    if (recent.length >= WRITES_PER_HOUR)
      return c.json({ error: 'rate limit: 60 writes/hour' }, 429);
    recent.push(now());
    writes.set(k, recent);
    return null;
  };

  app.put('/api/r/:owner/:repo/spec', async (c) => {
    const { owner, repo } = c.req.param();
    const limited = rateLimit(c);
    if (limited) return limited;
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.content !== 'string' || typeof body.base_sha !== 'string')
      return c.json({ error: 'content and base_sha required' }, 400);
    if (body.content.length > 1_000_000) return c.json({ error: 'too large' }, 413);
    const path = cfgOf(c).spec_file;
    const spec = parse(body.content);
    let retired: string[] = [];
    try {
      const t = await github.getFile('trace.yaml', trailBranch(repo));
      if (t) retired = parseState({ trace: parseYaml(t) }).state.trace.retired_ids;
    } catch {
      /* state is advisory for lint */
    }
    const diags = lint(spec, { retiredIds: retired });
    if (hasErrors(diags)) {
      db.audit('save', `${owner}/${repo}`, '422');
      return c.json({ diagnostics: diags }, 422);
    }
    const head = await github.getRef(`heads/${specBranch(repo)}`);
    const remote = (await github.getFile(path, specBranch(repo))) ?? '';
    if (head !== body.base_sha) {
      db.audit('save', `${owner}/${repo}`, '409');
      return c.json({ error: 'conflict', head_sha: head, content: remote }, 409);
    }
    const d = diff(parse(remote), spec);
    const ids = d.entries
      .flatMap((e) => ('ids' in e ? e.ids : 'id' in e ? [e.id] : []))
      .slice(0, 3);
    const message = `spec: ${ids.length ? ids.join(', ') : 'update'}${d.entries.length > 3 ? ` (+${d.entries.length - 3} more)` : ''}`;
    try {
      const sha = await github.commitSpec(repo, {
        path,
        content: body.content,
        message,
        parentSha: head!,
      });
      db.audit('save', `${owner}/${repo}`, 'ok');
      return c.json({ head_sha: sha, diagnostics: diags });
    } catch (e) {
      if (e instanceof Conflict) {
        db.audit('save', `${owner}/${repo}`, '409');
        return c.json(
          {
            error: 'conflict',
            head_sha: await github.getRef(`heads/${specBranch(repo)}`),
            content: (await github.getFile(path, specBranch(repo))) ?? '',
          },
          409,
        );
      }
      throw e;
    }
  });

  app.get('/api/r/:owner/:repo/dispatch/preview', async (c) => {
    const { repo } = c.req.param();
    const path = cfgOf(c).spec_file;
    const head = await github.getRef(`heads/${specBranch(repo)}`);
    const headText = head ? await github.getFile(path, specBranch(repo)) : null;
    if (!head || headText === null) return c.json({ error: 'spec file not found' }, 404);
    const cursor = await github.getCursor(repo);
    const old = cursor ? await github.getFile(path, cursor) : null;
    const d = diff(old === null ? { roots: [], diagnostics: [] } : parse(old), parse(headText));
    return c.json({ cursor, head_sha: head, diff: d, nodes: flatten(parse(headText)).length });
  });

  // ---- project init (owner session; the App installation token does the work) ----
  const initEnv = {
    dataRepo: env.dataRepo,
    internRepo: env.internRepo,
    uiUrl: env.publicUrl,
  };
  const initError = (c: Context, e: unknown) => {
    if (e instanceof BadInit) return c.json({ error: e.message }, 400);
    if (e instanceof PermissionError) return c.json({ error: e.message }, 403);
    throw e;
  };
  app.get('/api/init/repos', async (c) => {
    try {
      await github.assertInstalled();
      const taken = new Set(await github.listProjects());
      const repos = (await github.listInstallationRepos())
        .filter((r) => r.full_name !== env.dataRepo)
        .map((r) => ({
          repo: r.full_name,
          private: r.private,
          initialised: taken.has(r.full_name.split('/')[1]),
        }));
      return c.json(repos);
    } catch (e) {
      if (e instanceof NotFound)
        return c.json({ error: 'specage App is not installed on the data repo' }, 404);
      return initError(c, e);
    }
  });
  app.post('/api/init/preview', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'json body required' }, 400);
    try {
      return c.json(await planInit(github, initEnv, body));
    } catch (e) {
      return initError(c, e);
    }
  });
  app.post('/api/init', async (c) => {
    const limited = rateLimit(c);
    if (limited) return limited;
    const bad = requireStepUp(c);
    if (bad) return bad;
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'json body required' }, 400);
    try {
      const plan = await runInit(github, initEnv, body);
      db.audit('init', plan.repo, 'ok');
      return c.json(plan);
    } catch (e) {
      db.audit('init', String(body.repo ?? ''), 'fail');
      return initError(c, e);
    }
  });

  // ---- SPA ----
  const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.map': 'application/json',
  };
  function serveIndex(c: Context) {
    const p = join(env.webDist, 'index.html');
    if (!existsSync(p)) return c.text('web build missing', 503);
    // the build uses relative asset URLs (for GitHub Pages); make them absolute for nested routes like /r/o/r
    return c.body(readFileSync(p, 'utf8').replaceAll('="./assets/', '="/assets/'), 200, {
      'Content-Type': MIME['.html'],
    });
  }
  app.get('*', (c) => {
    const path = new URL(c.req.url).pathname;
    if (path.startsWith('/api/') || path.startsWith('/auth/'))
      return c.json({ error: 'not found' }, 404);
    const rel = normalize(decodeURIComponent(path)).replace(/^([/\\]|\.\.)+/g, '');
    const file = join(env.webDist, rel);
    if (rel && file.startsWith(env.webDist) && existsSync(file) && statSync(file).isFile())
      return c.body(readFileSync(file), 200, {
        'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': 'public, max-age=300',
      });
    return serveIndex(c);
  });

  app.onError((e, c) => {
    console.error(`error ${c.req.method} ${new URL(c.req.url).pathname}: ${e.message}`);
    return c.json({ error: 'internal error' }, 500);
  });
  return app;
}
