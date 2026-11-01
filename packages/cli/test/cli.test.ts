import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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
    writeFileSync(bad, 'no id;\n');
    const r = run(['lint', bad]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('E002');
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
      '--cwd',
      d,
      '--dry-run',
    ];
    const r = run([...args, '--range', `${first}..${second}`]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('pr_number=9');
    expect(r.out).toContain('backend=claude Implement #9');
    expect(r.out).not.toContain('pr_number=5');
    // new branch: before is all zeros => every entry
    const all = run([...args, '--range', `${'0'.repeat(40)}..${second}`]);
    expect(all.out).toContain('pr_number=5');
    expect(all.out).toContain('pr_number=9');
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
