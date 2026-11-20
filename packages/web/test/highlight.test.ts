import { describe, expect, it } from 'vitest';
import { specSegments } from '../src/highlight.js';

describe('specSegments', () => {
  it('tokenises ids, refs, markers, escapes, comments', () => {
    const segs = specSegments('!constraint: see $a.b and \\; # note');
    const by = (c: string) => segs.filter((s) => s.cls === c).map((s) => s.text);
    expect(by('cm-spec-marker')).toEqual(['!constraint:']);
    expect(by('cm-spec-ref')).toEqual(['$a.b']);
    expect(by('cm-spec-escape')).toEqual(['\\;']);
    expect(by('cm-spec-comment')).toEqual(['# note']);
    expect(segs.map((s) => s.text).join('')).toBe('!constraint: see $a.b and \\; # note');
  });
  it('tokenises ids', () => {
    expect(specSegments('@foo.bar x').find((s) => s.cls)).toEqual({
      text: '@foo.bar',
      cls: 'cm-spec-id',
    });
  });
});
