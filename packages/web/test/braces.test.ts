import { describe, expect, it } from 'vitest';
import { scanBraces } from '../src/braces.js';

const at = (t: string) => scanBraces(t).map((b) => b.at);

describe('scanBraces', () => {
  it('colours nested pairs by depth and flags a stray }', () => {
    expect(scanBraces('{ { } } }').map((b) => b.depth)).toEqual([0, 1, 1, 0, -1]);
  });
  it('ignores escaped \\{ and \\}', () => {
    expect(at('a \\{ b \\} c')).toEqual([]);
    expect(scanBraces('{ \\{ }').map((b) => b.depth)).toEqual([0, 0]);
  });
  it('ignores braces inside # comments', () => {
    expect(at('# { open\n{ x }')).toEqual([9, 13]);
    expect(at('{ a # } not a close\n}')).toEqual([0, 20]);
  });
  it('a # not preceded by whitespace is not a comment', () => {
    expect(at('a#{ }')).toEqual([2, 4]);
    expect(at('\\# { }')).toEqual([3, 5]);
  });
});
