import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse, lint, diff, flatten, normalize, sha12 } from '../src/index.js';

const fixture = readFileSync(new URL('../../../fixtures/tbgwaf/tbgwaf.specage', import.meta.url), 'utf8');
const codes = (src: string, state?: any) => lint(parse(src), state).map((d) => d.code);

describe('parse', () => {
  it('parses nesting, ids, markers', () => {
    const s = parse('a b @x { c @x.y; !constraint: d @x.z; };');
    expect(s.diagnostics).toEqual([]);
    const [x] = s.roots;
    expect(x.id).toBe('x');
    expect(x.children.map((c) => c.id)).toEqual(['x.y', 'x.z']);
    expect(x.children[1].marker?.name).toBe('constraint');
  });
  it('unescapes and drops comments', () => {
    const s = parse(String.raw`a \; b # gone
 c \@ @x;`);
    expect(s.roots[0].text).toBe('a ; b c @');
  });
  it('hash is whitespace independent and case sensitive', () => {
    expect(parse('a   b\n c @x;').roots[0].hash).toBe(parse('a b c @x;').roots[0].hash);
    expect(parse('A @x;').roots[0].hash).not.toBe(parse('a @x;').roots[0].hash);
    expect(parse('a @x;').roots[0].hash).toBe(sha12(normalize('a')));
  });
  it('subtree hash changes with descendants only', () => {
    const a = parse('p @p { c1 @p.a; c2 @p.b; };').roots[0];
    const b = parse('p @p { c1 @p.a; c2x @p.b; };').roots[0];
    expect(a.hash).toBe(b.hash);
    expect(a.subtreeHash).not.toBe(b.subtreeHash);
  });
  it('fixture parses clean', () => {
    const s = parse(fixture);
    expect(lint(s).filter((d) => d.level === 'error')).toEqual([]);
    expect(flatten(s).length).toBeGreaterThan(15);
  });
});

describe('lint', () => {
  it('E001', () => {
    expect(codes('a @x { b @x.y;')).toContain('E001');
    expect(codes('a @x; }')).toContain('E001');
    expect(codes('a @x')).toContain('E001');
    expect(codes('a # b @x;\n c#d @y;')).toContain('E001');
    expect(codes('a @x { b @x.y; }')).toContain('E001');
  });
  it('E002', () => expect(codes('a b;')).toContain('E002'));
  it('E003', () => expect(codes('a @x; b @x;')).toContain('E003'));
  it('E004', () => expect(codes('a @x;', { retiredIds: ['x'] })).toContain('E004'));
  it('E005', () => {
    expect(codes('!bogus: a @x;')).toContain('E005');
    expect(codes('!constraint: a @x;')).not.toContain('E005');
  });
  it('E006', () => expect(codes('a @x; b @y <- x;')).toContain('E006'));
  it('W101', () => expect(codes('a @p { b @q; };')).toContain('W101'));
  it('W102', () => expect(codes(`${'a'.repeat(300)} @x;`)).toContain('W102'));
  it('W103', () => {
    for (const t of ['see src/game/Weapon.h @x;', 'see https://x.io @x;', String.raw`like \#123 here @x;`])
      expect(codes(t)).toContain('W103');
    expect(codes('this and/or that @x;')).not.toContain('W103');
  });
  it('W104', () => {
    expect(codes('!proof gif: a @x;')).toContain('W104');
    expect(codes('!proof video: a @x;')).not.toContain('W104');
  });
  it('W105', () => expect(codes('a @y <- x;', { consumedLineage: ['y'] })).toContain('W105'));
  it('W106', () => expect(codes('!impl: a @x { b @x.y; };')).toContain('W106'));
});

const d = (a: string, b: string) => diff(parse(a), parse(b));
describe('diff', () => {
  it('self diff empty', () => expect(diff(parse(fixture), parse(fixture)).entries).toEqual([]));
  it('reflow is empty', () => {
    const reflowed = fixture.replace(/(^|\s)#.*$/gm, '').replace(/ (?=[a-z])/g, '\n   ').replace(/(?<!\\);/g, ' ;');
    expect(diff(parse(fixture), parse(reflowed)).entries).toEqual([]);
  });
  it('added/removed/changed', () => {
    const r = d('a @x; b @y;', 'a2 @x; c @z;');
    expect(r.entries.map((e) => e.kind).sort()).toEqual(['added', 'changed', 'removed']);
  });
  it('move only yields moved', () => {
    const r = d('p @p { c @p.c; }; q @q { };', 'p @p { }; q @q { c @p.c; };');
    expect(r.entries.map((e) => e.kind)).toEqual(['moved']);
  });
  it('rename', () => {
    const r = d('t @a.b;', 't @a.c <- a.b;');
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]).toMatchObject({ kind: 'renamed', from: 'a.b', id: 'a.c', text_changed: false });
  });
  it('split', () => {
    const r = d('g @s.g;', 'g1 @s.f <- s.g; g2 @s.r <- s.g;');
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]).toMatchObject({ kind: 'split', from: 's.g', ids: ['s.f', 's.r'] });
  });
  it('merge', () => {
    const r = d('a @s.a; b @s.b;', 'ab @s.ab <- s.a, s.b;');
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]).toMatchObject({ kind: 'merged', from: ['s.a', 's.b'], id: 's.ab' });
  });
  it('suspected_rename', () => {
    const t = 'the quick brown fox jumps over the lazy dog';
    const r = d(`${t} @a;`, `${t}. @b;`);
    expect(r.entries.map((e) => e.kind)).toContain('suspected_rename');
    expect(d('aaa @a;', 'zzz @b;').entries.map((e) => e.kind)).not.toContain('suspected_rename');
  });
  it('subtree_changed', () => {
    const r = d('p @p { c @p.c; }; q @q { d @q.d; };', 'p @p { c2 @p.c; }; q @q { d @q.d; };');
    expect(r.subtree_changed).toEqual(['p']);
  });
  it('empty old spec adds everything', () => {
    const r = diff({ roots: [], diagnostics: [] }, parse(fixture));
    expect(r.entries.every((e) => e.kind === 'added')).toBe(true);
  });
});

import { readdirSync } from 'node:fs';
describe('golden', () => {
  const dir = new URL('../../../fixtures/tbgwaf/', import.meta.url);
  const spec = parse(fixture);
  const json = (f: string) => JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
  it('hash.json', () =>
    expect(Object.fromEntries(flatten(spec).map((n) => [n.id, { hash: n.hash, subtree_hash: n.subtreeHash }]))).toEqual(json('hash.json')));
  it('lint.json', () => expect(JSON.parse(JSON.stringify(lint(spec)))).toEqual(json('lint.json')));
  it('parse.json', () => {
    const strip = (n: any): any => ({
      id: n.id, type: n.type, marker: n.marker, text: n.text, parent: n.parent, lineage: n.lineage,
      line: n.line, children: n.children.map(strip),
    });
    expect(JSON.parse(JSON.stringify(spec.roots.map(strip)))).toEqual(json('parse.json'));
  });
});

describe('grammar fixtures', () => {
  const gdir = new URL('../../../fixtures/grammar/', import.meta.url);
  for (const f of readdirSync(gdir).filter((f) => f.endsWith('.specage'))) {
    it(f, () => {
      const src = readFileSync(new URL(f, gdir), 'utf8');
      const want = /# expect: (\S+)/.exec(src)![1];
      const got = lint(parse(src)).map((d) => d.code);
      if (want === 'none') expect(got).toEqual([]);
      else expect(got).toContain(want);
    });
  }
});
