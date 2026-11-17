import { describe, expect, it } from 'vitest';
import { flatten, parse } from '../src/index.js';

const byText = (src: string, t: string) => {
  const n = flatten(parse(src)).find((x) => x.text.startsWith(t));
  if (!n) throw new Error('missing ' + t);
  return n;
};

describe('variables', () => {
  it('declaration: @name=<statement>', () => {
    const s = parse('@abc1=hello world;');
    expect(s.diagnostics).toEqual([]);
    const n = s.roots[0];
    expect(n.variable).toBe('abc1');
    expect(n.text).toBe('hello world');
  });

  it('declaration may be a block', () => {
    const s = parse('@v=outer { inner; };');
    expect(s.diagnostics).toEqual([]);
    expect(s.roots[0].variable).toBe('v');
    expect(s.roots[0].children).toHaveLength(1);
  });

  it('@ mid-text and trailing @id stay distinct', () => {
    const s = parse('text @id;\n@x=foo @fid;');
    expect(s.roots[0].variable).toBeUndefined();
    expect(s.roots[0].id).toBe('id');
    expect(s.roots[1].variable).toBe('x');
    expect(s.roots[1].id).toBe('fid');
  });

  it('visible in own scope and child scopes', () => {
    const s = '@v=val; sibling uses $v; blk { child uses $v; deep { d $v; }; };';
    expect(byText(s, 'sibling').varRefs).toEqual(['v']);
    expect(byText(s, 'child').varRefs).toEqual(['v']);
    expect(byText(s, 'd ').varRefs).toEqual(['v']);
  });

  it('not visible in sibling scopes or parents', () => {
    const s = 'a { @v=val; x; }; b { uses $v; }; outside $v;';
    expect(byText(s, 'uses').varRefs).toBeUndefined();
    expect(byText(s, 'outside').varRefs).toBeUndefined();
    expect(byText(s, 'uses').refs).toEqual(['v']);
  });

  it('child declaration shadows; variables win over $id refs', () => {
    const s = parse('@v=a; blk { @v=b; u $v; }; u2 $v; @t=x @v;');
    expect(s.diagnostics).toEqual([]);
    expect(flatten(s).find((n) => n.text === 'u $v')!.varRefs).toEqual(['v']);
    expect(flatten(s).find((n) => n.text === 'u2 $v')!.refs).toEqual([]);
  });

  it('$name without variable stays an id ref; $5/$Home plain text', () => {
    const n = byText('costs $5 and $Home and $foo;', 'costs');
    expect(n.varRefs).toBeUndefined();
    expect(n.refs).toEqual(['foo']);
  });
});
