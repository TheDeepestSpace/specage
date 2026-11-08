import type { Thread, ThreadEvent } from './schemas.js';

export const MAX_COMMENT_LEN = 4000;

export type CommentOp =
  | { op: 'create'; node: string; node_hash: string; body: string }
  | { op: 'reply'; thread: string; body: string }
  | { op: 'resolve'; thread: string }
  | { op: 'reopen'; thread: string };

export class CommentError extends Error {}

const nextId = (prefix: string, used: string[]) => {
  let n = used.length + 1;
  while (used.includes(`${prefix}${String(n).padStart(4, '0')}`)) n++;
  return `${prefix}${String(n).padStart(4, '0')}`;
};

/** Apply one human operation to the thread list (pure). `nodeHashes` validates the anchor. */
export function applyOp(
  threads: Thread[],
  op: CommentOp,
  author: string,
  at: string,
  nodeHashes: Record<string, string>,
): Thread[] {
  const body = 'body' in op ? op.body.trim() : '';
  if ('body' in op && (!body || body.length > MAX_COMMENT_LEN))
    throw new CommentError(`body must be 1-${MAX_COMMENT_LEN} characters`);
  const out = threads.map((t) => ({ ...t, comments: [...t.comments] }));
  if (op.op === 'create') {
    if (!(op.node in nodeHashes)) throw new CommentError(`unknown node ${op.node}`);
    const id = nextId(
      't-',
      out.map((t) => t.id),
    );
    out.push({
      id,
      node: op.node,
      node_hash: nodeHashes[op.node],
      state: 'open',
      comments: [{ id: `${id}.1`, author, at, body }],
    });
    return out;
  }
  const t = out.find((x) => x.id === op.thread);
  if (!t) throw new CommentError(`unknown thread ${op.thread}`);
  if (op.op === 'reply') {
    t.comments.push({ id: `${t.id}.${t.comments.length + 1}`, author, at, body });
  } else if (op.op === 'resolve') {
    t.state = 'resolved';
    t.resolved_by = author;
    t.resolved_at = at;
  } else {
    t.state = 'open';
    delete t.resolved_by;
    delete t.resolved_at;
  }
  return out;
}

/** Fold agent events (trail branch) into the human threads, in time order. Unknown threads are ignored. */
export function mergeThreads(threads: Thread[], events: ThreadEvent[] = []): Thread[] {
  const out = threads.map((t) => ({ ...t, comments: [...t.comments] }));
  const sorted = [...events].sort((a, b) => a.at.localeCompare(b.at));
  for (const e of sorted) {
    const t = out.find((x) => x.id === e.thread);
    if (!t) continue;
    if (e.kind === 'reply' && e.body)
      t.comments.push({
        id: `${t.id}.${t.comments.length + 1}`,
        author: e.author,
        at: e.at,
        body: e.body,
      });
    else if (e.kind === 'resolve') {
      t.state = 'resolved';
      t.resolved_by = e.author;
      t.resolved_at = e.at;
    } else if (e.kind === 'reopen') {
      t.state = 'open';
      delete t.resolved_by;
      delete t.resolved_at;
    }
  }
  return out;
}

export const AGENT_AUTHOR = 'the-intern';

/**
 * Open threads that still need an agent reply: after folding in agent events, the last comment is not
 * from the agent. Answered threads drop out, so re-running a dispatch never re-answers (idempotent).
 */
export function pendingThreads(
  threads: Thread[],
  events: ThreadEvent[] = [],
  agent = AGENT_AUTHOR,
): Thread[] {
  return mergeThreads(threads, events).filter((t) => {
    const last = t.comments[t.comments.length - 1];
    return t.state === 'open' && !!last && last.author !== agent;
  });
}
