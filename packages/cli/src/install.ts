import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { ConfigSchema, parse, parseYaml } from '@specage/core';
import {
  CliError,
  DEFAULT_DATA_REPO,
  gh,
  git,
  protocolDir,
  specBranch,
  str,
  templatesDir,
  trailBranch,
  type Args,
} from './util.js';

const out = (s: string) => process.stdout.write(s + '\n');

function readRemoteConfig(dataRepo: string, branch: string) {
  const dir = mkdtempSync(join(tmpdir(), 'specage-cfg-'));
  git(['clone', '-q', '--depth', '1', '--branch', branch, authUrl(dataRepo), dir]);
  return ConfigSchema.parse(parseYaml(read(dir, '.specage/config.yaml')));
}

export function render(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
}

interface Step {
  title: string;
  run?: () => void;
}

const read = (...p: string[]) => readFileSync(join(...p), 'utf8');

function ghJson(args: string[]): any | null {
  const r = spawnSync('gh', ['api', ...args], { encoding: 'utf8' });
  if (r.status !== 0) {
    if (/404|Not Found/.test(r.stderr + r.stdout)) return null;
    throw new CliError(`gh api ${args.join(' ')}: ${r.stderr.trim()}`, 3);
  }
  return r.stdout.trim() ? JSON.parse(r.stdout) : {};
}

export function specFiles(
  vars: Record<string, string>,
  specContent: string,
): Record<string, string> {
  const t = join(templatesDir(), 'spec-branch');
  return {
    [vars.spec_file]: specContent,
    'GRAMMAR.md': read(protocolDir(), 'GRAMMAR.md'),
    '.specage/PROTOCOL.md': read(protocolDir(), 'PROTOCOL.md'),
    '.specage/config.yaml': render(read(t, 'config.yaml'), vars),
    '.specage/policy.yaml': read(t, 'policy.yaml'),
    '.github/workflows/specage-spec.yml': render(read(t, 'specage-spec.yml'), vars),
  };
}

/** Files that --upgrade may rewrite (never spec text, config values or state data). */
export const TEMPLATED_SPEC = (specFile: string) =>
  Object.keys(specFiles({ spec_file: specFile }, '')).filter(
    (f) => f !== specFile && f !== '.specage/config.yaml' && f !== '.specage/policy.yaml',
  );

export function trailFiles(vars: Record<string, string>): Record<string, string> {
  const t = join(templatesDir(), 'trail-branch');
  return {
    'trace.yaml': read(t, 'trace.yaml'),
    'work.yaml': read(t, 'work.yaml'),
    'questions.yaml': read(t, 'questions.yaml'),
    'dispatches/.gitkeep': '',
    'outbox/.gitkeep': '',
    '.github/workflows/specage-trail.yml': render(read(t, 'specage-trail.yml'), vars),
  };
}
export const TEMPLATED_TRAIL = ['.github/workflows/specage-trail.yml'];

function writeAll(dir: string, files: Record<string, string>) {
  for (const [f, c] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), c);
  }
}

function authUrl(repo: string): string {
  // SPECAGE_GIT_BASE lets tests point at local bare repos (<base>/<owner>/<repo>.git)
  if (process.env.SPECAGE_GIT_BASE) return `${process.env.SPECAGE_GIT_BASE}/${repo}.git`;
  const token = gh(['auth', 'token']).trim();
  return `https://x-access-token:${token}@github.com/${repo}.git`;
}

function pushOrphan(repo: string, branch: string, files: Record<string, string>, msg: string) {
  const dir = mkdtempSync(join(tmpdir(), 'specage-install-'));
  git(['init', '-q'], dir);
  git(['checkout', '-q', '--orphan', branch], dir);
  writeAll(dir, files);
  git(['add', '-A'], dir);
  git(
    [
      '-c',
      'user.name=specage',
      '-c',
      'user.email=specage@users.noreply.github.com',
      'commit',
      '-qm',
      msg,
    ],
    dir,
  );
  git(['push', '-q', authUrl(repo), `${branch}:refs/heads/${branch}`], dir);
}

function upgradeBranch(
  repo: string,
  branch: string,
  files: Record<string, string>,
  only: string[],
  msg: string,
): boolean {
  const dir = mkdtempSync(join(tmpdir(), 'specage-upgrade-'));
  git(['clone', '-q', '--depth', '1', '--branch', branch, authUrl(repo), dir]);
  writeAll(dir, Object.fromEntries(Object.entries(files).filter(([f]) => only.includes(f))));
  // keep the pinned version in config.yaml current without touching other values
  const cfg = join(dir, '.specage/config.yaml');
  if (existsSync(cfg) && files['.specage/config.yaml']) {
    const v = /^specage_version: .*/m.exec(files['.specage/config.yaml'])?.[0];
    if (v) writeFileSync(cfg, read(cfg).replace(/^specage_version: .*/m, v));
  }
  git(['add', '-A'], dir);
  if (!git(['status', '--porcelain'], dir).trim()) return false;
  git(
    [
      '-c',
      'user.name=specage',
      '-c',
      'user.email=specage@users.noreply.github.com',
      'commit',
      '-qm',
      msg,
    ],
    dir,
  );
  git(['push', '-q', 'origin', `HEAD:${branch}`], dir);
  return true;
}

async function promptSecret(q: string): Promise<string> {
  if (!process.stdin.isTTY) return '';
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  (rl as any)._writeToOutput = () => {};
  process.stdout.write(q);
  return new Promise((res) =>
    rl.question('', (a) => {
      rl.close();
      process.stdout.write('\n');
      res(a.trim());
    }),
  );
}

async function confirm(q: string, expect: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) =>
    rl.question(`${q} (type "${expect}" to confirm): `, (a) => {
      rl.close();
      res(a.trim() === expect);
    }),
  );
}

/** Rulesets for the data repo: one set covers every project's branches and tags. */
function rulesetBodies(admin: boolean, specageApp?: string, internApp?: string) {
  const bypass = (ids: (string | undefined)[], extra: any[] = []) => [
    { actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' },
    ...ids
      .filter(Boolean)
      .map((id) => ({ actor_id: Number(id), actor_type: 'Integration', bypass_mode: 'always' })),
    ...extra,
  ];
  const mk = (
    name: string,
    target: 'branch' | 'tag',
    include: string[],
    rules: string[],
    ids: (string | undefined)[],
  ) => ({
    name,
    target,
    enforcement: 'active',
    conditions: { ref_name: { include, exclude: [] } },
    rules: rules.map((type) => ({ type })),
    bypass_actors: bypass(ids),
  });
  void admin;
  return [
    mk(
      'specage: spec branches',
      'branch',
      ['refs/heads/specages/*/spec'],
      ['non_fast_forward', 'deletion'],
      [specageApp],
    ),
    mk(
      'specage: trail branches',
      'branch',
      ['refs/heads/specages/*/trail'],
      ['non_fast_forward', 'deletion'],
      [internApp],
    ),
    mk(
      'specage: dispatch tags',
      'tag',
      ['refs/tags/dispatch/*'],
      ['update', 'deletion'],
      [specageApp],
    ),
  ];
}

export async function cmdInstall(a: Args): Promise<number> {
  const repo = str(a, 'repo');
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo))
    throw new CliError(
      'usage: specage install --repo <owner/repo> [--data-repo <owner/repo>] [--spec-file <name>.specage | --from <file>] [--upgrade] [--dry-run]',
    );
  const dataRepo = str(a, 'data-repo') ?? DEFAULT_DATA_REPO;
  if (!/^[\w.-]+\/[\w.-]+$/.test(dataRepo)) throw new CliError('--data-repo must be <owner/repo>');
  const dry = !!a.flags['dry-run'];
  const upgrade = !!a.flags.upgrade;
  const from = str(a, 'from');
  // project name = repo name: it keys the specages/<project>/* branches in the data repo
  const name = repo.split('/')[1];
  const spec = specBranch(name);
  const trail = trailBranch(name);
  const specFile = str(a, 'spec-file') ?? (from ? basename(from) : `${name}.specage`);
  if (!specFile.endsWith('.specage')) throw new CliError('spec file must end in .specage');
  const internRepo = str(a, 'intern-repo') ?? 'TheDeepestSpace/the-intern';
  const version = str(a, 'specage-version') ?? 'v0';
  const uiUrl = str(a, 'ui-url') ?? 'https://specage.fly.dev';
  const plan: string[] = [];
  const steps: Step[] = [];

  // 1. preflight
  const info = ghJson([`repos/${repo}`]);
  if (!info) throw new CliError(`repo ${repo} not found or not reachable`, 3);
  if (info.permissions && !info.permissions.admin)
    throw new CliError(`gh is not authenticated with admin access to ${repo}`, 3);
  const dataInfo = ghJson([`repos/${dataRepo}`]);
  if (!dataInfo)
    throw new CliError(
      `data repo ${dataRepo} not found: create it first (gh repo create ${dataRepo} --private)`,
      3,
    );
  if (dataInfo.permissions && !dataInfo.permissions.push)
    throw new CliError(`gh is not authenticated with push access to ${dataRepo}`, 3);
  if (!dataInfo.private)
    out(`WARNING: data repo ${dataRepo} is public; spec and trail data will be world-readable.`);
  const defaultBranch: string = info.default_branch;
  const isPrivate: boolean = !!info.private;
  const specExists = !!ghJson([`repos/${dataRepo}/branches/${spec}`]);
  const trailExists = !!ghJson([`repos/${dataRepo}/branches/${trail}`]);
  const pages = ghJson([`repos/${repo}/pages`]);
  out(`repo ${repo}: default branch ${defaultBranch}, ${isPrivate ? 'private' : 'public'}`);
  out(`data repo ${dataRepo}: project ${name}`);
  out(
    `branches: ${spec} ${specExists ? 'exists' : 'missing'}, ${trail} ${trailExists ? 'exists' : 'missing'}`,
  );
  out(
    `pages: ${pages ? `${pages.build_type ?? 'legacy'}${pages.source ? ` from ${pages.source.branch}${pages.source.path}` : ''}` : 'not enabled'}`,
  );

  let pagesMode: 'gh-pages-subdir' | 'off' = 'gh-pages-subdir';
  let pagesBranch = 'gh-pages';
  if (isPrivate) {
    pagesMode = 'off';
    out(
      'WARNING: private repo; Pages sites are public, so pages.mode is forced to "off". View through the specage server.',
    );
  } else if (pages?.build_type === 'workflow') {
    pagesMode = 'off';
    out(
      'NOTE: Pages is built by an Actions workflow; pages.mode set to "off". Add `specage render --spec <file> --state <dir> --out <dir>/specage` to your Pages build to publish.',
    );
  } else if (pages?.source?.branch) pagesBranch = pages.source.branch;

  let specContent: string;
  const projectId = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/^[^a-z]+/, 'p-');
  if (from) {
    if (!existsSync(from)) throw new CliError(`--from file not found: ${from}`);
    specContent = read(from);
    const errs = parse(specContent).diagnostics.filter((d) => d.level === 'error');
    if (errs.length)
      throw new CliError(
        `--from file has parse errors (run specage lint): ${errs[0].message} at line ${errs[0].line}`,
        1,
      );
  } else
    specContent = render(read(templatesDir(), 'spec-branch', 'skeleton.specage'), {
      project: name,
      project_id: projectId,
    });

  const vars: Record<string, string> = {
    specage_version: version,
    project: name,
    repo,
    data_repo: dataRepo,
    spec_file: specFile,
    reviewer: str(a, 'reviewer') ?? repo.split('/')[0],
    intern_repo: internRepo,
    intern_workflow: 'dispatcher.yml',
    backend: 'claude',
    pages_mode: pagesMode,
    pages_path: 'specage',
    pages_branch: pagesBranch,
    pages_enabled: String(pagesMode !== 'off'),
    ui_url: uiUrl,
  };

  if (upgrade && specExists) {
    // an upgrade must reuse what is installed, not re-derive defaults
    const cfg = readRemoteConfig(dataRepo, spec);
    Object.assign(vars, {
      project: cfg.project,
      repo: cfg.repo ?? repo,
      data_repo: cfg.data_repo ?? dataRepo,
      spec_file: cfg.spec_file,
      reviewer: cfg.reviewer,
      intern_repo: cfg.intern.repo,
      intern_workflow: cfg.intern.workflow,
      backend: cfg.intern.backend,
      pages_mode: cfg.pages.mode,
      pages_path: cfg.pages.path,
      pages_enabled: String(cfg.pages.mode !== 'off'),
      ui_url: cfg.ui.url ?? '',
      pages_branch: pagesBranch,
      specage_version: str(a, 'specage-version') ?? cfg.specage_version,
    });
  }

  // 2. spec branch (in the data repo)
  if (!specExists) {
    plan.push(
      `create orphan branch ${spec} in ${dataRepo}: ${Object.keys(specFiles(vars, '')).join(', ')}`,
    );
    steps.push({
      title: 'spec branch',
      run: () => pushOrphan(dataRepo, spec, specFiles(vars, specContent), 'specage: install'),
    });
  } else if (upgrade) {
    const only = TEMPLATED_SPEC(specFile);
    plan.push(
      `upgrade ${spec} (templated files only): ${only.join(', ')}; specage_version in config.yaml`,
    );
    steps.push({
      title: 'spec upgrade',
      run: () =>
        out(
          upgradeBranch(dataRepo, spec, specFiles(vars, ''), only, 'specage: upgrade')
            ? 'spec upgraded'
            : 'spec already current',
        ),
    });
  } else plan.push('spec branch exists: no change (use --upgrade to refresh templated files)');

  // 3. trail branch (in the data repo)
  if (!trailExists) {
    plan.push(
      `create orphan branch ${trail} in ${dataRepo}: ${Object.keys(trailFiles(vars)).join(', ')}`,
    );
    steps.push({
      title: 'trail branch',
      run: () => pushOrphan(dataRepo, trail, trailFiles(vars), 'specage: install'),
    });
  } else if (upgrade) {
    plan.push(`upgrade ${trail} (templated files only): ${TEMPLATED_TRAIL.join(', ')}`);
    steps.push({
      title: 'trail upgrade',
      run: () =>
        out(
          upgradeBranch(dataRepo, trail, trailFiles(vars), TEMPLATED_TRAIL, 'specage: upgrade')
            ? 'trail upgraded'
            : 'trail already current',
        ),
    });
  } else plan.push('trail branch exists: no change');

  // 4. pages (on the project repo)
  if (pagesMode === 'off') plan.push('pages: off');
  else if (!pages) {
    plan.push(
      'pages: create gh-pages branch with a minimal index and enable Pages from gh-pages /',
    );
    steps.push({
      title: 'pages',
      run: () => {
        if (!ghJson([`repos/${repo}/branches/gh-pages`]))
          pushOrphan(
            repo,
            'gh-pages',
            {
              'index.html': `<!doctype html><title>${name}</title><p>${name}: see <a href="specage/">specage/</a>\n`,
            },
            'specage: init pages',
          );
        gh([
          'api',
          '-X',
          'POST',
          `repos/${repo}/pages`,
          '-f',
          'source[branch]=gh-pages',
          '-f',
          'source[path]=/',
        ]);
      },
    });
  } else
    plan.push(
      `pages: publish under /${vars.pages_path}/ on ${pagesBranch}, preserving everything else`,
    );

  // 5. secrets: set once on the data repo, shared by every project
  const secretNote = `secrets on ${dataRepo}: INTERN_DISPATCH_TOKEN, PROJECT_TOKEN (set once; skipped when already present)`;
  plan.push(secretNote + (dry ? ' [skipped in --dry-run]' : ''));
  // 6. labels
  plan.push(`labels on ${repo}: specage-dispatch, specage`);
  if (a.flags.rulesets)
    plan.push(
      `rulesets on ${dataRepo}: specages/*/spec, specages/*/trail, dispatch/* tags (HUMAN-CONFIRM at run time)`,
    );
  plan.push('no dispatch tag is created: the first dispatch diffs against an empty spec');

  out('\nPlan:');
  plan.forEach((p) => out(`  - ${p}`));
  if (dry) {
    out('\n--dry-run: nothing was changed.');
    return 0;
  }

  for (const s of steps) {
    out(`> ${s.title}`);
    s.run?.();
  }
  for (const l of ['specage-dispatch', 'specage'])
    gh(['label', 'create', l, '-R', repo, '--force', '--color', '5319e7']);

  const existingSecrets = gh(['secret', 'list', '-R', dataRepo]);
  const ensureSecret = async (key: string, envVar: string, hint: string) => {
    if (new RegExp(`^${key}\\b`, 'm').test(existingSecrets)) {
      out(`${key} already set on ${dataRepo}`);
      return;
    }
    let token = process.env[envVar] ?? '';
    if (!token) token = await promptSecret(`${key} (${hint}; input hidden, empty to skip): `);
    if (token) gh(['secret', 'set', key, '-R', dataRepo], token);
    else out(`${key} not set: run \`gh secret set ${key} -R ${dataRepo}\` yourself`);
  };
  await ensureSecret(
    'INTERN_DISPATCH_TOKEN',
    'INTERN_DISPATCH_TOKEN',
    'fine-grained PAT: the-intern, Actions read/write',
  );
  await ensureSecret(
    'PROJECT_TOKEN',
    'PROJECT_TOKEN',
    'fine-grained PAT over the project repos: Contents read/write, Issues read/write',
  );

  if (a.flags.rulesets) {
    out(
      `\nRulesets to create on ${dataRepo}:\n` +
        JSON.stringify(
          rulesetBodies(true, str(a, 'specage-app-id'), str(a, 'intern-app-id')),
          null,
          2,
        ),
    );
    if (await confirm(`Create these rulesets on ${dataRepo}?`, dataRepo)) {
      for (const b of rulesetBodies(true, str(a, 'specage-app-id'), str(a, 'intern-app-id')))
        gh(['api', '-X', 'POST', `repos/${dataRepo}/rulesets`, '--input', '-'], JSON.stringify(b));
    } else out('rulesets skipped (not confirmed)');
  }

  out(`\nHUMAN checklist:
  [ ] specage GitHub App installed on ${dataRepo}
  [ ] the-intern has push access to ${dataRepo} (App installation or its PAT)
  [ ] PROJECT_TOKEN PAT covers ${repo} (Contents + Issues write); extend it when adding a project
  [ ] first dispatch:  git fetch origin ${spec} && git tag dispatch/${name}/$(date -u +%Y-%m-%dT%H-%MZ) FETCH_HEAD && git push origin --tags
      (run in a clone of ${dataRepo}, or press Dispatch in the editor)
  Pages:  ${pagesMode === 'off' ? 'off' : `https://${repo.split('/')[0].toLowerCase()}.github.io/${name}/${vars.pages_path}/`}
  Server: ${uiUrl}/r/${repo}`);
  return 0;
}
