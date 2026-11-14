import { describe, expect, it } from 'vitest';
import { extractWords, misspellings } from '../src/spellcheck.js';

const words = (t: string) => extractWords(t).map((w) => w.word);
const fake = { correct: (w: string) => w !== 'teh' && w !== 'wrold' };

describe('extractWords', () => {
  it('extracts prose words with offsets', () => {
    const t = 'hello teh world';
    const w = extractWords(t);
    expect(w.map((x) => x.word)).toEqual(['hello', 'teh', 'world']);
    expect(t.slice(w[1].from, w[1].to)).toBe('teh');
  });
  it('skips ids, refs, markers and escapes', () => {
    expect(
      words('@s-abc1234 <- s-xyzzy { !constraint foo: must teh \\{ $some.reff; ? ask }'),
    ).toEqual(['must', 'teh', 'ask']);
    expect(words('@qwxz must $zzyx')).toEqual(['must']);
  });
  it('skips identifier-like, acronyms and camelCase', () => {
    expect(words("abc123 foo_bar API fooBar a it's")).toEqual(["it's"]);
  });
  it('checks comments', () => {
    expect(words('x # teh comment')).toContain('teh');
  });
});

describe('misspellings', () => {
  it('returns only incorrect words', () => {
    expect(misspellings('teh good wrold', fake).map((w) => w.word)).toEqual(['teh', 'wrold']);
  });
});
