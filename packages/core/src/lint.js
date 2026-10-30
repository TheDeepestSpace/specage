import { PROOF_KINDS, flatten } from './parse.js';
export function lint(spec, state) {
    const out = [...spec.diagnostics];
    const push = (code, level, message, n) => out.push({ code, level, message, line: n.line, column: n.column, node: n.id || undefined });
    const nodes = flatten(spec);
    const seen = new Map();
    const ids = new Set(nodes.map((n) => n.id));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const retired = new Set(state?.retiredIds ?? []);
    const consumed = new Set(state?.consumedLineage ?? []);
    for (const n of nodes) {
        if (!n.id)
            continue; // E002 already reported by the parser
        if (seen.has(n.id))
            push('E003', 'error', `duplicate ID "${n.id}" (first on line ${seen.get(n.id)})`, n);
        else
            seen.set(n.id, n.line);
        if (retired.has(n.id))
            push('E004', 'error', `ID "${n.id}" was retired and cannot be reused`, n);
        if (n.marker?.unknown)
            push('E005', 'error', `unknown marker "${n.marker.name}"`, n);
        for (const old of n.lineage) {
            if (ids.has(old))
                push('E006', 'error', `"<- ${old}" names an ID that still exists`, n);
        }
        if (n.parent && !n.id.startsWith(n.parent + '.'))
            push('W101', 'warn', `ID "${n.id}" does not extend parent "${n.parent}"`, n);
        if (n.type === 'leaf') {
            if (n.text.length > 280)
                push('W102', 'warn', `leaf is ${n.text.length} characters (>280): spec or pseudocode?`, n);
            if (/https?:\/\/\S+/.test(n.text) ||
                /(^|\s)#\d+\b/.test(n.text) ||
                /(^|[\s(])(\.{0,2}\/)?[\w-]+(\/[\w.-]+)*\/[\w-]+\.[a-z]{1,5}\b/i.test(n.text))
                push('W103', 'warn', 'leaf contains a file path, issue reference or URL (belongs in the trace)', n);
        }
        else if (n.marker && !n.marker.unknown) {
            push('W106', 'warn', 'marker on a block is ignored in v0', n);
        }
        if (n.marker?.name === 'proof' && !PROOF_KINDS.includes(n.marker.kind ?? ''))
            push('W104', 'warn', `unknown !proof kind "${n.marker.kind ?? ''}"`, n);
        if (n.lineage.length && consumed.has(n.id))
            push('W105', 'warn', `"<-" clause on "${n.id}" survived the dispatch that consumed it`, n);
    }
    void byId;
    return out.sort((a, b) => a.line - b.line || a.column - b.column);
}
export function hasErrors(d) {
    return d.some((x) => x.level === 'error');
}
