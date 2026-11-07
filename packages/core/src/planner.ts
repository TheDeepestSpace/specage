// Planner (discovery) dispatch for the-intern's generic `dispatch_agent`, fired by the specage server on spec save.
const REPO = /^[\w.-]+\/[\w.-]+$/;
const REF = /^[\w][\w./-]*$/;

export interface PlannerOpts {
  /** project code repo (owner/repo) */
  repo: string;
  data_repo: string;
  specage_repo: string;
  prompt_ref: string;
  project: string;
  /** pushed range: last dispatched commit (null on the first run) .. new spec head */
  before: string | null;
  after: string;
  backend?: string;
  model?: string;
  effort?: string;
}

const SHA = /^[0-9a-f]{40}$/;

/**
 * Build the `dispatch` input for a planner (discovery) session. It targets no issue or PR; the
 * pushed range and project travel in `context`. One attempt only: specage does not redispatch a planner.
 */
export function buildPlannerDispatch(o: PlannerOpts): Record<string, unknown> {
  for (const [k, v] of [
    ['repo', o.repo],
    ['data_repo', o.data_repo],
    ['specage_repo', o.specage_repo],
  ] as const)
    if (!REPO.test(v)) throw new Error(`${k} must be owner/repo, got "${v}"`);
  if (!REF.test(o.prompt_ref) || o.prompt_ref.includes('..'))
    throw new Error(`bad prompt ref "${o.prompt_ref}"`);
  if (!SHA.test(o.after) || (o.before !== null && !SHA.test(o.before)))
    throw new Error('before/after must be 40-hex commit shas');
  const d: Record<string, unknown> = {
    prompt: `${o.specage_repo}:prompts/discovery.md@${o.prompt_ref}`,
    repo: o.repo,
    access: [{ repo: o.data_repo, scope: 'read/write' }],
    callback: { repo: o.specage_repo, workflow: 'callback.yml' },
    context: {
      project: o.project,
      repo: o.repo,
      kind: 'planner',
      spec_ids: [],
      before: o.before,
      after: o.after,
      attempt: 1,
      max_attempts: 1,
    },
    attempt: 1,
    max_attempts: 1,
  };
  if (o.backend) d.backend = o.backend;
  if (o.model) d.model = o.model;
  if (o.effort) d.effort = o.effort;
  return d;
}
