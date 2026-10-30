import { createHash } from 'node:crypto';

export function sha12(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 12);
}

export function normalize(s: string): string {
  return s.normalize('NFC').replace(/\s+/g, ' ').trim();
}
