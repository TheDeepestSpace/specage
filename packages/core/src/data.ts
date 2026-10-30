import type { Spec, SpecNode } from './model.js';
import type { State } from './schemas.js';
import { flatten } from './parse.js';

export type NodeStatus =
  | 'unknown'
  | 'planned'
  | 'in_progress'
  | 'implemented'
  | 'verified'
  | 'stale'
  | 'contradiction'
  | 'absent';

export interface NodeView {
  id: string;
  type: 'leaf' | 'block';
  marker: SpecNode['marker'];
  text: string;
  hash: string;
  subtreeHash: string;
  parent: string | null;
  children: string[];
  line: number;
  status: NodeStatus;
}

export interface SpecData {
  generated: string;
  project: string;
  edit_url?: string;
  repo?: string;
  spec_commit?: string;
  roots: string[];
  nodes: Record<string, NodeView>;
  trace: State['trace']['nodes'];
  work: State['work']['items'];
  questions: State['questions'];
  report?: string;
  aggregate: Record<string, Record<string, number>>;
}

export function nodeStatus(n: SpecNode, state: State): NodeStatus {
  const t = state.trace.nodes[n.id];
  if (!t) return 'unknown';
  if (t.spec_hash !== n.hash) return 'stale';
  if (t.verified && t.verified.hash === n.hash) return 'verified';
  return t.status;
}

/** Build the baked data.json consumed by the renderer and the editor. */
export function buildData(
  spec: Spec,
  state: State,
  opts: { project: string; report?: string; editUrl?: string; repo?: string; specCommit?: string; now?: string } = { project: '' },
): SpecData {
  const nodes: Record<string, NodeView> = {};
  for (const n of flatten(spec)) {
    if (!n.id) continue;
    nodes[n.id] = {
      id: n.id, type: n.type, marker: n.marker, text: n.text, hash: n.hash, subtreeHash: n.subtreeHash,
      parent: n.parent, children: n.children.map((c) => c.id), line: n.line, status: nodeStatus(n, state),
    };
  }
  const aggregate: Record<string, Record<string, number>> = {};
  const collect = (id: string, acc: Record<string, number>) => {
    const nv = nodes[id];
    if (nv.type === 'leaf') acc[nv.status] = (acc[nv.status] ?? 0) + 1;
    else nv.children.forEach((c) => collect(c, acc));
  };
  for (const id of Object.keys(nodes)) if (nodes[id].type === 'block') collect(id, (aggregate[id] = {}));
  return {
    generated: opts.now ?? new Date().toISOString(),
    project: opts.project,
    edit_url: opts.editUrl,
    repo: opts.repo,
    spec_commit: opts.specCommit,
    roots: spec.roots.map((r) => r.id),
    nodes,
    trace: state.trace.nodes,
    work: state.work.items,
    questions: state.questions,
    report: opts.report,
    aggregate,
  };
}
