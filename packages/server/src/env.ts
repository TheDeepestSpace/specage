import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Env {
  nodeEnv: string;
  dev: boolean;
  port: number;
  publicUrl: string;
  host: string;
  secureCookies: boolean;
  sessionSecret: Buffer;
  ownerPubkey: string;
  appId?: string;
  appPrivateKey?: string;
  devGithubToken?: string;
  authorName: string;
  authorEmail: string;
  dbPath: string;
  webDist: string;
}

export function loadEnv(e: NodeJS.ProcessEnv = process.env): Env {
  const dev = e.NODE_ENV === 'development';
  if (e.DEV_GITHUB_TOKEN && !dev) throw new Error('DEV_GITHUB_TOKEN is refused unless NODE_ENV=development');
  const need = (k: string, v = e[k]): string => {
    if (!v) throw new Error(`missing env ${k}`);
    return v;
  };
  const port = Number(e.PORT ?? 8080);
  const publicUrl = e.PUBLIC_URL ?? (dev ? `http://localhost:${port}` : need('PUBLIC_URL'));
  const url = new URL(publicUrl);
  const secret = Buffer.from(need('SESSION_SECRET', e.SESSION_SECRET ?? (dev ? Buffer.alloc(32, 7).toString('base64') : undefined)), 'base64');
  if (secret.length !== 32) throw new Error('SESSION_SECRET must be 32 bytes, base64');
  if (!dev && url.protocol !== 'https:') throw new Error('PUBLIC_URL must be https outside development');
  const here = dirname(fileURLToPath(import.meta.url));
  return {
    nodeEnv: e.NODE_ENV ?? 'production',
    dev,
    port,
    publicUrl: url.origin,
    host: url.hostname,
    secureCookies: url.protocol === 'https:',
    sessionSecret: secret,
    ownerPubkey: need('OWNER_PUBKEY'),
    appId: dev ? e.GITHUB_APP_ID : need('GITHUB_APP_ID'),
    appPrivateKey: dev ? e.GITHUB_APP_PRIVATE_KEY : need('GITHUB_APP_PRIVATE_KEY'),
    devGithubToken: e.DEV_GITHUB_TOKEN,
    authorName: e.AUTHOR_NAME ?? 'specage',
    authorEmail: e.AUTHOR_EMAIL ?? 'specage@users.noreply.github.com',
    dbPath: e.DB_PATH ?? (dev ? resolve('specage-dev.db') : '/data/specage.db'),
    webDist: resolve(e.WEB_DIST ?? join(here, '..', '..', 'web', 'dist')),
  };
}
