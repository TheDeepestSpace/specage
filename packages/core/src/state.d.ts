import { type State } from './schemas.js';
export interface StateIssue {
    file: string;
    message: string;
}
export declare function parseState(raw: {
    trace?: unknown;
    work?: unknown;
    questions?: unknown;
}): {
    state: State;
    issues: StateIssue[];
};
/** Load and validate a spec-state checkout directory. */
export declare function loadState(dir: string): {
    state: State;
    issues: StateIssue[];
};
