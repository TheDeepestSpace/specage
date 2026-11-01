import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

/** AES-256-GCM sealed JSON, base64url(iv | tag | ciphertext). */
export function seal(key: Buffer, value: unknown): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64url');
}

export function unseal<T = any>(key: Buffer, token: string | undefined): T | null {
  if (!token) return null;
  try {
    const b = Buffer.from(token, 'base64url');
    if (b.length < 29) return null;
    const d = createDecipheriv('aes-256-gcm', key, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'));
  } catch {
    return null;
  }
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
