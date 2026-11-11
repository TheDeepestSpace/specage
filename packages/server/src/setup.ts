/** Auto-merge readiness of a project repo: `allow_auto_merge` on and `ci-gate` required on the default branch. */
export const GATE = 'ci-gate';

/** Raw facts from GitHub; `null` = could not be read (missing permission). */
export interface MergeFacts {
  allow_auto_merge: boolean | null;
  /** required status check contexts on the default branch (branch protection ∪ rulesets), null if unreadable */
  required_checks: string[] | null;
  /** true when `required_checks` is only partial (one of the two sources was unreadable) */
  partial?: boolean;
}

export type Check = 'ok' | 'missing' | 'unverified';
export interface MergeSetup {
  auto_merge: Check;
  gate: Check;
  /** what to change, empty when fully set up */
  fix: string[];
  /** true when both settings are verified */
  ready: boolean;
}

export function evaluateSetup(f: MergeFacts): MergeSetup {
  const auto_merge: Check =
    f.allow_auto_merge === null ? 'unverified' : f.allow_auto_merge ? 'ok' : 'missing';
  const gate: Check = f.required_checks?.includes(GATE)
    ? 'ok'
    : f.required_checks === null || f.partial
      ? 'unverified'
      : 'missing';
  const fix: string[] = [];
  if (auto_merge !== 'ok')
    fix.push('Settings → General → Pull Requests: enable "Allow auto-merge".');
  if (gate !== 'ok')
    fix.push(
      `Settings → Branches (or Rules): require the status check "${GATE}" on the default branch.`,
    );
  return { auto_merge, gate, fix, ready: auto_merge === 'ok' && gate === 'ok' };
}
