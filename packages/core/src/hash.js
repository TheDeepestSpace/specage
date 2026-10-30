import { createHash } from 'node:crypto';
export function sha12(s) {
    return createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 12);
}
export function normalize(s) {
    return s.normalize('NFC').replace(/\s+/g, ' ').trim();
}
