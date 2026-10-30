import { flatten, indexById } from './parse.js';
const side = (n) => ({ id: n.id, hash: n.hash, text: n.text, parent: n.parent, line: n.line });
export function similarity(a, b) {
    if (a === b)
        return 1;
    const m = a.length;
    const n = b.length;
    if (!m || !n)
        return 0;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
        const cur = [i];
        for (let j = 1; j <= n; j++)
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = cur;
    }
    return 1 - prev[n] / Math.max(m, n);
}
export function diff(oldSpec, newSpec) {
    const oldIdx = indexById(oldSpec);
    const newIdx = indexById(newSpec);
    const entries = [];
    const consumedOld = new Set();
    const consumedNew = new Set();
    // lineage: group new nodes by the old ids they reference (only retired old ids)
    const bySource = new Map();
    const lineageNodes = flatten(newSpec).filter((n) => n.lineage.some((o) => oldIdx.has(o) && !newIdx.has(o)));
    for (const n of lineageNodes)
        for (const o of n.lineage)
            if (oldIdx.has(o) && !newIdx.has(o))
                bySource.set(o, [...(bySource.get(o) ?? []), n]);
    const done = new Set();
    for (const n of lineageNodes) {
        if (done.has(n))
            continue;
        const olds = n.lineage.filter((o) => oldIdx.has(o) && !newIdx.has(o));
        if (olds.length > 1) {
            entries.push({ kind: 'merged', from: olds, id: n.id, old: olds.map((o) => side(oldIdx.get(o))), new: side(n) });
            olds.forEach((o) => consumedOld.add(o));
            done.add(n);
        }
        else {
            const o = olds[0];
            const targets = bySource.get(o).filter((t) => t.lineage.filter((x) => oldIdx.has(x) && !newIdx.has(x)).length === 1);
            if (targets.length > 1) {
                entries.push({ kind: 'split', from: o, ids: targets.map((t) => t.id), old: side(oldIdx.get(o)), new: targets.map(side) });
                targets.forEach((t) => done.add(t));
            }
            else {
                const on = oldIdx.get(o);
                entries.push({ kind: 'renamed', from: o, id: n.id, old: side(on), new: side(n), text_changed: on.hash !== n.hash });
                done.add(n);
            }
            consumedOld.add(o);
        }
        consumedNew.add(n.id);
    }
    for (const n of done)
        consumedNew.add(n.id);
    const removed = [];
    const added = [];
    for (const [id, n] of newIdx) {
        if (consumedNew.has(id))
            continue;
        const o = oldIdx.get(id);
        if (!o)
            added.push(n);
        else if (o.hash !== n.hash)
            entries.push({ kind: 'changed', id, old: side(o), new: side(n) });
        else if (o.parent !== n.parent)
            entries.push({ kind: 'moved', id, old: side(o), new: side(n) });
    }
    for (const [id, o] of oldIdx)
        if (!consumedOld.has(id) && !newIdx.has(id))
            removed.push(o);
    for (const o of removed)
        entries.push({ kind: 'removed', id: o.id, old: side(o) });
    for (const n of added)
        entries.push({ kind: 'added', id: n.id, new: side(n) });
    // suspected renames: greedy best-first over removed x added
    const pairs = [];
    for (const o of removed)
        for (const n of added) {
            const s = similarity(o.text, n.text);
            if (s >= 0.8)
                pairs.push({ o, n, s });
        }
    pairs.sort((a, b) => b.s - a.s);
    const usedO = new Set();
    const usedN = new Set();
    for (const p of pairs) {
        if (usedO.has(p.o.id) || usedN.has(p.n.id))
            continue;
        usedO.add(p.o.id);
        usedN.add(p.n.id);
        entries.push({ kind: 'suspected_rename', from: p.o.id, id: p.n.id, similarity: Math.round(p.s * 100) / 100, old: side(p.o), new: side(p.n) });
    }
    // blocks whose subtree hash changed (by ID, following lineage)
    const lineageSrc = new Map();
    for (const n of flatten(newSpec))
        if (n.lineage.length)
            lineageSrc.set(n.id, n.lineage);
    const subtree = [];
    for (const n of flatten(newSpec)) {
        if (n.type !== 'block')
            continue;
        const o = oldIdx.get(n.id) ?? (lineageSrc.get(n.id)?.length === 1 ? oldIdx.get(lineageSrc.get(n.id)[0]) : undefined);
        if (!o || o.subtreeHash !== n.subtreeHash)
            subtree.push(n.id);
    }
    return { entries, subtree_changed: subtree };
}
export function summarize(d) {
    if (!d.entries.length)
        return 'no changes';
    const lines = d.entries.map((e) => {
        switch (e.kind) {
            case 'split': return `split      ${e.from} -> ${e.ids.join(', ')}`;
            case 'merged': return `merged     ${e.from.join(', ')} -> ${e.id}`;
            case 'renamed': return `renamed    ${e.from} -> ${e.id}${e.text_changed ? ' (text changed)' : ''}`;
            case 'suspected_rename': return `suspected  ${e.from} -> ${e.id} (${e.similarity})`;
            default: return `${e.kind.padEnd(10)} ${e.id}`;
        }
    });
    return lines.join('\n');
}
