import { describe, expect, it } from 'vitest';
import { badges, impTabs, parseRef } from '../src/traces.js';

const sha = 'a'.repeat(40);
const ev = (kind: string, ref: string, commit: string | null = sha) => ({
  kind,
  ref,
  commit: commit ?? undefined,
});

describe('traces', () => {
  it('parses line ranges', () => {
    expect(parseRef('a/b.ts#L3-L9')).toEqual({ path: 'a/b.ts', range: [3, 9] });
    expect(parseRef('a.ts#12')).toEqual({ path: 'a.ts', range: [12, 12] });
    expect(parseRef('a.ts')).toEqual({ path: 'a.ts', range: null });
  });
  it('groups code evidence per file and merges ranges', () => {
    const t = impTabs([
      ev('code', 'a.ts#L1-L2'),
      ev('code', 'a.ts#L8'),
      ev('code', 'b.ts'),
      ev('code', 'a.ts', 'b'.repeat(40)),
      ev('code', 'nopin.ts', null),
      ev('test', 't.ts'),
    ]);
    expect(t.map((x) => x.path)).toEqual(['a.ts', 'b.ts', 'a.ts']);
    expect(t[0].ranges).toEqual([
      [1, 2],
      [8, 8],
    ]);
    expect(t[1].ranges).toEqual([]);
  });
  it('badges only when matching evidence exists', () => {
    expect(badges([])).toEqual({ imp: false, prf: false });
    expect(badges([ev('code', 'a'), ev('pr', '3')])).toEqual({ imp: true, prf: false });
    expect(badges([ev('test', 't'), ev('screenshot', 's.png')])).toEqual({ imp: false, prf: true });
  });
});
