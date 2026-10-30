import type { Diagnostic, Spec } from './model.js';
export interface LintState {
    retiredIds?: string[];
    consumedLineage?: string[];
}
export declare function lint(spec: Spec, state?: LintState): Diagnostic[];
export declare function hasErrors(d: Diagnostic[]): boolean;
