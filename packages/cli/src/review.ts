import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import YAML from 'yaml';
import { CliError, git, str, type Args } from './util.js';

export interface ReviewTarget {
  dataRepo: string;
  project: string;
  /** branch in the data repo that a review commit is pushed to */
  branch: string;
  /** branch the review branch is created from when missing */
  base: string;
}

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const NAME = /^[A-Za-z0-9_.-]+$/;

/** Resolve the data repo and review branch from the text of `.specage/config.yaml`. */
export function resolveReviewTarget(configText: string): ReviewTarget {
  const cfg = YAML.parse(configText);
  const dataRepo = cfg?.data_repo;
  const project = cfg?.project;
  if (typeof dataRepo !== 'string' || !REPO.test(dataRepo))
    throw new CliError('config: data_repo missing or not <owner>/<repo>', 2);
  if (typeof project !== 'string' || !NAME.test(project))
    throw new CliError('config: project missing or invalid', 2);
  return {
    dataRepo,
    project,
    branch: `specages/${project}/review`,
    base: `specages/${project}/trail`,
  };
}

/**
 * Push an empty `review <repo>#<pr>` commit to the data repo's review branch.
 * Returns 'pushed' or 'skipped' (this head SHA already has a review commit).
 */
export function startReview(opts: {
  remote: string;
  target: ReviewTarget;
  repo: string;
  pr: number;
  headSha: string;
  retries?: number;
}): 'pushed' | 'skipped' {
  const { remote, target, repo, pr, headSha } = opts;
  const dir = mkdtempSync(join(tmpdir(), 'specage-review-'));
  git(['init', '-q', dir]);
  git(['remote', 'add', 'origin', remote], dir);
  const marker = `head: ${headSha}`;
  for (let i = 0; i < (opts.retries ?? 5); i++) {
    git(['fetch', '-q', 'origin', target.base], dir);
    let hasReview = true;
    try {
      git(['fetch', '-q', 'origin', target.branch], dir);
    } catch {
      hasReview = false;
    }
    git(
      ['checkout', '-q', '-B', target.branch, hasReview ? 'FETCH_HEAD' : 'origin/' + target.base],
      dir,
    );
    if (
      hasReview &&
      git(['log', '--fixed-strings', `--grep=${marker}`, '--format=%H', '-n1'], dir).trim()
    )
      return 'skipped';
    git(
      [
        '-c',
        'user.name=specage',
        '-c',
        'user.email=specage@users.noreply.github.com',
        'commit',
        '-q',
        '--allow-empty',
        '-m',
        `review ${repo}#${pr}`,
        '-m',
        marker,
      ],
      dir,
    );
    try {
      git(['push', '-q', 'origin', `${target.branch}:${target.branch}`], dir);
      return 'pushed';
    } catch (e) {
      if (i === (opts.retries ?? 5) - 1) throw e;
    }
  }
  return 'pushed';
}

export function cmdReviewStart(a: Args): number {
  const need = (k: string) =>
    str(a, k) ??
    (() => {
      throw new CliError(`--${k} required`, 2);
    })();
  const target = resolveReviewTarget(readFileSync(need('config'), 'utf8'));
  const repo = need('repo');
  if (!REPO.test(repo)) throw new CliError('--repo must be <owner>/<repo>', 2);
  const pr = Number(need('pr'));
  const headSha = need('head-sha');
  if (!Number.isInteger(pr) || !/^[0-9a-f]{7,64}$/.test(headSha))
    throw new CliError('bad --pr or --head-sha', 2);
  const remote = str(a, 'remote') ?? `https://github.com/${target.dataRepo}.git`;
  if (a.flags['dry-run']) {
    console.log(`would push review ${repo}#${pr} to ${target.dataRepo} ${target.branch}`);
    return 0;
  }
  console.log(startReview({ remote, target, repo, pr, headSha }));
  return 0;
}
