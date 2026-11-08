import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parse,
  lint,
  diff,
  flatten,
  normalize,
  sha12,
  anchorQuestion,
  pendingThreads,
  orphanedQuestions,
  reanchorQuestions,
  undispatchedItems,
  implementEntry,
  answerQuestion,
  dispatchBlocked,
  QuestionSchema,
  QuestionError,
  buildIssueBody,
  buildPlannerDispatch,
} from '../src/index.js';

const fixture = readFileSync(
  new URL('../../../fixtures/tbgwaf/tbgwaf.specage', import.meta.url),
  'utf8',
);
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
  it('joins lines ending in a backslash', () => {
    const s = parse(
      'i \\\nwant \\\n   to be able to write \\\nlong lines @long-lines-req;\nnext @n;',
    );
    expect(s.diagnostics).toEqual([]);
    expect(s.roots[0].id).toBe('long-lines-req');
    expect(s.roots[0].text).toBe('i want to be able to write long lines');
    expect(s.roots[0].hash).toBe(parse('i want to be able to write long lines @x;').roots[0].hash);
    expect(s.roots[1].line).toBe(5);
    expect(s.roots[0].endLine).toBe(4);
  });
  it('continuation: CRLF, EOF, escaped backslash, ID-less statement', () => {
    expect(parse('a \\\r\nb @x;').roots[0].text).toBe('a b');
    expect(parse('a @x; \\').diagnostics).toEqual([]);
    const e = parse('a \\\\\nb @x;');
    expect(e.roots[0].text).toBe('a \\ b');
    const m = parse('no \\\nid;');
    expect(m.diagnostics).toEqual([]);
    expect(m.roots[0].derived).toBe(true);
    expect(m.roots[0].id).toBe(parse('no id;').roots[0].id);
    expect(m.roots[0].text).toBe('no id');
    expect(m.roots[0].line).toBe(1);
    expect(m.roots[0].endLine).toBe(2);
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
  it('E002 only for empty statements', () => {
    expect(codes('a b;')).not.toContain('E002');
    expect(codes(';')).toContain('E002');
  });
  it('derives stable hash names for ID-less statements', () => {
    const a = parse('Hello  World;').roots[0];
    const b = parse('hello world;').roots[0];
    const c = parse('hello there;').roots[0];
    expect(a.derived).toBe(true);
    expect(a.id).toMatch(/^s-[0-9a-f]{8}$/);
    expect(a.id).toBe(b.id);
    expect(a.id).not.toBe(c.id);
    expect(parse('a @x;').roots[0].derived).toBe(false);
  });
  it('disambiguates identical ID-less statements and skips anchor checks', () => {
    const s = parse('a b; a b;');
    expect(s.roots[0].id).not.toBe(s.roots[1].id);
    expect(codes('a b; a b; c @p { d; };')).toEqual([]);
  });
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
    for (const t of [
      'see src/game/Weapon.h @x;',
      'see https://x.io @x;',
      String.raw`like \#123 here @x;`,
    ])
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
    const reflowed = fixture
      .replace(/(^|\s)#.*$/gm, '')
      .replace(/ (?=[a-z])/g, '\n   ')
      .replace(/(?<!\\);/g, ' ;');
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
    expect(r.entries[0]).toMatchObject({
      kind: 'renamed',
      from: 'a.b',
      id: 'a.c',
      text_changed: false,
    });
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
    expect(
      Object.fromEntries(
        flatten(spec).map((n) => [n.id, { hash: n.hash, subtree_hash: n.subtreeHash }]),
      ),
    ).toEqual(json('hash.json')));
  it('lint.json', () => expect(JSON.parse(JSON.stringify(lint(spec)))).toEqual(json('lint.json')));
  it('parse.json', () => {
    const strip = (n: any): any => ({
      id: n.id,
      type: n.type,
      marker: n.marker,
      text: n.text,
      parent: n.parent,
      lineage: n.lineage,
      line: n.line,
      children: n.children.map(strip),
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

import { createHash } from 'node:crypto';
import { sha256Hex } from '../src/hash.js';
describe('sha256', () => {
  it('matches node:crypto', () => {
    for (const s of [
      '',
      'abc',
      'x'.repeat(55),
      'x'.repeat(56),
      'x'.repeat(64),
      'héllo wörld ✓'.repeat(20),
    ])
      expect(sha256Hex(s)).toBe(createHash('sha256').update(s, 'utf8').digest('hex'));
  });
});

import { parseYaml, parseState } from '../src/index.js';
describe('yaml hashes', () => {
  it('keeps numeric-looking hashes as strings', () => {
    for (const h of ['000000000000', '123456789012', '12e456789012', '0e1234567890'])
      expect(
        (parseYaml(`nodes:\n  a: {spec_hash: ${h}, status: planned}`) as any).nodes.a.spec_hash,
      ).toBe(h);
    const { issues } = parseState({
      trace: parseYaml('nodes:\n  a: {spec_hash: 123456789012, status: planned}'),
      work: parseYaml(
        'items:\n - {id: w, state: filed, claims: {a: {hash: 000000000001, status: done}}}',
      ),
    });
    expect(issues).toEqual([]);
  });
});

describe('$id references', () => {
  const src = 'frontend @fe; $fe is hosted on GH Pages @infra; costs $5 and $Home @x;';
  it('extracts refs', () => {
    const n = flatten(parse(src));
    expect(n.find((x) => x.id === 'infra')!.refs).toEqual(['fe']);
    expect(n.find((x) => x.id === 'x')!.refs).toEqual([]);
  });
  it('dedupes and handles dotted ids and trailing punctuation', () => {
    const n = flatten(parse('see $a.b, $a.b and $c-d. @z;'));
    expect(n[0].refs).toEqual(['a.b', 'c-d']);
  });
  it('W107 unresolved, W108 self', () => {
    const codes = lint(parse('x $nope @a; y $b @b;')).map((d) => d.code);
    expect(codes).toContain('W107');
    expect(codes).toContain('W108');
    expect(lint(parse(src)).map((d) => d.code)).not.toContain('W107');
  });
  it('resolves explicit ids only; refs to derived names warn', () => {
    expect(lint(parse('a b c; see $s-12345678 @r;')).map((d) => d.code)).toContain('W107');
  });
  it('flags transitive dependents of changed statements', () => {
    const o = 'a @a; uses $a @b; uses $b @c; other @d;';
    const r = diff(parse(o), parse(o.replace('a @a', 'a2 @a')));
    expect(r.stale_dependents).toEqual([
      { id: 'b', because: ['a'] },
      { id: 'c', because: ['a'] },
    ]);
    expect(diff(parse(o), parse(o)).stale_dependents).toEqual([]);
  });
});

import { applyOp, mergeThreads, parseComments, stringifyComments } from '../src/index.js';
describe('comment threads', () => {
  const hashes = { 'a.b': '123456789012' };
  const mk = () =>
    applyOp(
      [],
      { op: 'create', node: 'a.b', node_hash: '', body: ' hi ' },
      'me',
      '2026-01-01T00:00:00Z',
      hashes,
    );
  it('create/reply/resolve/reopen', () => {
    let t = mk();
    expect(t[0]).toMatchObject({ id: 't-0001', node_hash: '123456789012', state: 'open' });
    expect(t[0].comments[0].body).toBe('hi');
    t = applyOp(
      t,
      { op: 'reply', thread: 't-0001', body: 'yo' },
      'o',
      '2026-01-02T00:00:00Z',
      hashes,
    );
    expect(t[0].comments.map((c) => c.id)).toEqual(['t-0001.1', 't-0001.2']);
    t = applyOp(t, { op: 'resolve', thread: 't-0001' }, 'o', '2026-01-03T00:00:00Z', hashes);
    expect(t[0]).toMatchObject({ state: 'resolved', resolved_by: 'o' });
    t = applyOp(t, { op: 'reopen', thread: 't-0001' }, 'o', '2026-01-04T00:00:00Z', hashes);
    expect(t[0].state).toBe('open');
    expect(t[0].resolved_by).toBeUndefined();
  });
  it('rejects bad input', () => {
    expect(() =>
      applyOp([], { op: 'create', node: 'nope', node_hash: '', body: 'x' }, 'm', 't', hashes),
    ).toThrow(/unknown node/);
    expect(() =>
      applyOp([], { op: 'create', node: 'a.b', node_hash: '', body: '  ' }, 'm', 't', hashes),
    ).toThrow();
    expect(() => applyOp([], { op: 'resolve', thread: 'x' }, 'm', 't', hashes)).toThrow(
      /unknown thread/,
    );
  });
  it('round-trips yaml (numeric-looking hash stays a string)', () => {
    const t = applyOp([], { op: 'create', node: 'a.b', node_hash: '', body: 'x' }, 'm', 't', {
      'a.b': '000000000001',
    });
    const back = parseComments(stringifyComments(t));
    expect(back.issues).toEqual([]);
    expect(back.threads).toEqual(t);
    expect(parseComments('threads: 5').issues.length).toBeGreaterThan(0);
  });
  it('merges agent events from the trail branch', () => {
    const m = mergeThreads(mk(), [
      { thread: 't-0001', kind: 'resolve', author: 'agent', at: '2026-02-02T00:00:00Z' },
      {
        thread: 't-0001',
        kind: 'reply',
        author: 'agent',
        at: '2026-02-01T00:00:00Z',
        body: 'done',
      },
      { thread: 'gone', kind: 'resolve', author: 'agent', at: '2026-02-01T00:00:00Z' },
    ]);
    expect(m[0].comments.at(-1)).toMatchObject({ author: 'agent', body: 'done' });
    expect(m[0]).toMatchObject({ state: 'resolved', resolved_by: 'agent' });
  });
});

describe('planner questions', () => {
  const q = (o: object) =>
    QuestionSchema.parse({
      id: 'q-1',
      node: 'a',
      dispatch: 'd',
      kind: 'reconcile',
      text: 'drop it?',
      state: 'open',
      ...o,
    });
  it('anchors to the nearest surviving ancestor; removed root is top-level', () => {
    const old = parse('Top @a { Mid @a.b { Leaf @a.b.c; }; Other @a.o; }; Lone @z;');
    const gone = (ids: string[]) =>
      anchorQuestion(old, parse(`${ids.map((i) => `N @${i};`).join(' ')}`), 'a.b.c');
    // parent a.b survives -> a.b
    expect(gone(['a', 'a.b']).node).toBe('a.b');
    // a.b removed too -> grandparent a
    const r = gone(['a']);
    expect(r.node).toBe('a');
    expect(r.node_hash).toMatch(/^[0-9a-f]{12}$/);
    // whole branch removed -> top-level
    expect(gone(['z']).node).toBe('');
    // removed root node -> top-level
    expect(anchorQuestion(old, parse('Lone2 @y;'), 'z')).toEqual({ node: '' });
  });
  it('answers append to the thread, keep the question open, and validate input', () => {
    const at = '2026-11-01T00:00:00Z';
    const one = answerQuestion([q({})], { id: 'q-1', choice: 'keep' }, 'me', at);
    expect(one[0].state).toBe('open');
    expect(one[0].thread).toEqual([{ author: 'me', at, body: 'Keep the issue.', choice: 'keep' }]);
    const two = answerQuestion(one, { id: 'q-1', body: 'but rename it' }, 'me', at);
    expect(two[0].thread).toHaveLength(2);
    expect(two[0].answer).toBe('but rename it');
    expect(() => answerQuestion(one, { id: 'nope', body: 'x' }, 'me', at)).toThrow(QuestionError);
    expect(() => answerQuestion(one, { id: 'q-1' }, 'me', at)).toThrow(QuestionError);
    expect(() =>
      answerQuestion([q({ state: 'resolved' })], { id: 'q-1', body: 'x' }, 'me', at),
    ).toThrow(/resolved/);
  });
  it('gates dispatch only while a question for that issue is open', () => {
    const qs = [q({ issue: 7 }), q({ id: 'q-2', issue: 8, state: 'resolved' }), q({ id: 'q-3' })];
    expect(dispatchBlocked(qs, 7)).toBe(true);
    expect(dispatchBlocked(qs, 8)).toBe(false);
    expect(dispatchBlocked(qs, 9)).toBe(false);
  });
  it('accepts legacy questions without thread/issue and top-level ones without node', () => {
    const legacy = QuestionSchema.parse({
      id: 'q',
      node: 'x',
      node_hash: '7de5de6b1450',
      dispatch: 'd',
      kind: 'rename',
      text: 't',
      state: 'open',
    });
    expect(legacy.thread).toEqual([]);
    expect(
      QuestionSchema.parse({ id: 'q', dispatch: 'd', kind: 'split', text: 't', state: 'open' })
        .node,
    ).toBe('');
  });
});

describe('reconcile helpers', () => {
  const spec = parse('Top @a { Mid @a.b; }; Lone @z;');
  const hashes = Object.fromEntries(flatten(spec).map((n) => [n.id, n.hash]));
  const mk = (id: string, node: string, extra: any = {}) =>
    QuestionSchema.parse({
      id,
      node,
      dispatch: 'd',
      kind: 'reconcile',
      text: 't',
      state: 'open',
      ...extra,
    });

  it('re-anchors orphaned questions to the nearest existing ancestor, else top-level', () => {
    const qs = [
      mk('q1', 'a.b.c.d', { node_hash: 'aaaaaaaaaaaa' }),
      mk('q2', 'gone.x'),
      mk('q3', 'a.b'),
      mk('q4', ''),
    ];
    expect(orphanedQuestions(qs, spec).map((q) => q.id)).toEqual(['q1', 'q2']);
    const r = reanchorQuestions(qs, spec);
    expect(r.questions.map((q) => q.node)).toEqual(['a.b', '', 'a.b', '']);
    expect(r.questions[0].node_hash).toBe(hashes['a.b']);
    expect(r.questions[1].node_hash).toBeUndefined();
    expect(r.changed).toHaveLength(2);
    // idempotent, and nothing is orphaned afterwards
    expect(reanchorQuestions(r.questions, spec).changed).toEqual([]);
    expect(orphanedQuestions(r.questions, spec)).toEqual([]);
  });
  it('uses the old tree when given (non-dotted ids)', () => {
    const old = parse('P @p { C @c; };');
    const now = parse('P @p;');
    expect(reanchorQuestions([mk('q', 'c')], now, old).questions[0].node).toBe('p');
  });

  const item = (o: any) => ({
    id: 'w',
    issue: 1,
    pr: null,
    state: 'filed',
    relations: [],
    claims: { z: { hash: hashes.z, status: 'pending' } },
    ...o,
  });
  const run = (w: any, outbox: any[] = [], qs: any[] = []) =>
    undispatchedItems({ items: [item(w)] } as any, outbox, qs, spec);
  it('finds filed issues with no outbox entry, no PR, no open question, fresh claims', () => {
    const r = run({});
    expect(r).toEqual([{ issue: 1, work_id: 'w', spec_ids: [`z@${hashes.z}`] }]);
    expect(implementEntry(r[0], 'now')).toMatchObject({ kind: 'implement', target: 1, body: '' });
  });
  it('skips fired/queued, in-flight, gated, stale and orphaned ones', () => {
    expect(run({}, [{ target: 1 }])).toEqual([]);
    expect(run({ pr: 5 })).toEqual([]);
    expect(run({ state: 'in_progress' })).toEqual([]);
    expect(run({}, [], [mk('q', 'z', { issue: 1 })])).toEqual([]);
    expect(run({}, [], [mk('q', 'z', { issue: 1, state: 'resolved' })])).toHaveLength(1);
    expect(run({ claims: { z: { hash: 'bbbbbbbbbbbb', status: 'pending' } } })).toEqual([]);
    expect(run({ claims: { nope: { hash: hashes.z, status: 'pending' } } })).toEqual([]);
  });
});

describe('enriched issue body', () => {
  const base = {
    summary: 'Do the thing',
    spec_commit: 'a'.repeat(40),
    claims: [{ id: 'x.y', hash: 'abc123def456', text: 'The system MUST do\nthe thing.' }],
  };
  it('quotes spec verbatim and keeps trailer instructions', () => {
    const b = buildIssueBody(base);
    expect(b).toContain('  > The system MUST do\n  > the thing.');
    expect(b).toContain('`x.y@abc123def456`');
    expect(b).toContain('Add `Spec: x.y@abc123def456`');
    expect(b).toContain('Tests required');
  });
  it('renders enrichment, bounded, with UI screenshots', () => {
    const b = buildIssueBody({
      ...base,
      binding: [{ id: 'c.1', kind: 'constraint', text: 'No deps' }],
      enrichment: {
        files: Array.from({ length: 20 }, (_, i) => `f${i}.ts`),
        criteria: ['z'.repeat(1000)],
        ui: true,
      },
    });
    expect(b).toContain('`c.1` (constraint): No deps');
    expect(b).toContain('- f7.ts');
    expect(b).not.toContain('f8.ts');
    expect(b).toContain('…');
    expect(b).toContain('screenshots');
  });
  it('rejects empty claims', () => {
    expect(() => buildIssueBody({ ...base, claims: [] })).toThrow();
  });
  it('planner dispatch grants read on the code repo', () => {
    const d: any = buildPlannerDispatch({
      repo: 'o/code',
      data_repo: 'o/data',
      specage_repo: 'o/specage',
      prompt_ref: 'main',
      project: 'p',
      before: null,
      after: 'b'.repeat(40),
    });
    expect(d.access).toContainEqual({ repo: 'o/code', scope: 'read' });
  });
});

describe('pendingThreads', () => {
  const th = (id: string, authors: string[], state: 'open' | 'resolved' = 'open') => ({
    id,
    node: 'a',
    node_hash: 'h',
    state,
    comments: authors.map((author, i) => ({
      id: `${id}.${i + 1}`,
      author,
      at: `2026-01-0${i + 1}T00:00:00Z`,
      body: 'b',
    })),
  });
  it('lists open threads with an unanswered human comment', () => {
    const threads = [
      th('t-0001', ['me']),
      th('t-0002', ['me', 'the-intern']),
      th('t-0003', ['me'], 'resolved'),
    ];
    expect(pendingThreads(threads).map((t) => t.id)).toEqual(['t-0001']);
  });
  it('is idempotent once a reply event exists, and re-opens on a newer human comment', () => {
    const ev = [
      {
        thread: 't-0001',
        kind: 'reply' as const,
        author: 'the-intern',
        at: '2026-02-01T00:00:00Z',
        body: 'ok',
      },
    ];
    expect(pendingThreads([th('t-0001', ['me'])], ev)).toEqual([]);
    expect(pendingThreads([th('t-0001', ['me', 'the-intern', 'me'])], [])).toHaveLength(1);
  });
});
