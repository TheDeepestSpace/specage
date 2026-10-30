import type { Spec, SpecNode } from './model.js';
import type { State } from './schemas.js';
export type NodeStatus = 'unknown' | 'planned' | 'in_progress' | 'implemented' | 'verified' | 'stale' | 'contradiction' | 'absent';
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
export declare function nodeStatus(n: SpecNode, state: State): NodeStatus;
/** Build the baked data.json consumed by the renderer and the editor. */
export declare function buildData(spec: Spec, state: State, opts?: {
    project: string;
    report?: string;
    editUrl?: string;
    repo?: string;
    specCommit?: string;
    now?: string;
}): SpecData;
