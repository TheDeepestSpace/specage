import { execFileSync, spawnSync } from 'node:child_process';
import { buildDispatch } from '../src/dispatch.js';
import { buildPlannerDispatch } from '@specage/core';
import { decide, verifyPr, type PrFacts } from '../src/verify.js';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { isBadNoreplyEmail } from '../src/util.js';
import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../../..');
const BIN = join(root, 'packages/cli/dist/bin.js');
const FIX = join(root, 'fixtures/tbgwaf/tbgwaf.specage');
const run = (args: string[], o: { cwd?: string; env?: Record<string, string> } = {}) => {
  const r = spawnSync('node', [BIN, ...args], {
    cwd: o.cwd ?? root,
    encoding: 'utf8',
    env: { ...process.env, SPECAGE_NO_SLEEP: '1', ...o.env },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const tmp = () => mkdtempSync(join(tmpdir(), 'specage-cli-'));
const git = (cwd: string, ...a: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], {
    cwd,
    encoding: 'utf8',
  });

describe('exit codes', () => {
  it('0 on a clean file, 1 on lint errors, 2 on usage errors', () => {
    expect(run(['lint', FIX]).code).toBe(0);
    const bad = join(tmp(), 'bad.specage');
    writeFileSync(bad, 'a @x; b @x;\n');
    const r = run(['lint', bad]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('E003');
    expect(run(['lint']).code).toBe(2);
    expect(run(['nope']).code).toBe(2);
    expect(run([]).code).toBe(2);
    expect(run(['lint', '/does/not/exist']).code).toBe(2);
  });
  it('lint --json has file, line, column, code, message, node', () => {
    const bad = join(tmp(), 'b.specage');
    writeFileSync(bad, 'a @x { b @y; };\n');
    const j = JSON.parse(run(['lint', bad, '--json']).out);
    expect(j[0]).toMatchObject({ file: bad, line: 1, code: 'W101', node: 'y' });
    expect(typeof j[0].column).toBe('number');
    expect(typeof j[0].message).toBe('string');
  });
  it('parse and hash', () => {
    expect(run(['parse', FIX]).out).toContain('shoot.burst.cap');
    const h = JSON.parse(run(['hash', FIX, '--json']).out);
    expect(h['shoot.burst.cap'].hash).toMatch(/^[0-9a-f]{12}$/);
    const p = JSON.parse(run(['parse', FIX, '--json']).out);
    expect(p.nodes[0].children.length).toBeGreaterThan(0);
  });
  it('lint --state flags retired IDs (E004)', () => {
    const d = tmp();
    writeFileSync(join(d, 'trace.yaml'), 'retired_ids: [x]\nnodes: {}\n');
    const f = join(d, 'a.specage');
    writeFileSync(f, 'a @x;\n');
    const r = run(['lint', f, '--state', d]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('E004');
  });
});

describe('diff', () => {
  it('self diff is empty; empty -> file is all added; --json', () => {
    expect(run(['diff', '--from', FIX, '--to', FIX]).out.trim()).toBe('no changes');
    expect(JSON.parse(run(['diff', '--from', FIX, '--to', FIX, '--json']).out).entries).toEqual([]);
    const j = JSON.parse(run(['diff', '--from', 'empty', '--to', FIX, '--json']).out);
    expect(j.entries.every((e: any) => e.kind === 'added')).toBe(true);
  });
  it('resolves git refs, the per-project cursor and dispatch/latest', () => {
    const d = tmp();
    git(d, 'init', '-q');
    git(d, 'checkout', '-q', '-b', 'specages/p/spec');
    writeFileSync(join(d, 'p.specage'), 'one @a;\ntwo @b;\n');
    git(d, 'add', '.');
    git(d, 'commit', '-qm', '1');
    git(d, 'tag', 'dispatch/p/2026-01-01T00-00Z');
    // another project's tag in the shared data repo must never become the cursor
    git(d, 'tag', 'dispatch/other/2026-01-01T12-00Z');
    writeFileSync(join(d, 'p.specage'), 'one @a;\ntwo changed @b;\nthree @c;\n');
    git(d, 'commit', '-qam', '2');
    git(d, 'tag', 'dispatch/p/2026-01-02T00-00Z');
    expect(run(['cursor', '--tag', 'dispatch/p/2026-01-02T00-00Z', '--cwd', d]).out.trim()).toBe(
      'dispatch/p/2026-01-01T00-00Z',
    );
    expect(run(['cursor', '--tag', 'dispatch/p/2026-01-01T00-00Z', '--cwd', d]).out.trim()).toBe(
      '',
    );
    expect(run(['cursor', '--project', 'p', '--cwd', d]).out.trim()).toBe(
      'dispatch/p/2026-01-02T00-00Z',
    );
    const j = JSON.parse(
      run([
        'diff',
        '--from',
        'dispatch/latest',
        '--to',
        'dispatch/p/2026-01-02T00-00Z',
        '--cwd',
        d,
        '--json',
      ]).out,
    );
    expect(j.entries.map((e: any) => `${e.kind}:${e.id}`).sort()).toEqual(['added:c', 'changed:b']);
    // first dispatch diffs against empty
    const first = JSON.parse(
      run([
        'diff',
        '--from',
        'dispatch/latest',
        '--to',
        'dispatch/p/2026-01-01T00-00Z',
        '--cwd',
        d,
        '--json',
      ]).out,
    );
    expect(first.entries).toHaveLength(2);
    expect(run(['diff', '--from', 'nope', '--to', 'HEAD', '--cwd', d]).code).toBe(3);
  });
});

describe('state', () => {
  it('validate catches schema errors', () => {
    const d = tmp();
    writeFileSync(join(d, 'trace.yaml'), 'nodes:\n  a: {spec_hash: nothex, status: nope}\n');
    expect(run(['state', 'validate', d]).code).toBe(1);
    writeFileSync(join(d, 'trace.yaml'), 'nodes: {}\n');
    mkdirSync(join(d, 'outbox'));
    writeFileSync(
      join(d, 'outbox/o.json'),
      '{"id":"o","kind":"bogus","target":1,"body":"b","created":"x"}',
    );
    expect(run(['state', 'validate', d]).code).toBe(1);
    writeFileSync(
      join(d, 'outbox/o.json'),
      '{"id":"o","kind":"implement","target":1,"body":"b","created":"x"}',
    );
    expect(run(['state', 'validate', d]).code).toBe(0);
    expect(run(['state', 'validate', join(root, 'fixtures/tbgwaf/state')]).code).toBe(0);
  });
  it('validate rejects an unfired outbox entry for a withdrawn issue', () => {
    const d = tmp();
    mkdirSync(join(d, 'outbox'));
    writeFileSync(
      join(d, 'work.yaml'),
      'items:\n  - {id: w1, issue: 4, state: withdrawn, reason: node removed}\n',
    );
    const e = (extra: string) =>
      `{"id":"o","kind":"implement","target":4,"body":"","created":"x"${extra}}`;
    writeFileSync(join(d, 'outbox/o.json'), e(''));
    const bad = run(['state', 'validate', d]);
    expect(bad.code).toBe(1);
    expect(bad.out).toContain('withdrawn issue #4');
    writeFileSync(join(d, 'outbox/o.json'), e(',"fired":"2026-01-01"'));
    expect(run(['state', 'validate', d]).code).toBe(0);
    execFileSync('rm', [join(d, 'outbox/o.json')]);
    expect(run(['state', 'validate', d]).code).toBe(0);
  });
  it('commit rebases onto the latest trail and pushes to the checked-out branch', () => {
    const trail = 'specages/r/trail';
    const base = tmp();
    const bare = join(base, 'r.git');
    git(base, 'init', '-q', '--bare', bare);
    const clone = (n: string) => {
      const d = join(base, n);
      git(base, 'clone', '-q', bare, d);
      return d;
    };
    const a = clone('a');
    git(a, 'checkout', '-q', '-b', trail);
    writeFileSync(join(a, 'trace.yaml'), 'nodes: {}\n');
    git(a, 'add', '.');
    git(a, 'commit', '-qm', 'init');
    git(a, 'push', '-q', 'origin', trail);
    const b = clone('b');
    git(b, 'checkout', '-q', trail);
    writeFileSync(join(b, 'questions.yaml'), '[]\n');
    git(b, 'add', '.');
    git(b, 'commit', '-qm', 'other');
    git(b, 'push', '-q', 'origin', trail);
    mkdirSync(join(a, 'dispatches'));
    writeFileSync(join(a, 'dispatches/x.md'), 'report\n');
    const id = {
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t',
    };
    const r = run(['state', 'commit', '-m', 'dispatch x', '--dir', a], { env: id });
    expect(r.code, r.out + r.err).toBe(0);
    expect(git(bare, 'ls-tree', '-r', '--name-only', trail)).toContain('dispatches/x.md');
    expect(git(bare, 'ls-tree', '-r', '--name-only', trail)).toContain('questions.yaml');
    expect(run(['state', 'commit', '-m', 'again', '--dir', a], { env: id }).out).toContain(
      'nothing to commit',
    );
    writeFileSync(join(a, 'work.yaml'), 'items: [{id: w, state: bogus}]\n');
    expect(run(['state', 'commit', '-m', 'bad', '--dir', a], { env: id }).code).toBe(1);
  });
});

describe('outbox fire', () => {
  it('targets the project repo and refuses the data repo', () => {
    const d = tmp();
    mkdirSync(join(d, 'outbox'));
    writeFileSync(
      join(d, 'outbox/o1.json'),
      JSON.stringify({
        id: 'o1',
        kind: 'implement',
        target: 15,
        body: 'x',
        created: '2026-10-30T02:15:11Z',
      }),
    );
    const base = [
      'outbox',
      'fire',
      '--unfired',
      '--intern',
      'o/the-intern',
      '--project',
      'r',
      '--data-repo',
      'o/data',
      '--cwd',
      d,
      '--dry-run',
    ];
    const ok = run([...base, '--repo', 'o/calc']);
    expect(ok.code).toBe(0);
    expect(ok.out).toContain('\\"repo\\":\\"o/calc\\"');
    const bad = run([...base, '--repo', 'O/Data']);
    expect(bad.code).not.toBe(0);
    expect(bad.out + bad.err).toContain('data repo');
  });
  it('holds entries whose issue has an open question; fires them once resolved (fired marks stay idempotent)', () => {
    const d = tmp();
    mkdirSync(join(d, 'outbox'));
    const entry = (id: string, target: number) =>
      JSON.stringify({ id, kind: 'implement', target, body: '', created: '2026-10-30T02:15:11Z' });
    writeFileSync(join(d, 'outbox/o5.json'), entry('o5', 5));
    writeFileSync(join(d, 'outbox/o6.json'), entry('o6', 6));
    const q = (state: string) =>
      `- {id: q-1, node: '', dispatch: d, kind: reconcile, text: t, state: ${state}, issue: 5}\n`;
    writeFileSync(join(d, 'questions.yaml'), q('open'));
    const args = [
      'outbox',
      'fire',
      '--unfired',
      '--intern',
      'o/the-intern',
      '--project',
      'r',
      '--data-repo',
      'o/data',
      '--repo',
      'o/calc',
      '--cwd',
      d,
      '--dry-run',
    ];
    const held = run(args);
    expect(held.code).toBe(0);
    expect(held.out).toContain('held o5 -> #5');
    expect(held.out).toContain('\\"issue\\":6');
    expect(held.out).not.toContain('\\"issue\\":5');
    writeFileSync(join(d, 'questions.yaml'), q('resolved'));
    const free = run(args);
    expect(free.out).not.toContain('held');
    expect(free.out).toContain('\\"issue\\":5');
    // an already-fired entry is still skipped, resolved or not
    writeFileSync(
      join(d, 'outbox/o5.json'),
      JSON.stringify({ ...JSON.parse(entry('o5', 5)), fired: 'x' }),
    );
    expect(run(args).out).not.toContain('\\"issue\\":5');
  });
  it('question anchor prints the nearest surviving ancestor', () => {
    const d = tmp();
    writeFileSync(join(d, 'old.specage'), 'Top @a { Leaf @a.b; };\n');
    writeFileSync(join(d, 'new.specage'), 'Top @a;\n');
    const r = run([
      'question',
      'anchor',
      'a.b',
      '--from',
      join(d, 'old.specage'),
      '--to',
      join(d, 'new.specage'),
    ]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out).node).toBe('a');
  });
  it('fires only entries ADDED in the range, via workflow_dispatch', () => {
    const d = tmp();
    git(d, 'init', '-q');
    git(d, 'checkout', '-q', '-b', 'specages/r/trail');
    mkdirSync(join(d, 'outbox'));
    const entry = (id: string, kind: string, target: number) =>
      JSON.stringify({
        id,
        kind,
        target,
        body: `Implement #${target}`,
        created: '2026-10-30T02:15:11Z',
      });
    writeFileSync(join(d, 'outbox/o1.json'), entry('o1', 'implement', 5));
    git(d, 'add', '.');
    git(d, 'commit', '-qm', '1');
    const first = git(d, 'rev-parse', 'HEAD').trim();
    writeFileSync(join(d, 'outbox/o2.json'), entry('o2', 'amend', 9));
    writeFileSync(join(d, 'trace.yaml'), 'nodes: {}\n');
    git(d, 'add', '.');
    git(d, 'commit', '-qm', '2');
    const second = git(d, 'rev-parse', 'HEAD').trim();
    const args = [
      'outbox',
      'fire',
      '--repo',
      'o/r',
      '--intern',
      'o/the-intern',
      '--project',
      'r',
      '--data-repo',
      'o/data',
      '--cwd',
      d,
      '--dry-run',
    ];
    const r = run([...args, '--range', `${first}..${second}`]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('\\"pr\\":9');
    expect(r.out).toContain('prompts/amend.md@main');
    expect(r.out).not.toContain('\\"issue\\":5');
    // new branch: before is all zeros => every entry
    const all = run([...args, '--range', `${'0'.repeat(40)}..${second}`]);
    expect(all.out).toContain('\\"issue\\":5');
    expect(all.out).toContain('prompts/implement.md@main');
  });
  it('--unfired skips fired entries and uses per-entry model/effort', () => {
    const d = tmp();
    mkdirSync(join(d, 'outbox'));
    const base = { kind: 'implement', body: '', created: 'x' };
    writeFileSync(
      join(d, 'outbox/a.json'),
      JSON.stringify({ ...base, id: 'a', target: 5, model: 'm-big', effort: 'high' }),
    );
    writeFileSync(
      join(d, 'outbox/b.json'),
      JSON.stringify({ ...base, id: 'b', target: 6, fired: '2026-01-01T00:00:00Z' }),
    );
    const r = run([
      'outbox',
      'fire',
      '--unfired',
      '--repo',
      'o/r',
      '--intern',
      'o/the-intern',
      '--project',
      'r',
      '--data-repo',
      'o/data',
      '--cwd',
      d,
      '--dry-run',
    ]);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toContain('\\"issue\\":5');
    expect(r.out).toContain('m-big');
    expect(r.out).toContain('high');
    expect(r.out).not.toContain('\\"issue\\":6');
  });
});

describe('render', () => {
  it('bakes data.json next to the SPA', () => {
    const out = join(tmp(), 'site');
    const r = run([
      'render',
      '--spec',
      FIX,
      '--state',
      join(root, 'fixtures/tbgwaf/state'),
      '--out',
      out,
      '--repo',
      'o/r',
    ]);
    expect(r.code, r.err).toBe(0);
    expect(existsSync(join(out, 'index.html'))).toBe(true);
    const data = JSON.parse(readFileSync(join(out, 'data.json'), 'utf8'));
    expect(data.nodes['shoot.burst.cap'].status).toBe('verified');
    expect(data.nodes['shoot.burst.bar'].status).toBe('stale');
    expect(data.aggregate.shoot).toBeDefined();
    expect(data.report).toContain('dispatch/tbgwaf/2026-10-30T02-11Z');
  });
});

describe('bundle (what `npx github:...` runs)', () => {
  it('is self-contained: runs from a directory with no node_modules around it', () => {
    const dir = tmp();
    const copy = join(dir, 'specage.js');
    writeFileSync(copy, readFileSync(join(root, 'packages/cli/bundle/specage.js')));
    const r = spawnSync('node', [copy, 'lint', FIX], { encoding: 'utf8', cwd: dir });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('0 error(s)');
  });
});

describe('dispatch_agent', () => {
  const ctx = {
    project: 'p',
    repo: 'o/r',
    issue: 7,
    kind: 'implement' as const,
    spec_ids: ['shoot.burst@aaaaaaaaaaaa', 'shoot.cap@bbbbbbbbbbbb'],
    attempt: 1,
    max_attempts: 2,
  };
  const pr = (o: Partial<PrFacts> = {}): PrFacts => ({
    number: 9,
    state: 'open',
    merged: false,
    body: 'Closes #7',
    branch: 'specage/shoot-burst',
    commits: ['feat\n\nSpec: shoot.burst@aaaaaaaaaaaa\nSpec: shoot.cap@bbbbbbbbbbbb'],
    ...o,
  });
  const pay = (c = ctx, status: 'success' | 'failure' | 'cancelled' = 'success') => ({
    status,
    context: c,
  });

  it('builds a pinned-prompt dispatch with a callback and refuses bad attempts', () => {
    const o = {
      kind: 'implement' as const,
      repo: 'o/r',
      data_repo: 'o/data',
      specage_repo: 'o/specage',
      prompt_ref: 'main',
      project: 'p',
      spec_ids: ['a@aaaaaaaaaaaa'],
      issue: 7,
    };
    const d: any = buildDispatch(o);
    expect(d.prompt).toBe('o/specage:prompts/implement.md@main');
    expect(d.callback).toEqual({ repo: 'o/specage', workflow: 'callback.yml' });
    expect(d.issue).toBe(7);
    expect(d.context).toMatchObject({ project: 'p', attempt: 1, max_attempts: 3 });
    expect(d.access).toEqual([{ repo: 'o/data', scope: 'read' }]);
    expect(() => buildDispatch({ ...o, attempt: 4, max_attempts: 3 })).toThrow(/exceeds/);
    expect(() => buildDispatch({ ...o, issue: undefined })).toThrow(/issue/);
    expect(() => buildDispatch({ ...o, kind: 'amend' })).toThrow(/pr/);
    expect(() => buildDispatch({ ...o, prompt_ref: '../x' })).toThrow(/ref/);
  });

  it('accepts a PR with every trailer and Closes #N', () => {
    expect(decide(pay(), pr(), 7)).toEqual({ action: 'ok', state: 'in_review' });
  });
  it('rejects missing, malformed, stale and foreign trailers', () => {
    const p = verifyPr(
      pr({
        commits: ['x\n\nSpec: shoot.burst@cccccccccccc\nSpec: nope@aaaaaaaaaaaa\nSpec: bad'],
      }),
      ctx,
      7,
    );
    expect(p.join('\n')).toMatch(/stale hash/);
    expect(p.join('\n')).toMatch(/does not claim/);
    expect(p.join('\n')).toMatch(/malformed trailer/);
    expect(p.join('\n')).toMatch(/shoot\.cap@bbbbbbbbbbbb has no/);
  });
  it('Spec-Release in the body excuses a claim; Closes #N is required', () => {
    const c = pr({
      commits: ['x\n\nSpec: shoot.burst@aaaaaaaaaaaa'],
      body: 'Spec-Release: shoot.cap\nCloses #7',
    });
    expect(verifyPr(c, ctx, 7)).toEqual([]);
    expect(verifyPr({ ...c, body: 'Spec-Release: shoot.cap' }, ctx, 7)).toEqual([
      'PR body must say "Closes #7"',
    ]);
  });
  it('rejects a PR branch not named specage/<name>', () => {
    expect(verifyPr(pr({ branch: 'fix-things' }), ctx, 7)).toEqual([
      'PR branch "fix-things" must be named specage/<name>',
    ]);
    expect(verifyPr(pr(), ctx, 7)).toEqual([]);
  });
  it('retries below the cap, gives up at it', () => {
    const bad = pr({ commits: ['no trailers'] });
    const d = decide(pay(), bad, 7);
    expect(d).toMatchObject({ action: 'redispatch', attempt: 2 });
    if (d.action === 'redispatch') expect(d.correction).toContain('shoot.burst@aaaaaaaaaaaa');
    expect(decide(pay({ ...ctx, attempt: 2 }), bad, 7)).toMatchObject({
      action: 'mark',
      state: 'needs_human',
    });
  });
  it('maps run failure, closed and merged PRs to states', () => {
    expect(decide(pay(ctx, 'failure'), null)).toMatchObject({ action: 'mark', state: 'failed' });
    expect(decide(pay(ctx, 'cancelled'), null)).toMatchObject({ action: 'mark', state: 'failed' });
    expect(decide(pay(), pr({ state: 'closed' }), 7)).toMatchObject({ state: 'needs_human' });
    expect(decide(pay(), pr({ state: 'closed', merged: true }), 7)).toEqual({
      action: 'ok',
      state: 'merged',
    });
    expect(decide(pay(), null, 7)).toMatchObject({ action: 'redispatch' });
  });

  it('callback --dry-run on failure marks the work item', () => {
    const d = tmp();
    writeFileSync(
      join(d, 'work.yaml'),
      'items:\n  - {id: w1, issue: 7, pr: null, state: in_progress}\n',
    );
    const r = run([
      'callback',
      '--status',
      'failure',
      '--context',
      JSON.stringify(ctx),
      '--issue',
      '7',
      '--state-dir',
      d,
    ]);
    expect(r.code).toBe(0);
    expect(readFileSync(join(d, 'work.yaml'), 'utf8')).toContain('state: failed');
    expect(run(['state', 'validate', d]).code).toBe(0);
  });
});

describe('planner dispatch', () => {
  const sha = (c: string) => c.repeat(40);
  const o = {
    repo: 'o/r',
    data_repo: 'o/d',
    specage_repo: 'o/specage',
    prompt_ref: 'main',
    project: 'r',
    before: sha('a'),
    after: sha('b'),
  };
  it('targets no issue/pr and carries the range', () => {
    const d: any = buildPlannerDispatch(o);
    expect(d.prompt).toBe('o/specage:prompts/discovery.md@main');
    expect(d.issue).toBeUndefined();
    expect(d.pr).toBeUndefined();
    expect(d.context).toMatchObject({ kind: 'planner', before: sha('a'), after: sha('b') });
  });
  it('allows a first run (no cursor) and rejects bad shas', () => {
    expect((buildPlannerDispatch({ ...o, before: null }) as any).context.before).toBeNull();
    expect(() => buildPlannerDispatch({ ...o, after: 'HEAD' })).toThrow();
  });
  it('callback for a planner run needs no PR and fails only on a failed run', () => {
    const ctx = JSON.stringify({
      project: 'r',
      repo: 'o/r',
      kind: 'planner',
      attempt: 1,
      max_attempts: 1,
      spec_ids: [],
    });
    expect(run(['callback', '--status', 'success', '--context', ctx]).code).toBe(0);
    expect(run(['callback', '--status', 'failure', '--context', ctx]).code).toBe(1);
  });
});

describe('commit identity', () => {
  it('flags noreply emails without a numeric id', () => {
    for (const e of ['bot@users.noreply.github.com', 'specage-app[bot]@users.noreply.github.com'])
      expect(isBadNoreplyEmail(e)).toBe(true);
    for (const e of ['308992161+the-intern-bot[bot]@users.noreply.github.com', 't@t', ''])
      expect(isBadNoreplyEmail(e)).toBe(false);
  });
  it('no checked-in workflow/action sets an id-less noreply email', () => {
    const files = [
      ...readdirSync(join(root, '.github/workflows')).map((f) =>
        join(root, '.github/workflows', f),
      ),
      join(root, 'packages/action/publish/action.yml'),
    ];
    for (const f of files)
      for (const m of readFileSync(f, 'utf8').matchAll(/[^\s"'=]+@users\.noreply\.github\.com/g))
        expect(isBadNoreplyEmail(m[0].replace('${BOT_ID}', '1')), `${f}: ${m[0]}`).toBe(false);
  });
});

describe('plan undispatched / question reanchor / state validate --spec', () => {
  const setup = () => {
    const d = tmp();
    const spec = join(d, 's.specage');
    writeFileSync(spec, 'Top @a { Mid @a.b; }; Lone @z;\n');
    return { d, spec };
  };
  it('reanchors orphaned questions and validate flags them', () => {
    const { d, spec } = setup();
    writeFileSync(
      join(d, 'questions.yaml'),
      '- {id: q1, node: a.b.gone, dispatch: d, kind: reconcile, text: t, state: open}\n',
    );
    const v = run(['state', 'validate', d, '--spec', spec]);
    expect(v.code).toBe(1);
    expect(v.out).toContain('q1 references missing node');
    expect(run(['question', 'reanchor', d, '--spec', spec, '--write']).code).toBe(0);
    expect(readFileSync(join(d, 'questions.yaml'), 'utf8')).toContain('node: a.b');
    expect(run(['state', 'validate', d, '--spec', spec]).code).toBe(0);
  });
  it('enqueues an implement entry once', () => {
    const { d, spec } = setup();
    const hash = JSON.parse(run(['hash', spec, '--json']).out).z.hash;
    writeFileSync(
      join(d, 'work.yaml'),
      `items:\n  - {id: w1, issue: 19, state: filed, claims: {z: {hash: "${hash}", status: pending}}}\n`,
    );
    const r = run(['plan', 'undispatched', d, '--spec', spec, '--write']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('#19');
    const f = JSON.parse(readFileSync(join(d, 'outbox/ob-implement-19.json'), 'utf8'));
    expect(f).toMatchObject({ kind: 'implement', target: 19, spec_ids: [`z@${hash}`] });
    expect(run(['plan', 'undispatched', d, '--spec', spec]).out).toContain('nothing undispatched');
  });
});
