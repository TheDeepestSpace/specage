import { describe, expect, it } from 'vitest';
import { diagRange } from '../src/analysis.js';

const base = { code: 'W109', level: 'warn' as const, message: 'm' };

describe('diagRange', () => {
  it('maps range to offsets', () => {
    const text = 'ab\n' + 'a'.repeat(105);
    expect(diagRange(text, { ...base, line: 2, column: 101, endLine: 2, endColumn: 106 })).toEqual({
      from: 3 + 100,
      to: text.length,
    });
  });
  it('handles astral code points', () => {
    const text = '😀'.repeat(102);
    expect(diagRange(text, { ...base, line: 1, column: 101, endLine: 1, endColumn: 103 })).toEqual({
      from: 200,
      to: 204,
    });
  });
  it('falls back to 60 chars without end', () => {
    const text = 'a'.repeat(200);
    expect(diagRange(text, { ...base, line: 1, column: 1 })).toEqual({ from: 0, to: 60 });
  });
});
