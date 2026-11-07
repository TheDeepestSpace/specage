import type { Spec } from './model.js';
import { indexById } from './parse.js';
import type { Question, QuestionMessage } from './schemas.js';

export const MAX_ANSWER_LEN = 4000;

export class QuestionError extends Error {}

/**
 * Where a question about a removed node attaches: the nearest ancestor (by the OLD tree) that
 * still exists in the new spec. A removed root, or one whose ancestors are all gone, is
 * top-level (`node: ''`).
 */
export function anchorQuestion(
  oldSpec: Spec,
  newSpec: Spec,
  removedId: string,
): { node: string; node_hash?: string } {
  const oldIdx = indexById(oldSpec);
  const newIdx = indexById(newSpec);
  let p = oldIdx.get(removedId)?.parent ?? null;
  while (p) {
    const alive = newIdx.get(p);
    if (alive) return { node: alive.id, node_hash: alive.hash };
    p = oldIdx.get(p)?.parent ?? null;
  }
  return { node: '' };
}

export const isTopLevel = (q: Question) => q.node === '';

/** Questions the human still has to settle (unresolved questions stay visible). */
export const openQuestions = (qs: Question[]) => qs.filter((q) => q.state === 'open');

/** True while any open question gates the given issue: its outbox entries must not fire. */
export const dispatchBlocked = (qs: Question[], issue: number) =>
  qs.some((q) => q.state === 'open' && q.issue === issue);

export interface AnswerOp {
  id: string;
  choice?: 'withdraw' | 'keep';
  body?: string;
}

/**
 * Append a human answer / follow-up to a question's thread (pure). The question stays `open`:
 * only the planner resolves it, once satisfied. `answer` records the latest human reply.
 */
export function answerQuestion(
  qs: Question[],
  op: AnswerOp,
  author: string,
  at: string,
): Question[] {
  const q = qs.find((x) => x.id === op.id);
  if (!q) throw new QuestionError(`unknown question ${op.id}`);
  if (q.state !== 'open') throw new QuestionError(`question ${op.id} is ${q.state}`);
  if (op.choice && op.choice !== 'withdraw' && op.choice !== 'keep')
    throw new QuestionError('choice must be withdraw or keep');
  const body = (op.body ?? '').trim();
  if (body.length > MAX_ANSWER_LEN)
    throw new QuestionError(`body must be ≤${MAX_ANSWER_LEN} characters`);
  if (!body && !op.choice) throw new QuestionError('an answer needs a choice or text');
  const msg: QuestionMessage = {
    author,
    at,
    body: body || (op.choice === 'withdraw' ? 'Withdraw the issue.' : 'Keep the issue.'),
    ...(op.choice ? { choice: op.choice } : {}),
  };
  return qs.map((x) =>
    x.id === op.id ? { ...x, thread: [...x.thread, msg], answer: msg.body } : x,
  );
}
