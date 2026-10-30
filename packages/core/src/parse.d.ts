import type { Marker, Spec, SpecNode } from './model.js';
export declare const MARKERS: readonly ["constraint", "impl", "invariant", "proof"];
export declare const PROOF_KINDS: string[];
/** Detect the marker at the start of normalized text. */
export declare function detectMarker(text: string): Marker | null;
export declare function computeSubtreeHashes(n: SpecNode): void;
export declare function parse(src: string): Spec;
export declare function walk(roots: SpecNode[], fn: (n: SpecNode) => void): void;
export declare function flatten(spec: Spec): SpecNode[];
export declare function indexById(spec: Spec): Map<string, SpecNode>;
