import type { Diagnostic, Spec } from './model.js';
import { PROOF_KINDS, flatten } from './parse.js';

export interface LintState {
  retiredIds?: string[];
  consumedLineage?: string[];
}

export function lint(spec: Spec, state?: LintState): Diagnostic[] {
  const out: Diagnostic[] = [...spec.diagnostics];
  const push = (
    code: string,
    level: 'error' | 'warn',
    message: string,
    n: { line: number; column: number; id: string },
  ) => out.push({ code, level, message, line: n.line, column: n.column, node: n.id || undefined });
  const nodes = flatten(spec);
  const seen = new Map<string, number>();
  const ids = new Set(nodes.filter((n) => !n.derived).map((n) => n.id));
  const retired = new Set(state?.retiredIds ?? []);
  const consumed = new Set(state?.consumedLineage ?? []);

  for (const n of nodes) {
    if (!n.derived) {
      if (seen.has(n.id))
        push('E003', 'error', `duplicate ID "${n.id}" (first on line ${seen.get(n.id)})`, n);
      else seen.set(n.id, n.line);
    }
    if (!n.derived && retired.has(n.id))
      push('E004', 'error', `ID "${n.id}" was retired and cannot be reused`, n);
    for (const r of n.refs) {
      if (!ids.has(r)) push('W107', 'warn', `unresolved reference "$${r}"`, n);
      else if (r === n.id) push('W108', 'warn', `statement references itself ("$${r}")`, n);
    }
    if (n.marker?.unknown) push('E005', 'error', `unknown marker "${n.marker.name}"`, n);
    for (const old of n.lineage) {
      if (ids.has(old)) push('E006', 'error', `"<- ${old}" names an ID that still exists`, n);
    }
    if (!n.derived && n.parent && !n.id.startsWith(n.parent + '.'))
      push('W101', 'warn', `ID "${n.id}" does not extend parent "${n.parent}"`, n);
    if (n.type === 'leaf') {
      if (n.text.length > 280)
        push('W102', 'warn', `leaf is ${n.text.length} characters (>280): spec or pseudocode?`, n);
      if (
        /https?:\/\/\S+/.test(n.text) ||
        /(^|\s)#\d+\b/.test(n.text) ||
        /(^|[\s(])(\.{0,2}\/)?[\w-]+(\/[\w.-]+)*\/[\w-]+\.[a-z]{1,5}\b/i.test(n.text)
      )
        push(
          'W103',
          'warn',
          'leaf contains a file path, issue reference or URL (belongs in the trace)',
          n,
        );
    } else if (n.marker && !n.marker.unknown) {
      push('W106', 'warn', 'marker on a block is ignored in v0', n);
    }
    if (n.marker?.name === 'proof' && !PROOF_KINDS.includes(n.marker.kind ?? ''))
      push('W104', 'warn', `unknown !proof kind "${n.marker.kind ?? ''}"`, n);
    if (!n.derived && n.lineage.length && consumed.has(n.id))
      push('W105', 'warn', `"<-" clause on "${n.id}" survived the dispatch that consumed it`, n);
  }
  return out.sort((a, b) => a.line - b.line || a.column - b.column);
}

export function hasErrors(d: Diagnostic[]): boolean {
  return d.some((x) => x.level === 'error');
}
