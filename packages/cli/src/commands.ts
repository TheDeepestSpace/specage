import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  OutboxSchema,
  buildData,
  diff,
  flatten,
  hasErrors,
  lint,
  loadState,
  parseComments,
  summarize,
  walk,
  type Diagnostic,
  type SpecNode,
} from '@specage/core';
import { setWorkState } from './callback.js';
import { buildDispatch, dispatchCommand, type DispatchContext } from './dispatch.js';
import { decide, type CallbackPayload, type PrFacts } from './verify.js';
import {
  CliError,
  cursorTag,
  git,
  gh,
  listFiles,
  loadSpecRef,
  readSpecFile,
  repoRoot,
  sleep,
  str,
  type Args,
} from './util.js';

type Out = (s: string) => void;
export const ctx: { out: Out } = { out: (s) => process.stdout.write(s + '\n') };
const out = (s: string) => ctx.out(s);

function nodeSummary(n: SpecNode): any {
  return {
    id: n.id,
    type: n.type,
    marker: n.marker,
    text: n.text,
    hash: n.hash,
    subtree_hash: n.subtreeHash,
    parent: n.parent,
    lineage: n.lineage,
    refs: n.refs,
    line: n.line,
    children: n.children.map(nodeSummary),
  };
}

export function cmdParse(a: Args): number {
  const file = a._[1];
  if (!file) throw new CliError('usage: specage parse <file> [--json]');
  const spec = readSpecFile(file);
  const errs = spec.diagnostics.filter((d) => d.level === 'error');
  if (a.flags.json)
    out(
      JSON.stringify(
        { nodes: spec.roots.map(nodeSummary), diagnostics: spec.diagnostics },
        null,
        2,
      ),
    );
  else {
    const p = (n: SpecNode, d: number) => {
      out(
        `${'  '.repeat(d)}${n.id}${n.type === 'block' ? ' {}' : ''}  ${n.hash}  ${n.text.slice(0, 60)}`,
      );
      n.children.forEach((c) => p(c, d + 1));
    };
    spec.roots.forEach((r) => p(r, 0));
  }
  return errs.length ? 1 : 0;
}

export function formatDiag(file: string, d: Diagnostic): string {
  return `${file}:${d.line}:${d.column} ${d.level === 'error' ? 'error' : 'warning'} ${d.code} ${d.message}${d.node ? ` [${d.node}]` : ''}`;
}

export function cmdLint(a: Args): number {
  const file = a._[1];
  if (!file) throw new CliError('usage: specage lint <file> [--state <dir>] [--json]');
  const spec = readSpecFile(file);
  let ls;
  const sd = str(a, 'state');
  if (sd) {
    const { state, issues } = loadState(sd);
    if (issues.length)
      throw new CliError(
        `invalid state: ${issues.map((i) => `${i.file} ${i.message}`).join('; ')}`,
        1,
      );
    ls = { retiredIds: state.trace.retired_ids, consumedLineage: state.trace.consumed_lineage };
  }
  const diags = lint(spec, ls);
  if (a.flags.json)
    out(
      JSON.stringify(
        diags.map((d) => ({ file, ...d, node: d.node ?? null })),
        null,
        2,
      ),
    );
  else {
    diags.forEach((d) => out(formatDiag(file, d)));
    const e = diags.filter((d) => d.level === 'error').length;
    out(`${e} error(s), ${diags.length - e} warning(s)`);
  }
  return hasErrors(diags) ? 1 : 0;
}

export function cmdHash(a: Args): number {
  const file = a._[1];
  if (!file) throw new CliError('usage: specage hash <file> [--json]');
  const spec = readSpecFile(file);
  const rows: { id: string; hash: string; subtree_hash: string }[] = [];
  walk(spec.roots, (n) => rows.push({ id: n.id, hash: n.hash, subtree_hash: n.subtreeHash }));
  if (a.flags.json)
    out(
      JSON.stringify(
        Object.fromEntries(rows.map((r) => [r.id, { hash: r.hash, subtree_hash: r.subtree_hash }])),
        null,
        2,
      ),
    );
  else rows.forEach((r) => out(`${r.id}\t${r.hash}\t${r.subtree_hash}`));
  return spec.diagnostics.some((d) => d.level === 'error') ? 1 : 0;
}

export function cmdDiff(a: Args): number {
  const from = str(a, 'from');
  const to = str(a, 'to');
  if (!from || !to)
    throw new CliError('usage: specage diff --from <ref|file|empty> --to <ref|file> [--json]');
  const opts = {
    specFile: str(a, 'spec-file'),
    to,
    cwd: str(a, 'cwd'),
    project: str(a, 'project'),
  };
  const d = diff(loadSpecRef(from, opts), loadSpecRef(to, opts));
  out(a.flags.json ? JSON.stringify(d, null, 2) : summarize(d));
  return 0;
}

export function cmdCursor(a: Args): number {
  const c = cursorTag(str(a, 'tag'), str(a, 'cwd'), str(a, 'project'));
  out(c ?? '');
  return 0;
}

export function cmdState(a: Args): number {
  const sub = a._[1];
  if (sub === 'validate') {
    const dir = a._[2];
    if (!dir) throw new CliError('usage: specage state validate <dir>');
    const { state, issues } = loadState(dir);
    const dirOutbox = join(dir, 'outbox');
    for (const f of listFiles(dirOutbox).filter((f) => f.endsWith('.json'))) {
      const r = OutboxSchema.safeParse(JSON.parse(readFileSync(join(dirOutbox, f), 'utf8')));
      if (!r.success)
        issues.push({
          file: `outbox/${f}`,
          message: r.error.issues.map((i) => i.message).join('; '),
        });
    }
    // a withdrawn item must not keep an unfired outbox entry (it would implement a retired node)
    const withdrawn = new Set(
      state.work.items.filter((w) => w.state === 'withdrawn' && w.issue).map((w) => w.issue),
    );
    for (const f of listFiles(dirOutbox).filter((f) => f.endsWith('.json'))) {
      const e = OutboxSchema.safeParse(JSON.parse(readFileSync(join(dirOutbox, f), 'utf8')));
      if (e.success && !e.data.fired && withdrawn.has(e.data.target))
        issues.push({
          file: `outbox/${f}`,
          message: `unfired entry targets withdrawn issue #${e.data.target}; delete it`,
        });
    }
    issues.forEach((i) => out(`${i.file}: ${i.message}`));
    if (!issues.length) out('state ok');
    return issues.length ? 1 : 0;
  }
  if (sub === 'commit') {
    const msg = str(a, 'm');
    if (!msg) throw new CliError('usage: specage state commit -m <msg> [--dir <state checkout>]');
    const dir = resolve(str(a, 'dir') ?? '.');
    const { issues } = loadState(dir);
    if (issues.length) {
      issues.forEach((i) => out(`${i.file}: ${i.message}`));
      return 1;
    }
    git(['add', '-A'], dir);
    if (!git(['status', '--porcelain'], dir).trim()) {
      out('nothing to commit');
      return 0;
    }
    git(['commit', '-m', msg], dir);
    const remote = str(a, 'remote') ?? 'origin';
    // default to the checked-out trail branch (specages/<project>/trail)
    const branch = str(a, 'branch') ?? git(['rev-parse', '--abbrev-ref', 'HEAD'], dir).trim();
    let last = '';
    for (let i = 0; i < 5; i++) {
      try {
        git(['pull', '--rebase', remote, branch], dir);
        git(['push', remote, `HEAD:${branch}`], dir);
        out(`pushed to ${remote}/${branch}`);
        return 0;
      } catch (e: any) {
        last = e.message;
        sleepSync(1000 * 2 ** i);
      }
    }
    throw new CliError(`push failed after 5 tries: ${last}`, 3);
  }
  throw new CliError('usage: specage state validate <dir> | commit -m <msg>');
}

function sleepSync(ms: number) {
  if (process.env.SPECAGE_NO_SLEEP) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
void sleep;

/** Outbox entries added between two commits of the trail branch. */
export function addedOutbox(range: string, cwd: string): string[] {
  const [a, b] = range.split('..');
  if (!a || !b) throw new CliError('--range must be <a>..<b>');
  const zero = /^0+$/.test(a);
  const names = zero
    ? git(['ls-tree', '-r', '--name-only', b], cwd).split('\n')
    : git(['diff', '--name-only', '--diff-filter=A', a, b], cwd).split('\n');
  return names.filter((n) => /^outbox\/[^/]+\.json$/.test(n));
}

export function cmdOutbox(a: Args): number {
  if (a._[1] !== 'fire')
    throw new CliError(
      'usage: specage outbox fire --range <a>..<b> --repo <o/r> --intern <o/r> --project <p> --data-repo <o/r>',
    );
  const range = str(a, 'range');
  const repo = str(a, 'repo');
  const intern = str(a, 'intern');
  const unfired = !!a.flags['unfired'];
  if ((!range && !unfired) || !repo || !intern)
    throw new CliError('outbox fire needs --range (or --unfired), --repo and --intern');
  const workflow = str(a, 'workflow') ?? 'dispatcher.yml';
  const backend = str(a, 'backend') ?? 'claude';
  const cwd = str(a, 'cwd') ?? '.';
  const project = str(a, 'project');
  const dataRepo = str(a, 'data-repo');
  const specageRepo = str(a, 'specage-repo') ?? 'TheDeepestSpace/specage';
  if (!project || !dataRepo) throw new CliError('outbox fire needs --project and --data-repo');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo))
    throw new CliError(`--repo must be owner/repo, got "${repo}"`);
  if (repo.toLowerCase() === dataRepo.toLowerCase())
    throw new CliError(`--repo equals the data repo (${dataRepo}); refusing to dispatch there`);
  const b = range?.split('..')[1];
  let failed = 0;
  // --unfired: every outbox/*.json in the working tree without a `fired` mark (idempotent; marks are written back)
  const files = unfired
    ? listFiles(join(cwd, 'outbox'))
        .filter((f) => f.endsWith('.json'))
        .map((f) => `outbox/${f}`)
    : addedOutbox(range!, cwd);
  for (const f of files) {
    const raw = unfired ? readFileSync(join(cwd, f), 'utf8') : git(['show', `${b}:${f}`], cwd);
    const entry = OutboxSchema.parse(JSON.parse(raw));
    if (unfired && entry.fired) continue;
    const implement = entry.kind === 'implement';
    try {
      const dispatch = buildDispatch({
        kind: implement ? 'implement' : 'amend',
        repo,
        data_repo: dataRepo,
        specage_repo: specageRepo,
        prompt_ref: str(a, 'prompt-ref') ?? 'main',
        project,
        spec_ids: entry.spec_ids,
        ...(implement ? { issue: entry.target } : { pr: entry.target }),
        backend: entry.backend ?? backend,
        model: entry.model ?? str(a, 'model'),
        effort: entry.effort ?? str(a, 'effort'),
        max_attempts: Number(str(a, 'max-attempts')) || undefined,
        correction: implement ? undefined : entry.body,
      });
      const cmd = dispatchCommand(intern, workflow, dispatch);
      if (a.flags['dry-run']) out(`gh ${cmd.map((c) => JSON.stringify(c)).join(' ')}`);
      else {
        gh(cmd);
        out(`fired ${entry.id} -> #${entry.target}`);
        if (unfired)
          writeFileSync(
            join(cwd, f),
            JSON.stringify({ ...JSON.parse(raw), fired: new Date().toISOString() }, null, 2) + '\n',
          );
      }
    } catch (e: any) {
      failed++;
      out(`FAILED ${entry.id}: ${e.message}`);
    }
  }
  return failed ? 3 : 0;
}

function prFacts(repo: string, n: number): PrFacts {
  const pr = JSON.parse(gh(['api', `repos/${repo}/pulls/${n}`]));
  const commits = JSON.parse(gh(['api', '--paginate', `repos/${repo}/pulls/${n}/commits`]));
  return {
    number: n,
    state: pr.state,
    merged: !!pr.merged,
    body: pr.body ?? '',
    commits: commits.map((c: any) => c.commit.message as string),
  };
}

/** `specage callback`: the-intern's callback workflow. Re-reads GitHub, verifies, redispatches or marks state. */
export function cmdCallback(a: Args): number {
  const status = str(a, 'status');
  if (status !== 'success' && status !== 'failure' && status !== 'cancelled')
    throw new CliError('callback needs --status success|failure|cancelled');
  let ctx: DispatchContext;
  try {
    ctx = JSON.parse(str(a, 'context') ?? '');
  } catch {
    throw new CliError('callback needs --context <json>');
  }
  const prNum = Number(str(a, 'pr')) || undefined;
  const issue = Number(str(a, 'issue')) || ctx.issue;
  const payload: CallbackPayload = {
    status,
    run_url: str(a, 'run-url'),
    pr: prNum,
    issue,
    context: ctx,
  };
  if (!/^[\w.-]+\/[\w.-]+$/.test(ctx.repo ?? ''))
    throw new CliError('context.repo missing or invalid');
  if (!Number.isInteger(ctx.attempt) || !Number.isInteger(ctx.max_attempts))
    throw new CliError('context.attempt / max_attempts missing');
  const owner = str(a, 'owner');
  if (owner && ctx.repo.split('/')[0] !== owner)
    throw new CliError(`context.repo is outside ${owner}`);
  if (ctx.kind === 'planner') {
    // a planner session has no PR to verify and no work item; the run's outcome is all there is
    out(JSON.stringify({ action: 'none', kind: 'planner', status }));
    return status === 'success' ? 0 : 1;
  }
  const pr = status === 'success' && prNum ? prFacts(ctx.repo, prNum) : null;
  const d = decide(payload, pr, issue);
  out(JSON.stringify(d));
  const stateDir = str(a, 'state-dir');
  const at = { issue, pr: prNum };
  if (d.action === 'redispatch') {
    const specage = str(a, 'specage-repo');
    const data = str(a, 'data-repo');
    const intern = str(a, 'intern');
    if (!specage || !data || !intern)
      throw new CliError('redispatch needs --specage-repo, --data-repo and --intern');
    const dispatch = buildDispatch({
      kind: prNum ? 'amend' : ctx.kind,
      repo: ctx.repo,
      data_repo: data,
      specage_repo: specage,
      prompt_ref: str(a, 'prompt-ref') ?? 'main',
      project: ctx.project,
      spec_ids: ctx.spec_ids,
      issue,
      pr: prNum,
      backend: str(a, 'backend'),
      model: str(a, 'model'),
      attempt: d.attempt,
      max_attempts: ctx.max_attempts,
      correction: d.correction,
    });
    const cmd = dispatchCommand(intern, str(a, 'workflow') ?? 'dispatcher.yml', dispatch);
    if (a.flags['dry-run']) out(`gh ${cmd.map((c) => JSON.stringify(c)).join(' ')}`);
    else gh(cmd);
    if (stateDir) setWorkState(stateDir, at, 'in_progress');
  } else if (stateDir && !setWorkState(stateDir, at, d.state))
    out(`no work item for issue=${issue ?? '-'} pr=${prNum ?? '-'}; state unchanged`);
  return 0;
}

export function cmdRender(a: Args): number {
  const specFile = str(a, 'spec');
  const stateDir = str(a, 'state');
  const outDir = str(a, 'out');
  if (!specFile || !outDir)
    throw new CliError('usage: specage render --spec <file> --state <dir> --out <dir>');
  const spec = readSpecFile(specFile);
  const { state, issues } = stateDir ? loadState(stateDir) : loadState('/nonexistent');
  if (issues.length)
    throw new CliError(
      `invalid state: ${issues.map((i) => `${i.file} ${i.message}`).join('; ')}`,
      1,
    );
  let report: string | undefined;
  if (stateDir) {
    const rs = listFiles(join(stateDir, 'dispatches')).filter((f) => f.endsWith('.md'));
    if (rs.length) report = readFileSync(join(stateDir, 'dispatches', rs[rs.length - 1]), 'utf8');
  }
  const commentsFile = str(a, 'comments');
  const cm = parseComments(
    commentsFile && existsSync(commentsFile) ? readFileSync(commentsFile, 'utf8') : null,
  );
  if (cm.issues.length) throw new CliError(`invalid comments: ${cm.issues.join('; ')}`, 1);
  const data = buildData(spec, state, {
    threads: cm.threads,
    project: str(a, 'project') ?? (specFile.split('/').pop() ?? '').replace(/\.specage$/, ''),
    report,
    editUrl: str(a, 'edit-url'),
    repo: str(a, 'repo'),
    specCommit: str(a, 'spec-commit'),
  });
  const webDist = str(a, 'web-dist') ?? join(repoRoot(), 'packages', 'web', 'dist');
  if (!existsSync(join(webDist, 'index.html')))
    throw new CliError(`web build not found at ${webDist}; run "npm run build -w @specage/web"`, 1);
  mkdirSync(outDir, { recursive: true });
  cpSync(webDist, outDir, { recursive: true });
  writeFileSync(join(outDir, 'data.json'), JSON.stringify(data));
  out(`rendered ${flatten(spec).length} nodes to ${outDir}`);
  return 0;
}
