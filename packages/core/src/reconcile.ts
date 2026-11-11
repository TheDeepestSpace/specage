import type { Spec } from './model.js';
import { indexById } from './parse.js';
import { anchorQuestion } from './questions.js';
import type { OutboxEntry, Question, Work } from './schemas.js';

/** Open or not, a question whose anchor node is gone from the spec cannot be shown by the UI. */
export const orphanedQuestions = (qs: Question[], spec: Spec): Question[] => {
  const idx = indexById(spec);
  return qs.filter((q) => q.node !== '' && !idx.has(q.node));
};

/**
 * Re-tie orphaned questions (pure, idempotent). With the old spec the anchor is the nearest
 * surviving ancestor by the old tree (as `anchorQuestion`); without it, by dotted-ID prefix
 * (`a.b.c` -> `a.b` -> `a`). No surviving ancestor -> top-level (`node: ''`, no `node_hash`).
 */
export function reanchorQuestions(
  qs: Question[],
  newSpec: Spec,
  oldSpec?: Spec,
): { questions: Question[]; changed: { id: string; from: string; to: string }[] } {
  const idx = indexById(newSpec);
  const changed: { id: string; from: string; to: string }[] = [];
  const questions = qs.map((q) => {
    if (q.node === '' || idx.has(q.node)) return q;
    let anchor: { node: string; node_hash?: string } = { node: '' };
    if (oldSpec) anchor = anchorQuestion(oldSpec, newSpec, q.node);
    if (!anchor.node) {
      for (let p = q.node; p.includes('.');) {
        p = p.slice(0, p.lastIndexOf('.'));
        const alive = idx.get(p);
        if (alive) {
          anchor = { node: alive.id, node_hash: alive.hash };
          break;
        }
      }
    }
    changed.push({ id: q.id, from: q.node, to: anchor.node });
    const rest: Question = { ...q };
    delete rest.node_hash;
    return {
      ...rest,
      node: anchor.node,
      ...(anchor.node_hash ? { node_hash: anchor.node_hash } : {}),
    };
  });
  return { questions, changed };
}

export interface UndispatchedItem {
  issue: number;
  work_id: string;
  spec_ids: string[];
}

/**
 * Work items that are filed but were never queued for dispatch: state `filed`, an issue and no PR,
 * no outbox entry for the issue at all (fired or not, so in-flight and finished ones are never
 * re-enqueued), no open question gating it, and every claim still names a node that exists in the
 * spec at the claimed hash (otherwise the planner's reconcile pass must refresh or withdraw it first).
 */
export function undispatchedItems(
  work: Work,
  outbox: Pick<OutboxEntry, 'target'>[],
  questions: Question[],
  spec: Spec,
): UndispatchedItem[] {
  const idx = indexById(spec);
  const queued = new Set(outbox.map((e) => e.target));
  const gated = new Set(questions.filter((q) => q.state === 'open' && q.issue).map((q) => q.issue));
  const out: UndispatchedItem[] = [];
  for (const w of work.items) {
    if (w.state !== 'filed' || !w.issue || w.pr) continue;
    if (queued.has(w.issue) || gated.has(w.issue)) continue;
    const claims = Object.entries(w.claims).filter(([, c]) => c.status === 'pending');
    if (!claims.length) continue;
    if (!claims.every(([id, c]) => idx.get(id)?.hash === c.hash)) continue;
    out.push({
      issue: w.issue,
      work_id: w.id,
      spec_ids: claims.map(([id, c]) => `${id}@${c.hash}`),
    });
  }
  return out;
}

/** Outbox entry (kind `implement`) for an undispatched item. */
export const implementEntry = (u: UndispatchedItem, created: string): OutboxEntry => ({
  id: `ob-implement-${u.issue}`,
  kind: 'implement',
  target: u.issue,
  body: '',
  spec_ids: u.spec_ids,
  created,
});
