import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Conflict,
  NotFound,
  PermissionError,
  specBranch,
  trailBranch,
  type GitHub,
} from './github.js';

/** Project initialisation: what `specage install` used to do, using only the App installation token. */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');

export function render(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
}

export interface InitInput {
  repo: string;
  project?: string;
  backend?: string;
}

export class BadInit extends Error {}

export interface InitPlan {
  repo: string;
  project: string;
  data_repo: string;
  backend: string;
  branches: { name: string; action: 'create' | 'exists'; files: string[] }[];
  labels: string[];
  warnings: string[];
}

export const LABELS = ['specage-dispatch', 'specage'];

const REPO_RE = /^[\w.-]+\/[\w.-]+$/;
const PROJECT_RE = /^[A-Za-z0-9][\w.-]{0,63}$/;
const BACKEND_RE = /^[a-z][a-z0-9_-]{0,31}$/;

export function specFiles(vars: Record<string, string>): Record<string, string> {
  const t = (f: string) => read('templates', 'spec-branch', f);
  return {
    [vars.spec_file]: render(t('skeleton.specage'), vars),
    'GRAMMAR.md': read('protocol', 'GRAMMAR.md'),
    '.specage/PROTOCOL.md': read('protocol', 'PROTOCOL.md'),
    '.specage/config.yaml': render(t('config.yaml'), vars),
    '.specage/policy.yaml': t('policy.yaml'),
  };
}

export function trailFiles(): Record<string, string> {
  const t = (f: string) => read('templates', 'trail-branch', f);
  return {
    'trace.yaml': t('trace.yaml'),
    'work.yaml': t('work.yaml'),
    'questions.yaml': t('questions.yaml'),
    'dispatches/.gitkeep': '',
    'outbox/.gitkeep': '',
  };
}

function varsFor(p: { repo: string; project: string; backend: string }, o: InitEnv) {
  const projectId = p.project
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/^[^a-z]+/, 'p-');
  return {
    specage_version: 'v0',
    project: p.project,
    project_id: projectId,
    repo: p.repo,
    data_repo: o.dataRepo,
    spec_file: `${p.project}.specage`,
    reviewer: p.repo.split('/')[0],
    intern_repo: o.internRepo,
    intern_workflow: 'dispatcher.yml',
    backend: p.backend,
    pages_mode: 'off',
    pages_path: 'specage',
    ui_url: o.uiUrl,
  };
}

export interface InitEnv {
  dataRepo: string;
  internRepo: string;
  uiUrl: string;
}

/** Validates the input and reports what init would do. Read-only. */
export async function planInit(github: GitHub, env: InitEnv, input: InitInput): Promise<InitPlan> {
  const repo = String(input.repo ?? '');
  if (!REPO_RE.test(repo)) throw new BadInit('repo must be owner/repo');
  const project = input.project || repo.split('/')[1];
  if (!PROJECT_RE.test(project) || project.includes('..') || project.endsWith('.lock'))
    throw new BadInit('project name: letters, digits, . _ - (max 64)');
  // /api/r/:owner/:repo addresses a project by its repo name
  if (project !== repo.split('/')[1])
    throw new BadInit('project name must currently equal the repo name');
  const backend = input.backend || 'claude';
  if (!BACKEND_RE.test(backend)) throw new BadInit('invalid backend');
  try {
    await github.assertInstalled();
  } catch (e) {
    if (e instanceof NotFound)
      throw new PermissionError(`specage App is not installed on the data repo ${env.dataRepo}`);
    throw e;
  }
  const info = await github.getRepo(repo);
  if (!info)
    throw new PermissionError(
      `specage App is not installed on ${repo} (or the repo does not exist)`,
    );
  const vars = varsFor({ repo, project, backend }, env);
  const warnings: string[] = [];
  if (!info.private)
    warnings.push(
      'Project repo is public: dispatch issues and their diffs will be world-readable.',
    );
  const existing = await Promise.all([
    github.getRef(`heads/${specBranch(project)}`),
    github.getRef(`heads/${trailBranch(project)}`),
  ]);
  if (existing[0]) {
    const cfg = await github.getFile('.specage/config.yaml', specBranch(project));
    if (cfg && !new RegExp(`^repo: ${repo.replace(/[.]/g, '\\.')}\\s*$`, 'm').test(cfg))
      throw new BadInit(
        `project "${project}" already exists in the data repo for a different repo`,
      );
  }
  return {
    repo,
    project,
    data_repo: env.dataRepo,
    backend,
    branches: [
      {
        name: specBranch(project),
        action: existing[0] ? 'exists' : 'create',
        files: Object.keys(specFiles(vars)),
      },
      {
        name: trailBranch(project),
        action: existing[1] ? 'exists' : 'create',
        files: Object.keys(trailFiles()),
      },
    ],
    labels: LABELS,
    warnings,
  };
}

/** Idempotent: existing branches are left alone, labels are created when missing. */
export async function runInit(github: GitHub, env: InitEnv, input: InitInput): Promise<InitPlan> {
  const plan = await planInit(github, env, input);
  const vars = varsFor(plan, env);
  if (!existsSync(join(ROOT, 'templates')))
    throw new Error('templates missing from the server image');
  // labels first: a missing Issues permission fails before anything is written
  await github.ensureLabels(plan.repo, plan.labels);
  const make = async (kind: 'spec' | 'trail', files: Record<string, string>) => {
    try {
      await github.createOrphanBranch(plan.project, kind, files, 'specage: init');
    } catch (e) {
      if (!(e instanceof Conflict)) throw e;
    }
  };
  if (plan.branches[0].action === 'create') await make('spec', specFiles(vars));
  if (plan.branches[1].action === 'create') await make('trail', trailFiles());
  return plan;
}
