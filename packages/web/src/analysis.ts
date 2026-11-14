import {
  flatten,
  lint,
  nodeStatus,
  parse,
  type Diagnostic,
  type Spec,
  type SpecNode,
  type State,
} from '@specage/core/browser';

export interface BlockRange {
  open: number;
  close: number; // doc.length when unclosed
}

/** `{ ... }` ranges in document order, honouring escapes and comments (same lexical rules as the parser). */
export function blockRanges(text: string): BlockRange[] {
  const out: BlockRange[] = [];
  const stack: number[] = [];
  let prevSpace = true;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') {
      i++;
      prevSpace = false;
      continue;
    }
    if (c === '#' && prevSpace) {
      while (i < text.length && text[i] !== '\n') i++;
      prevSpace = true;
      continue;
    }
    if (c === '{') {
      out.push({ open: i, close: text.length });
      stack.push(out.length - 1);
    } else if (c === '}') {
      const k = stack.pop();
      if (k !== undefined) out[k].close = i;
    }
    prevSpace = /\s/.test(c);
  }
  return out;
}

export interface Analysis {
  text: string;
  spec: Spec;
  nodes: SpecNode[];
  blocks: BlockRange[];
  /** block node for blocks[i], present only if the counts agree */
  blockNodes: SpecNode[] | null;
  byLine: Map<number, SpecNode>;
  byId: Map<string, SpecNode>;
}

export function analyse(text: string): Analysis {
  const spec = parse(text);
  const nodes = flatten(spec);
  const blocks = blockRanges(text);
  const bn = nodes.filter((n) => n.type === 'block');
  const byLine = new Map<number, SpecNode>();
  for (const n of nodes) if (!byLine.has(n.line)) byLine.set(n.line, n);
  return {
    text,
    spec,
    nodes,
    blocks,
    blockNodes: bn.length === blocks.length ? bn : null,
    byLine,
    byId: new Map(nodes.map((n) => [n.id, n])),
  };
}

const SEVERITY = [
  'contradiction',
  'stale',
  'absent',
  'in_progress',
  'planned',
  'unknown',
  'implemented',
  'verified',
];

export function leafStatuses(n: SpecNode, st: State, acc: string[] = []): string[] {
  if (n.type === 'leaf') acc.push(nodeStatus(n, st));
  else n.children.forEach((c) => leafStatuses(c, st, acc));
  return acc;
}

/** Status for the gutter dot: leaf status, or the worst status under a block. */
export function dotStatus(n: SpecNode, st: State): string {
  if (n.type === 'leaf') return nodeStatus(n, st);
  const all = leafStatuses(n, st);
  for (const s of SEVERITY) if (all.includes(s)) return s;
  return 'unknown';
}

/** Innermost node containing a 1-based line. */
export function nodeAtLine(a: Analysis, line: number): SpecNode | null {
  let best: SpecNode | null = null;
  const visit = (n: SpecNode) => {
    if (n.line <= line && line <= n.endLine) {
      best = n;
      n.children.forEach(visit);
    }
  };
  a.spec.roots.forEach(visit);
  return best;
}

export function ancestors(a: Analysis, n: SpecNode): SpecNode[] {
  const out: SpecNode[] = [];
  let p = n.parent ? a.byId.get(n.parent) : undefined;
  while (p) {
    out.unshift(p);
    p = p.parent ? a.byId.get(p.parent) : undefined;
  }
  return out;
}

export function slug(text: string): string {
  const words = text
    .toLowerCase()
    .replace(/^(!\w+(\s+\w+)?:|\?|>later:)\s*/, '')
    .match(/[a-z0-9]+/g) ?? ['node'];
  const s = words.slice(0, 3).join('-');
  return /^[a-z]/.test(s) ? s : `n-${s}`;
}

export function toCmDiagnostics(diags: Diagnostic[]) {
  return diags;
}
export { lint };

/** True when the gutter dot is orange and any in_progress leaf under it has an active agent. */
export function dotPulse(n: SpecNode, st: State, active: ReadonlySet<string>): boolean {
  if (dotStatus(n, st) !== 'in_progress') return false;
  const live = (x: SpecNode): boolean =>
    x.type === 'leaf'
      ? nodeStatus(x, st) === 'in_progress' && active.has(x.id)
      : x.children.some(live);
  return live(n);
}

export const dotClass = (status: string, pulse: boolean): string =>
  `dot st-${status}${pulse && status === 'in_progress' ? ' pulse' : ''}`;

/** Map a diagnostic's code-point line/column range to document offsets (UTF-16). Falls back to a 60-char span without an end. */
export function diagRange(text: string, d: Diagnostic): { from: number; to: number } {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  const lineEnd = (k: number) => (k + 1 < starts.length ? starts[k + 1] - 1 : text.length);
  const pos = (ln: number, col: number) => {
    const k = Math.min(Math.max(ln, 1), starts.length) - 1;
    const line = text.slice(starts[k], lineEnd(k));
    return Math.min(
      starts[k] + [...line].slice(0, Math.max(col - 1, 0)).join('').length,
      lineEnd(k),
    );
  };
  const from = pos(d.line, d.column);
  const hasEnd = d.endLine !== undefined && d.endColumn !== undefined;
  const k = Math.min(Math.max(d.line, 1), starts.length) - 1;
  const end = hasEnd ? pos(d.endLine!, d.endColumn!) : Math.min(lineEnd(k), from + 60);
  return { from, to: Math.max(end, Math.min(from + 1, text.length)) };
}
