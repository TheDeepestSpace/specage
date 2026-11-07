import { MAX_ANSWER_LEN, type Question } from '@specage/core/browser';
import { api, ApiError } from './api.js';
import { h } from './dom.js';

export const isOpen = (q: Question) => q.state === 'open';

/** Open questions anchored on a node ('' = top-level, shown in the side panel with no node selected). */
export const openFor = (qs: Question[], node: string) =>
  qs.filter((q) => q.node === node && isOpen(q));

const when = (at: string) => at.slice(0, 16).replace('T', ' ');

export interface QuestionsCtx {
  repo: string;
  /** full question list after a successful write */
  onChange(qs: Question[]): void;
  /** false in read-only views */
  interactive?: boolean;
}

/** One question = one thread: planner text, the Q&A messages, then answer controls while open. */
export function questionThread(q: Question, ctx: QuestionsCtx): HTMLElement {
  const err = h('p', { class: 'error', role: 'alert' });
  const send = async (body: { choice?: 'withdraw' | 'keep'; body?: string }) => {
    err.textContent = '';
    try {
      const r = await api<{ questions: Question[] }>('POST', `/api/r/${ctx.repo}/questions`, {
        id: q.id,
        ...body,
      });
      ctx.onChange(r.questions);
    } catch (e) {
      err.textContent = e instanceof ApiError ? e.message : String(e);
    }
  };
  const inner: (HTMLElement | null)[] = [
    h('div', { class: 'q-head' }, h('strong', {}, `${q.kind}: `), q.text),
    q.issue
      ? h(
          'div',
          { class: 'cmeta q-gate' },
          isOpen(q) ? `Holding dispatch of #${q.issue} until resolved.` : `Issue #${q.issue}`,
        )
      : null,
    ...q.thread.map((m) =>
      h(
        'div',
        { class: 'comment q-msg' },
        h(
          'div',
          { class: 'cmeta' },
          h('strong', {}, m.author),
          ` · ${when(m.at)}`,
          m.choice ? ` · ${m.choice}` : '',
        ),
        h('div', { class: 'cbody' }, m.body),
      ),
    ),
  ];
  if (isOpen(q) && ctx.interactive !== false) {
    const box = h('textarea', {
      rows: '2',
      maxlength: String(MAX_ANSWER_LEN),
      placeholder: q.thread.length ? 'Follow up…' : 'Answer in your own words…',
      'aria-label': 'Answer',
    }) as HTMLTextAreaElement;
    inner.push(
      h(
        'div',
        { class: 'q-actions' },
        h(
          'button',
          { class: 'btn q-withdraw', onclick: () => send({ choice: 'withdraw', body: box.value }) },
          'Withdraw',
        ),
        h(
          'button',
          { class: 'btn q-keep', onclick: () => send({ choice: 'keep', body: box.value }) },
          'Keep',
        ),
        ...(q.options ?? []).map((o) =>
          h('button', { class: 'btn q-option', onclick: () => send({ body: o }) }, o),
        ),
      ),
      box,
      h(
        'button',
        {
          class: 'btn q-send',
          onclick: () => box.value.trim() && send({ body: box.value }),
        },
        'Send',
      ),
      err,
    );
  }
  const attrs = { class: `question q-thread q-${q.state}`, 'data-question': q.id };
  // resolved / withdrawn threads collapse but stay expandable
  if (!isOpen(q))
    return h(
      'details',
      attrs,
      h('summary', {}, `${q.state}: ${q.text.slice(0, 80)}${q.text.length > 80 ? '…' : ''}`),
      ...inner,
    );
  return h('div', attrs, ...inner);
}

/** All questions for a node ('' = top-level): unresolved first, unanswered ones always visible. */
export function questionsSection(
  qs: Question[],
  node: string,
  ctx: QuestionsCtx,
): HTMLElement | null {
  const mine = qs.filter((q) => q.node === node && q.state !== 'addressed');
  if (!mine.length) return null;
  const sorted = [...mine.filter(isOpen), ...mine.filter((q) => !isOpen(q))];
  return h(
    'div',
    { class: 'questions', id: node ? 'node-questions' : 'top-questions' },
    h('h4', {}, node ? 'Questions' : 'Questions (whole spec)'),
    ...sorted.map((q) => questionThread(q, ctx)),
  );
}
