import { flatten } from './parse.js';
export function nodeStatus(n, state) {
    const t = state.trace.nodes[n.id];
    if (!t)
        return 'unknown';
    if (t.spec_hash !== n.hash)
        return 'stale';
    if (t.verified && t.verified.hash === n.hash)
        return 'verified';
    return t.status;
}
/** Build the baked data.json consumed by the renderer and the editor. */
export function buildData(spec, state, opts = { project: '' }) {
    const nodes = {};
    for (const n of flatten(spec)) {
        if (!n.id)
            continue;
        nodes[n.id] = {
            id: n.id, type: n.type, marker: n.marker, text: n.text, hash: n.hash, subtreeHash: n.subtreeHash,
            parent: n.parent, children: n.children.map((c) => c.id), line: n.line, status: nodeStatus(n, state),
        };
    }
    const aggregate = {};
    const collect = (id, acc) => {
        const nv = nodes[id];
        if (nv.type === 'leaf')
            acc[nv.status] = (acc[nv.status] ?? 0) + 1;
        else
            nv.children.forEach((c) => collect(c, acc));
    };
    for (const id of Object.keys(nodes))
        if (nodes[id].type === 'block')
            collect(id, (aggregate[id] = {}));
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
