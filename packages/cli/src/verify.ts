// Callback verifier: specage never trusts what the-intern's callback says. It re-reads the PR from
// GitHub, checks the result against the dispatch context and decides what happens next.
import type { DispatchContext } from './dispatch.js';

export interface PrFacts {
  number: number;
  state: 'open' | 'closed';
  merged: boolean;
  body: string;
  /** full commit messages of the PR */
  commits: string[];
}

export interface CallbackPayload {
  status: 'success' | 'failure' | 'cancelled';
  run_url?: string;
  pr?: number;
  issue?: number;
  context: DispatchContext;
}

export type Decision =
  | { action: 'ok'; state: 'in_review' | 'merged' | 'closed' }
  | { action: 'redispatch'; attempt: number; problems: string[]; correction: string }
  | { action: 'mark'; state: 'failed' | 'needs_human'; problems: string[] };

const CLAIM = /^([a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)*)@([0-9a-f]{12})$/;
const trailer = (msg: string, key: string) =>
  msg
    .split('\n')
    .map((l) => new RegExp(`^${key}:\\s*(\\S+)\\s*$`).exec(l)?.[1])
    .filter((x): x is string => !!x);

/** Problems with an implement/amend PR; empty = fine. */
export function verifyPr(pr: PrFacts, ctx: DispatchContext, issue?: number): string[] {
  const problems: string[] = [];
  const want = new Map<string, string>();
  for (const c of ctx.spec_ids) {
    const m = CLAIM.exec(c);
    if (m) want.set(m[1], m[2]);
    else problems.push(`context claim "${c}" is not <id>@<12-hex hash>`);
  }
  const have = new Map<string, Set<string>>();
  for (const msg of pr.commits)
    for (const t of trailer(msg, 'Spec')) {
      const m = CLAIM.exec(t);
      if (!m) {
        problems.push(`malformed trailer "Spec: ${t}" (want Spec: <id>@<12-hex hash>)`);
        continue;
      }
      if (!want.has(m[1])) problems.push(`Spec: ${t} names a node this work does not claim`);
      else if (want.get(m[1]) !== m[2])
        problems.push(`Spec: ${t} has a stale hash; the claim is ${m[1]}@${want.get(m[1])}`);
      else (have.get(m[1]) ?? have.set(m[1], new Set()).get(m[1])!).add(m[2]);
    }
  const released = new Set(
    pr.body
      .split('\n')
      .map((l) => /^Spec-Release:\s*(\S+)/.exec(l)?.[1])
      .filter((x): x is string => !!x),
  );
  for (const r of released) if (!want.has(r)) problems.push(`Spec-Release: ${r} is not a claim`);
  for (const id of want.keys())
    if (!have.has(id) && !released.has(id))
      problems.push(`claim ${id}@${want.get(id)} has no "Spec: ${id}@${want.get(id)}" trailer`);
  if (issue && !new RegExp(`\\b(?:closes|fixes|resolves)\\s+#${issue}\\b`, 'i').test(pr.body))
    problems.push(`PR body must say "Closes #${issue}"`);
  return problems;
}

export function decide(p: CallbackPayload, pr: PrFacts | null, issue?: number): Decision {
  const ctx = p.context;
  if (p.status !== 'success')
    return { action: 'mark', state: 'failed', problems: [`the-intern run ${p.status}`] };
  if (ctx.kind === 'review') {
    // a review leaves no trailers to check; success of the run is all we can verify here
    return { action: 'ok', state: pr?.merged ? 'merged' : 'in_review' };
  }
  if (!pr) {
    return fix(ctx, ['no pull request was found for this work'], 'open a pull request');
  }
  if (pr.merged) return { action: 'ok', state: 'merged' };
  if (pr.state === 'closed')
    return { action: 'mark', state: 'needs_human', problems: [`PR #${pr.number} was closed`] };
  const problems = verifyPr(pr, ctx, issue);
  if (!problems.length) return { action: 'ok', state: 'in_review' };
  return fix(ctx, problems, 'fix the following on the PR');
}

function fix(ctx: DispatchContext, problems: string[], lead: string): Decision {
  if (ctx.attempt < ctx.max_attempts)
    return {
      action: 'redispatch',
      attempt: ctx.attempt + 1,
      problems,
      correction: `specage verification of attempt ${ctx.attempt}/${ctx.max_attempts} failed; ${lead}:\n${problems.map((x) => `- ${x}`).join('\n')}`,
    };
  return { action: 'mark', state: 'needs_human', problems };
}
