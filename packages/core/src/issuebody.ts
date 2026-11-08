// Enriched issue body for planner-filed issues: verbatim spec quote plus repo context and acceptance criteria.
export interface IssueClaim {
  id: string;
  hash: string;
  /** current leaf text, quoted verbatim */
  text: string;
}

export interface IssueContextNode {
  id: string;
  /** e.g. constraint | impl | invariant */
  kind: string;
  text: string;
}

export interface IssueEnrichment {
  /** relevant files/areas found by read-only exploration */
  files?: string[];
  /** existing patterns / related code to follow */
  patterns?: string[];
  criteria?: string[];
  edge_cases?: string[];
  tests?: string[];
  /** true adds a screenshot requirement */
  ui?: boolean;
}

export interface IssueBodyInput {
  summary: string;
  spec_commit: string;
  claims: IssueClaim[];
  binding?: IssueContextNode[];
  evidence?: string[];
  enrichment?: IssueEnrichment;
}

/** Max bullets per section and max chars per bullet; keeps bodies short. */
export const ISSUE_BODY_LIMITS = { bullets: 8, chars: 240 } as const;

const clip = (s: string): string => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > ISSUE_BODY_LIMITS.chars ? t.slice(0, ISSUE_BODY_LIMITS.chars - 1) + '…' : t;
};

function bullets(title: string, items: string[] | undefined, out: string[]): void {
  const xs = (items ?? []).map(clip).filter(Boolean).slice(0, ISSUE_BODY_LIMITS.bullets);
  if (xs.length) out.push(`## ${title}`, ...xs.map((x) => `- ${x}`), '');
}

/**
 * Build the issue body. The Spec section quotes claimed leaves verbatim (never clipped or reworded);
 * enrichment sections are bounded. Always ends with the `Spec:` trailer instructions.
 */
export function buildIssueBody(i: IssueBodyInput): string {
  if (!i.claims.length) throw new Error('issue needs at least one claimed leaf');
  const e = i.enrichment ?? {};
  const out: string[] = [clip(i.summary), ''];
  out.push('## Spec', `Spec commit: \`${i.spec_commit}\``);
  for (const c of i.claims)
    out.push(`- \`${c.id}@${c.hash}\``, ...c.text.split('\n').map((l) => `  > ${l}`));
  out.push('');
  if (i.binding?.length)
    bullets(
      'Binding context',
      i.binding.map((n) => `\`${n.id}\` (${n.kind}): ${n.text}`),
      out,
    );
  bullets('Existing evidence', i.evidence, out);
  bullets('Relevant code', e.files, out);
  bullets('Patterns to follow', e.patterns, out);
  bullets('Acceptance criteria', e.criteria, out);
  bullets('Edge cases', e.edge_cases, out);
  const tests = [...(e.tests ?? [])];
  if (e.ui) tests.push('Include screenshots of the UI change in the PR');
  if (!tests.length) tests.push('Add tests covering the new behaviour');
  bullets('Tests required', tests, out);
  out.push(
    '## Trailers',
    ...i.claims.map((c) => `- Add \`Spec: ${c.id}@${c.hash}\` to the final commit.`),
    '- For a claim left unfinished, put `Spec-Release: <id>` in the PR body.',
    '- Open the PR with `Closes #N`.',
  );
  return out.join('\n') + '\n';
}
