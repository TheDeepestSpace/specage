import type { Spec } from './model.js';
export interface Side {
    id: string;
    hash: string;
    text: string;
    parent: string | null;
    line: number;
}
export type DiffEntry = {
    kind: 'added';
    id: string;
    new: Side;
} | {
    kind: 'removed';
    id: string;
    old: Side;
} | {
    kind: 'changed';
    id: string;
    old: Side;
    new: Side;
} | {
    kind: 'moved';
    id: string;
    old: Side;
    new: Side;
} | {
    kind: 'renamed';
    from: string;
    id: string;
    old: Side;
    new: Side;
    text_changed: boolean;
} | {
    kind: 'split';
    from: string;
    ids: string[];
    old: Side;
    new: Side[];
} | {
    kind: 'merged';
    from: string[];
    id: string;
    old: Side[];
    new: Side;
} | {
    kind: 'suspected_rename';
    from: string;
    id: string;
    similarity: number;
    old: Side;
    new: Side;
};
export interface SpecDiff {
    entries: DiffEntry[];
    subtree_changed: string[];
}
export declare function similarity(a: string, b: string): number;
export declare function diff(oldSpec: Spec, newSpec: Spec): SpecDiff;
export declare function summarize(d: SpecDiff): string;
