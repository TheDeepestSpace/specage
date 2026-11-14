import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Evidence } from '@specage/core/browser';

let fileUrl: typeof import('../src/evidence.js').fileUrl;
beforeAll(async () => {
  vi.stubGlobal('location', new URL('https://specage.example/'));
  ({ fileUrl } = await import('../src/evidence.js'));
});

const repo = 'o/r';
const ev = (ref: string, commit: string | null = 'abc123'): Evidence =>
  ({ kind: 'code', ref, commit: commit ?? undefined }) as Evidence;
const base = 'https://github.com/o/r/blob/abc123/';

describe('fileUrl', () => {
  it('plain path', () => {
    expect(fileUrl(repo, ev('src/dir/a.ts'))).toBe(base + 'src/dir/a.ts');
    expect(fileUrl(repo, ev('src/a.ts'))).toBe(base + 'src/a.ts');
  });
  it('keeps #Lnn and ranges', () => {
    expect(fileUrl(repo, ev('src/a.ts#L10'))).toBe(base + 'src/a.ts#L10');
    expect(fileUrl(repo, ev('src/a.ts#L10-L20'))).toBe(base + 'src/a.ts#L10-L20');
  });
  it('drops test-name fragments', () => {
    expect(fileUrl(repo, ev('test/x.test.ts#test name with spaces: x'))).toBe(
      base + 'test/x.test.ts',
    );
  });
  it('links only the leading path when prose follows', () => {
    expect(fileUrl(repo, ev('src/a.ts (legacy note)'))).toBe(base + 'src/a.ts');
  });
  it('raw ignores fragment', () => {
    expect(fileUrl(repo, ev('img/a.png#L3'), true)).toBe(
      'https://github.com/o/r/raw/abc123/img/a.png',
    );
  });
  it('no commit: no link', () => {
    expect(fileUrl(repo, ev('src/a.ts', null))).toBeNull();
  });
});
