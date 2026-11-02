import { MAX_COMMENT_LEN, type Thread } from '@specage/core/browser';
import { api, ApiError } from './api.js';
import { h } from './dom.js';

export type ThreadFilter = 'open' | 'resolved' | 'all';

export const openCount = (threads: Thread[], node: string) =>
  threads.filter((t) => t.node === node && t.state === 'open').length;

export const byFilter = (threads: Thread[], f: ThreadFilter) =>
  threads.filter((t) => f === 'all' || t.state === f);

const when = (at: string) => at.slice(0, 16).replace('T', ' ');

/** Read-only thread (static viewer). Text only; never innerHTML. */
export function threadView(t: Thread, actions?: HTMLElement | null): HTMLElement {
  return h(
    'div',
    { class: `thread th-${t.state}`, 'data-thread': t.id },
    h('div', { class: 'thread-head' }, h('span', { class: 'th-state' }, t.state), ` ${t.id}`),
    ...t.comments.map((c) =>
      h(
        'div',
        { class: 'comment' },
        h('div', { class: 'cmeta' }, h('strong', {}, c.author), ` · ${when(c.at)}`),
        h('div', { class: 'cbody' }, c.body),
      ),
    ),
    t.state === 'resolved' && t.resolved_by
      ? h('div', { class: 'cmeta' }, `resolved by ${t.resolved_by}`)
      : null,
    actions,
  );
}

export interface ThreadsCtx {
  repo: string;
  threads: Thread[];
  /** called with the full, merged thread list after a successful write */
  onChange(threads: Thread[]): void;
}

let filter: ThreadFilter = 'open';

/** Interactive panel for one node: filter, threads, reply/resolve/reopen, new-thread composer. */
export function threadsPanel(
  node: { id: string; hash: string },
  ctx: ThreadsCtx,
  rerender: () => void,
): HTMLElement {
  const err = h('p', { class: 'error', role: 'alert' });
  const send = async (body: Record<string, unknown>) => {
    err.textContent = '';
    try {
      const r = await api<{ threads: Thread[] }>('POST', `/api/r/${ctx.repo}/comments`, body);
      ctx.onChange(r.threads);
    } catch (e) {
      err.textContent = e instanceof ApiError ? e.message : String(e);
    }
  };
  const box = (label: string) =>
    h('textarea', {
      rows: '2',
      maxlength: String(MAX_COMMENT_LEN),
      placeholder: label,
      'aria-label': label,
    }) as HTMLTextAreaElement;

  const mine = ctx.threads.filter((t) => t.node === node.id);
  const sel = h(
    'select',
    {
      'aria-label': 'Thread filter',
      class: 'th-filter',
      onchange: (e: any) => {
        filter = e.target.value;
        rerender();
      },
    },
    ...(['open', 'resolved', 'all'] as const).map((f) => h('option', { value: f }, f)),
  ) as HTMLSelectElement;
  sel.value = filter;

  const panel = h('div', { class: 'threads', id: 'threads' }, h('h4', {}, 'Comments ', sel));
  for (const t of byFilter(mine, filter)) {
    const reply = box('Reply…');
    const actions = h(
      'div',
      { class: 'thread-actions' },
      t.state === 'open' ? reply : null,
      t.state === 'open'
        ? h(
            'button',
            {
              class: 'btn',
              onclick: () =>
                reply.value.trim() && send({ op: 'reply', thread: t.id, body: reply.value }),
            },
            'Reply',
          )
        : null,
      h(
        'button',
        {
          class: 'btn',
          onclick: () => send({ op: t.state === 'open' ? 'resolve' : 'reopen', thread: t.id }),
        },
        t.state === 'open' ? 'Resolve' : 'Reopen',
      ),
    );
    panel.append(threadView(t, actions));
  }
  if (!byFilter(mine, filter).length)
    panel.append(h('p', { class: 'note' }, `No ${filter === 'all' ? '' : filter + ' '}threads.`));
  const nb = box('Start a thread on this node…');
  panel.append(
    nb,
    h(
      'button',
      {
        class: 'btn',
        id: 'new-thread',
        onclick: () => nb.value.trim() && send({ op: 'create', node: node.id, body: nb.value }),
      },
      'Comment',
    ),
    err,
  );
  return panel;
}
