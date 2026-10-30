import { createHash, createSign, generateKeyPairSync, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import type { Env } from '../src/env.js';
import { Conflict, NotFound, type GitHub } from '../src/github.js';

// ---- minimal CBOR (maps, bytes, text, ints) ----
function cbor(v: any): Buffer {
  const head = (major: number, n: number) => {
    if (n < 24) return Buffer.from([(major << 5) | n]);
    if (n < 256) return Buffer.from([(major << 5) | 24, n]);
    return Buffer.from([(major << 5) | 25, n >> 8, n & 255]);
  };
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (typeof v === 'string') { const b = Buffer.from(v); return Buffer.concat([head(3, b.length), b]); }
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  const entries = Object.entries(v);
  return Buffer.concat([head(5, entries.length), ...entries.flatMap(([k, x]) => [cbor(/^-?\d+$/.test(k) ? Number(k) : k), cbor(x)])]);
}

const b64u = (b: Buffer) => b.toString('base64url');

export class SoftAuthenticator {
  keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  credId = randomBytes(16);
  counter = 0;
  constructor(private origin: string, private rpId: string) {}

  private clientData(type: string, challenge: string) {
    return Buffer.from(JSON.stringify({ type, challenge, origin: this.origin, crossOrigin: false }));
  }

  create(options: any) {
    const jwk = this.keys.publicKey.export({ format: 'jwk' }) as any;
    const cose = cbor({ 1: 2, 3: -7, '-1': 1, '-2': Buffer.from(jwk.x, 'base64url'), '-3': Buffer.from(jwk.y, 'base64url') });
    const idLen = Buffer.alloc(2); idLen.writeUInt16BE(this.credId.length);
    const cnt = Buffer.alloc(4); cnt.writeUInt32BE(this.counter);
    const authData = Buffer.concat([createHash('sha256').update(this.rpId).digest(), Buffer.from([0x45]), cnt, Buffer.alloc(16), idLen, this.credId, cose]);
    const attestationObject = cbor({ fmt: 'none', attStmt: {}, authData });
    return {
      id: b64u(this.credId), rawId: b64u(this.credId), type: 'public-key', clientExtensionResults: {},
      response: { clientDataJSON: b64u(this.clientData('webauthn.create', options.challenge)), attestationObject: b64u(attestationObject), transports: ['internal'] },
    };
  }

  get(options: any, counter?: number) {
    this.counter = counter ?? this.counter + 1;
    const cnt = Buffer.alloc(4); cnt.writeUInt32BE(this.counter);
    const authData = Buffer.concat([createHash('sha256').update(this.rpId).digest(), Buffer.from([0x05]), cnt]);
    const cd = this.clientData('webauthn.get', options.challenge);
    const sig = createSign('SHA256').update(Buffer.concat([authData, createHash('sha256').update(cd).digest()])).sign(this.keys.privateKey);
    return {
      id: b64u(this.credId), rawId: b64u(this.credId), type: 'public-key', clientExtensionResults: {},
      response: { clientDataJSON: b64u(cd), authenticatorData: b64u(authData), signature: b64u(sig) },
    };
  }
}

// ---- SSH keys via the real ssh-keygen ----
export function sshKey() {
  const dir = mkdtempSync(join(tmpdir(), 'specage-ssh-'));
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', join(dir, 'k')]);
  return {
    dir,
    pub: readFileSync(join(dir, 'k.pub'), 'utf8').trim(),
    sign(message: string, ns: string): string {
      const f = join(dir, `m-${randomBytes(4).toString('hex')}`);
      writeFileSync(f, message);
      execFileSync('ssh-keygen', ['-Y', 'sign', '-f', join(dir, 'k'), '-n', ns, f]);
      return readFileSync(`${f}.sig`, 'utf8');
    },
  };
}

// ---- in-memory GitHub ----
export const SPEC0 = 'Shoot a burst @shoot.burst;\nLimit magazine @shoot.cap;\n';
export class FakeGitHub implements GitHub {
  installed = new Set(['o/r']);
  commits: { sha: string; spec: string }[] = [{ sha: sha(0), spec: SPEC0 }];
  tags = new Map<string, { sha: string }>();
  files: Record<string, string> = {
    'spec:.specage/config.yaml': 'specage_version: v0\nproject: r\nspec_file: r.specage\nreviewer: o\nintern: {repo: o/the-intern}\npages: {mode: off, path: specage}\n',
    'spec-state:trace.yaml': 'retired_ids: [old.id]\nnodes:\n  shoot.burst: {spec_hash: 000000000000, status: implemented, evidence: []}\n',
  };
  calls: string[] = [];
  head() { return this.commits[this.commits.length - 1]; }
  async listEnabledRepos() { return ['o/r']; }
  async assertInstalled(o: string, r: string) { if (!this.installed.has(`${o}/${r}`)) throw new NotFound('x'); }
  async getFile(o: string, r: string, path: string, ref: string) {
    this.calls.push(`getFile ${path}@${ref}`);
    if (ref === 'spec' && path === 'r.specage') return this.head().spec;
    if (ref.startsWith('dispatch/') && path === 'r.specage') return this.commits.find((c) => c.sha === this.tags.get(ref)!.sha)!.spec;
    return this.files[`${ref}:${path}`] ?? null;
  }
  async getRef(_o: string, _r: string, ref: string) { return ref === 'heads/spec' ? this.head().sha : null; }
  async listDispatchTags() { return [...this.tags.keys()].sort(); }
  async commitSpec(_o: string, _r: string, o: { content: string; parentSha: string; message: string }) {
    if (o.parentSha !== this.head().sha) throw new Conflict('moved');
    this.lastMessage = o.message;
    this.commits.push({ sha: sha(this.commits.length), spec: o.content });
    return this.head().sha;
  }
  lastMessage = '';
  async createTag(_o: string, _r: string, tag: string, s: string) {
    if (this.tags.has(tag)) throw new Conflict('exists');
    this.tags.set(tag, { sha: s });
  }
}
const sha = (n: number) => n.toString(16).padStart(40, '0');

export const ORIGIN = 'https://specage.test';
export function testEnv(ownerPubkey: string): Env {
  return {
    nodeEnv: 'test', dev: false, port: 0, publicUrl: ORIGIN, host: 'specage.test', secureCookies: true,
    sessionSecret: Buffer.alloc(32, 9), ownerPubkey, authorName: 'Owner', authorEmail: 'o@example.com', dbPath: ':memory:', webDist: '/nonexistent',
  };
}

export function harness(opts: { now?: () => number } = {}) {
  const key = sshKey();
  const env = testEnv(key.pub);
  const db = openDb(':memory:');
  const github = new FakeGitHub();
  const app = createApp({ env, db, github, now: opts.now });
  const jar = new Map<string, string>();
  let csrf = '';
  const client = {
    app, env, db, github, key, jar,
    get csrf() { return csrf; },
    set csrf(v: string) { csrf = v; },
    async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
      const h: Record<string, string> = { origin: ORIGIN, 'x-specage': '1', ...headers };
      if (csrf && !('x-csrf-token' in h)) h['x-csrf-token'] = csrf;
      if (body !== undefined) h['content-type'] = 'application/json';
      if (jar.size) h.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
      const res = await app.request(path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
      for (const sc of res.headers.getSetCookie()) {
        const [kv, ...attrs] = sc.split('; ');
        const i = kv.indexOf('=');
        const val = kv.slice(i + 1);
        if (!val || attrs.some((a) => a.toLowerCase() === 'max-age=0')) jar.delete(kv.slice(0, i));
        else jar.set(kv.slice(0, i), val);
      }
      return res;
    },
    async signup(auth: SoftAuthenticator, label = 'test') {
      const ch = (await (await client.req('GET', '/signup', undefined, { accept: 'application/json' })).json()) as any;
      const sig = key.sign(ch.challenge, ch.namespace);
      const v = await client.req('POST', '/auth/signup/verify', { signature: sig });
      if (v.status !== 200) return v;
      const opts = await (await client.req('POST', '/auth/register/options', {})).json();
      const r = await client.req('POST', '/auth/register/verify', { response: auth.create(opts), label });
      if (r.status === 200) csrf = ((await (await client.req('GET', '/api/me')).json()) as any).csrf;
      return r;
    },
    async login(auth: SoftAuthenticator, counter?: number) {
      const opts = await (await client.req('POST', '/auth/login/options', {})).json();
      const r = await client.req('POST', '/auth/login/verify', { response: auth.get(opts, counter) });
      if (r.status === 200) csrf = ((await r.json()) as any).csrf;
      return r;
    },
  };
  return client;
}
