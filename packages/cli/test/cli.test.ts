import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
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

/** A fake `gh` that serves bare-repo-backed project and data repos, for install tests. */
function fakeGh(
  binDir: string,
  base: string,
  opts: { pages: 'none' | 'legacy' | 'workflow'; private?: boolean },
) {
  mkdirSync(binDir, { recursive: true });
  const f = join(binDir, 'gh');
  writeFileSync(
    f,
    `#!/usr/bin/env node
const { existsSync, appendFileSync } = require('node:fs');
const a = process.argv.slice(2);
appendFileSync(${JSON.stringify(join(binDir, 'calls.log'))}, a.join(' ') + '\\n');
const bare = ${JSON.stringify(base)} + '/o/r.git';
const dataBare = ${JSON.stringify(base)} + '/o/specage-data.git';
const out = (o) => { console.log(JSON.stringify(o)); process.exit(0); };
const nf = () => { console.error('gh: Not Found (HTTP 404)'); process.exit(1); };
const has = (dir, b) => require('node:child_process').spawnSync('git', ['--git-dir', dir, 'rev-parse', '--verify', 'refs/heads/' + b]).status === 0;
if (a[0] === 'api') {
  const p = a[a.length - 1];
  if (a.includes('-X')) process.exit(0);
  if (p === 'repos/o/r') out({ default_branch: 'main', private: ${!!opts.private}, permissions: { admin: true } });
  if (p === 'repos/o/specage-data') out({ default_branch: 'main', private: true, permissions: { admin: true, push: true } });
  if (p.startsWith('repos/o/specage-data/branches/')) has(dataBare, p.slice('repos/o/specage-data/branches/'.length)) ? out({}) : nf();
  if (p === 'repos/o/r/branches/gh-pages') has(bare, 'gh-pages') ? out({}) : nf();
  if (p === 'repos/o/r/pages') ${opts.pages === 'none' ? 'nf()' : opts.pages === 'legacy' ? "out({ build_type: 'legacy', source: { branch: 'gh-pages', path: '/' } })" : "out({ build_type: 'workflow' })"};
  nf();
}
if (a[0] === 'auth') { console.log('tok'); process.exit(0); }
process.exit(0);
`,
  );
  chmodSync(f, 0o755);
}

describe('install', () => {
  function setup(opts: { pages: 'none' | 'legacy' | 'workflow'; private?: boolean }) {
    const d = tmp();
    const base = join(d, 'remote');
    mkdirSync(join(base, 'o'), { recursive: true });
    git(d, 'init', '-q', '--bare', join(base, 'o/r.git'));
    git(d, 'init', '-q', '--bare', join(base, 'o/specage-data.git'));
    const bin = join(d, 'bin');
    fakeGh(bin, base, opts);
    const env = {
      PATH: `${bin}:${process.env.PATH}`,
      SPECAGE_GIT_BASE: base,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t',
    };
    const dataBare = join(base, 'o/specage-data.git');
    const files = (branch: string) =>
      git(dataBare, 'ls-tree', '-r', '--name-only', branch).trim().split('\n');
    const show = (branch: string, f: string) => git(dataBare, 'show', `${branch}:${f}`);
    return {
      d,
      base,
      env,
      files,
      show,
      bare: join(base, 'o/r.git'),
      dataBare,
      calls: () => readFileSync(join(bin, 'calls.log'), 'utf8'),
    };
  }

  const INSTALL = ['install', '--repo', 'o/r', '--data-repo', 'o/specage-data'];

  it('--dry-run prints the plan and changes nothing', () => {
    const s = setup({ pages: 'none' });
    const r = run([...INSTALL, '--from', FIX, '--dry-run'], { env: s.env });
    expect(r.code, r.err).toBe(0);
    expect(r.out).toContain('create orphan branch specages/r/spec in o/specage-data');
    expect(r.out).toContain('create orphan branch specages/r/trail in o/specage-data');
    expect(r.out).toContain('gh-pages');
    expect(r.out).toContain('no dispatch tag');
    expect(r.out).toContain('nothing was changed');
    expect(spawnSync('git', ['--git-dir', s.bare, 'branch', '--list']).stdout.toString()).toBe('');
    expect(spawnSync('git', ['--git-dir', s.dataBare, 'branch', '--list']).stdout.toString()).toBe(
      '',
    );
    expect(s.calls()).not.toMatch(/secret|label/);
  });

  it('real run creates both orphan branches in the data repo; a second run is a no-op; --upgrade touches only templated files', () => {
    const spec = 'specages/r/spec';
    const trail = 'specages/r/trail';
    const s = setup({ pages: 'legacy' });
    const env = { ...s.env, INTERN_DISPATCH_TOKEN: 'pat', PROJECT_TOKEN: 'pat2' };
    const r = run([...INSTALL, '--from', FIX], { env });
    expect(r.code, r.out + r.err).toBe(0);
    expect(s.files(spec)).toEqual(
      expect.arrayContaining([
        'tbgwaf.specage',
        'GRAMMAR.md',
        '.specage/config.yaml',
        '.specage/policy.yaml',
        '.specage/PROTOCOL.md',
        '.github/workflows/specage-spec.yml',
      ]),
    );
    expect(s.files(trail)).toEqual(
      expect.arrayContaining([
        'trace.yaml',
        'work.yaml',
        'questions.yaml',
        'dispatches/.gitkeep',
        'outbox/.gitkeep',
        '.github/workflows/specage-trail.yml',
      ]),
    );
    // nothing is written to the project repo except gh-pages handling
    expect(spawnSync('git', ['--git-dir', s.bare, 'branch', '--list']).stdout.toString()).toBe('');
    expect(s.show(spec, 'tbgwaf.specage')).toBe(readFileSync(FIX, 'utf8'));
    expect(s.show(spec, '.specage/config.yaml')).toContain('project: r');
    expect(s.show(spec, '.specage/config.yaml')).toContain('repo: o/r');
    expect(s.show(spec, '.specage/config.yaml')).toContain('data_repo: o/specage-data');
    expect(s.show(spec, '.github/workflows/specage-spec.yml')).not.toMatch(/\{\{[a-z_]+\}\}/);
    expect(s.show(spec, '.github/workflows/specage-spec.yml')).toContain("tags: ['dispatch/r/*']");
    expect(s.show(trail, '.github/workflows/specage-trail.yml')).not.toMatch(/\{\{[a-z_]+\}\}/);
    expect(spawnSync('git', ['--git-dir', s.dataBare, 'tag', '--list']).stdout.toString()).toBe(''); // no dispatch tag
    expect(r.out).toContain('HUMAN checklist');
    const specHead = git(s.dataBare, 'rev-parse', spec).trim();
    const trailHead = git(s.dataBare, 'rev-parse', trail).trim();

    const again = run([...INSTALL, '--from', FIX], { env });
    expect(again.code, again.err).toBe(0);
    expect(again.out).toContain('spec branch exists: no change');
    expect(git(s.dataBare, 'rev-parse', spec).trim()).toBe(specHead);
    expect(git(s.dataBare, 'rev-parse', trail).trim()).toBe(trailHead);

    // hand-edit things --upgrade must never touch, and break a templated file
    const w = join(s.d, 'w');
    git(s.d, 'clone', '-q', '-b', spec, s.dataBare, w);
    writeFileSync(join(w, 'tbgwaf.specage'), 'edited by the human @h;\n');
    writeFileSync(
      join(w, '.specage/config.yaml'),
      readFileSync(join(w, '.specage/config.yaml'), 'utf8').replace(
        'reviewer: o',
        'reviewer: someone',
      ),
    );
    writeFileSync(join(w, 'GRAMMAR.md'), 'stale grammar\n');
    git(w, 'commit', '-qam', 'human edits');
    git(w, 'push', '-q', 'origin', spec);
    const up = run([...INSTALL, '--upgrade'], { env });
    expect(up.code, up.out + up.err).toBe(0);
    expect(s.show(spec, 'tbgwaf.specage')).toBe('edited by the human @h;\n');
    expect(s.show(spec, '.specage/config.yaml')).toContain('reviewer: someone');
    expect(s.show(spec, 'GRAMMAR.md')).toBe(
      readFileSync(join(root, 'protocol/GRAMMAR.md'), 'utf8'),
    );
    expect(git(s.dataBare, 'rev-parse', trail).trim()).toBe(trailHead); // trail data untouched
    const upAgain = run([...INSTALL, '--upgrade'], { env });
    expect(upAgain.out).toContain('already current');
  });

  it('private repos and Actions-built Pages force pages.mode off', () => {
    const p = setup({ pages: 'legacy', private: true });
    const r = run([...INSTALL, '--dry-run'], { env: p.env });
    expect(r.out).toContain('private repo');
    expect(r.out).toContain('pages: off');
    const w = setup({ pages: 'workflow' });
    const r2 = run([...INSTALL, '--dry-run'], { env: w.env });
    expect(r2.out).toContain('pages: off');
    expect(r2.out).toContain('Actions workflow');
  });

  it('rejects a --from file that does not parse', () => {
    const s = setup({ pages: 'none' });
    const bad = join(s.d, 'bad.specage');
    writeFileSync(bad, 'a @x { b @x.y;\n');
    expect(run([...INSTALL, '--from', bad, '--dry-run'], { env: s.env }).code).toBe(1);
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
