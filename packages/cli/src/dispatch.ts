// specage side of the-intern's generic `dispatch_agent` (see the-intern README, "dispatch_agent").
// The caller (specage-app[bot], the workflow actor) fires dispatcher.yml with one JSON input.
export type DispatchKind = 'implement' | 'amend' | 'review';

export interface DispatchContext {
  project: string;
  /** project code repo (owner/repo) */
  repo: string;
  issue?: number;
  /** `id@hash` claims the run must satisfy */
  spec_ids: string[];
  kind: DispatchKind;
  attempt: number;
  max_attempts: number;
}

export interface DispatchOpts {
  kind: DispatchKind;
  /** project code repo (owner/repo) */
  repo: string;
  data_repo: string;
  /** specage repo hosting prompts and the callback workflow */
  specage_repo: string;
  /** ref of the prompts: a branch or tag the-intern allowlists (main, v*) */
  prompt_ref: string;
  project: string;
  spec_ids: string[];
  issue?: number;
  pr?: number;
  backend?: string;
  model?: string;
  effort?: string;
  attempt?: number;
  max_attempts?: number;
  /** corrective text appended to the prompt context on a redispatch */
  correction?: string;
}

export const DEFAULT_MAX_ATTEMPTS = 3;
const REPO = /^[\w.-]+\/[\w.-]+$/;
const REF = /^[\w][\w./-]*$/;

/** Build the `dispatch` input. Throws on anything the-intern would refuse anyway. */
export function buildDispatch(o: DispatchOpts): Record<string, unknown> {
  for (const [k, v] of [
    ['repo', o.repo],
    ['data_repo', o.data_repo],
    ['specage_repo', o.specage_repo],
  ] as const)
    if (!REPO.test(v)) throw new Error(`${k} must be owner/repo, got "${v}"`);
  if (!REF.test(o.prompt_ref) || o.prompt_ref.includes('..'))
    throw new Error(`bad prompt ref "${o.prompt_ref}"`);
  const attempt = o.attempt ?? 1;
  const max = o.max_attempts ?? DEFAULT_MAX_ATTEMPTS;
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error('attempt must be >= 1');
  if (!Number.isInteger(max) || max < 1) throw new Error('max_attempts must be >= 1');
  if (attempt > max) throw new Error(`attempt ${attempt} exceeds max_attempts ${max}`);
  if (o.kind === 'implement' ? !o.issue : !o.pr)
    throw new Error(o.kind === 'implement' ? 'implement needs an issue' : `${o.kind} needs a pr`);
  const context: DispatchContext = {
    project: o.project,
    repo: o.repo,
    ...(o.issue ? { issue: o.issue } : {}),
    spec_ids: o.spec_ids,
    kind: o.kind,
    attempt,
    max_attempts: max,
  };
  const d: Record<string, unknown> = {
    prompt: `${o.specage_repo}:prompts/${o.kind}.md@${o.prompt_ref}`,
    repo: o.repo,
    // an implement retry fixes the existing PR instead of opening another one
    ...(o.pr ? { pr: o.pr } : {}),
    ...(o.issue && !o.pr ? { issue: o.issue } : {}),
    access: [{ repo: o.data_repo, scope: 'read' }],
    callback: { repo: o.specage_repo, workflow: 'callback.yml' },
    context: o.correction ? { ...context, correction: o.correction } : context,
    attempt,
    max_attempts: max,
  };
  if (o.backend) d.backend = o.backend;
  if (o.model) d.model = o.model;
  if (o.effort) d.effort = o.effort;
  return d;
}

/** `gh` arguments firing the-intern's dispatcher with a dispatch JSON. */
export function dispatchCommand(
  internRepo: string,
  workflow: string,
  dispatch: Record<string, unknown>,
): string[] {
  return [
    'workflow',
    'run',
    workflow,
    '-R',
    internRepo,
    '-f',
    `dispatch=${JSON.stringify(dispatch)}`,
  ];
}
