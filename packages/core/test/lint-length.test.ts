import { describe, expect, it } from 'vitest';
import { lint, parse } from '../src/index.js';

const w109 = (src: string) => lint(parse(src), { source: src }).filter((d) => d.code === 'W109');

describe('W109 line longer than 100 symbols', () => {
  it('no lint at 100 or fewer', () => {
    expect(w109('a'.repeat(100))).toEqual([]);
    expect(w109('a'.repeat(99))).toEqual([]);
  });
  it('101 chars: range is column 101 only', () => {
    const d = w109('x\n' + 'a'.repeat(101));
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ line: 2, column: 101, endLine: 2, endColumn: 102, level: 'warn' });
  });
  it('250 chars: range 101..250', () => {
    const d = w109('a'.repeat(250));
    expect(d[0]).toMatchObject({ line: 1, column: 101, endLine: 1, endColumn: 251 });
    expect(d[0].message).toBeTruthy();
  });
  it('counts code points, not UTF-16 units', () => {
    expect(w109('😀'.repeat(100))).toEqual([]);
    expect(w109('😀'.repeat(101))[0]).toMatchObject({ column: 101, endColumn: 102 });
  });
  it('without source no line lint; other lints get ranges', () => {
    expect(lint(parse('a'.repeat(300))).filter((d) => d.code === 'W109')).toEqual([]);
    const ds = lint(parse('a @x: one\nb @x: two'));
    expect(ds.length).toBeGreaterThan(0);
    for (const d of ds) {
      expect(d.endLine).toBeGreaterThanOrEqual(d.line);
      expect(d.endColumn).toBeGreaterThan(0);
    }
  });
});
