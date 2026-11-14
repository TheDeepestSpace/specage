import {
  nodeStatus,
  type Question,
  type SpecNode,
  type State,
  type Thread,
} from '@specage/core/browser';
import { ancestors, type Analysis } from './analysis.js';
import { evidenceView } from './evidence.js';
import { h } from './dom.js';
import { specSegments } from './highlight.js';
import { questionsSection } from './questions.js';
import { threadsPanel } from './threads.js';
import { bodyText, chip } from './viewer.js';

export interface PaneCtx {
  repo: string;
  state: State;
  threads: Thread[];
  onThreads(t: Thread[]): void;
  onQuestions(q: Question[]): void;
  goto(n: SpecNode): void;
}

function proofsUnder(n: SpecNode, out: SpecNode[] = []): SpecNode[] {
  if (n.marker?.name === 'proof') out.push(n);
  n.children.forEach((c) => proofsUnder(c, out));
  return out;
}

export function renderPane(
  el: HTMLElement,
  a: Analysis,
  n: SpecNode | null,
  ctx: PaneCtx,
  pinned: boolean,
  onPin: (p: boolean) => void,
) {
  const pin = h(
    'label',
    { class: 'pin' },
    h('input', { type: 'checkbox', id: 'pin', onchange: (e: any) => onPin(e.target.checked) }),
    ' pin',
  );
  (pin.querySelector('input') as HTMLInputElement).checked = pinned;
  const qctx = { repo: ctx.repo, onChange: ctx.onQuestions };
  // top-level questions (their node was removed with no surviving ancestor) always show in the panel
  const top = questionsSection(ctx.state.questions, '', qctx);
  if (!n || !n.id) {
    el.replaceChildren(
      pin,
      ...(top ? [top] : []),
      h('p', { class: 'note' }, 'Place the cursor in a node.'),
    );
    return;
  }

  const crumbs = h('nav', { class: 'crumbs', id: 'crumbs' });
  for (const p of ancestors(a, n))
    crumbs.append(
      h(
        'a',
        {
          href: '#',
          onclick: (e: Event) => {
            e.preventDefault();
            ctx.goto(p);
          },
        },
        p.id,
      ),
      ' › ',
    );
  crumbs.append(h('strong', {}, n.id));

  const st = nodeStatus(n, ctx.state);
  const tr = ctx.state.trace.nodes[n.id];
  const body = h(
    'div',
    { class: 'pane-body' },
    h('div', { class: 'pane-head' }, chip(st), h('code', {}, n.hash)),
    h(
      'p',
      { class: 'ptext ptext-code' },
      ...specSegments(bodyText({ ...n, children: [] } as any)).map((g) =>
        g.cls ? h('span', { class: g.cls }, g.text) : g.text,
      ),
    ),
  );
  if (st === 'stale' && tr)
    body.append(
      h(
        'p',
        { class: 'note warn', id: 'stale-note' },
        `Changed since ${tr.status} (trace attests ${tr.spec_hash}).`,
      ),
    );
  if (tr) {
    body.append(
      h('h4', {}, 'Trace'),
      h(
        'div',
        { class: 'tracemeta' },
        `${tr.status} @ ${tr.spec_hash}${tr.verified ? ` · verified by ${tr.verified.by} (${tr.verified.hash})` : ''}`,
      ),
    );
    if (tr.evidence.length)
      body.append(h('ul', {}, ...tr.evidence.map((e) => evidenceView(e, ctx.repo))));
  } else body.append(h('p', { class: 'note' }, 'No trace yet.'));

  const items = ctx.state.work.items.filter((w) => w.claims[n.id]);
  if (items.length) {
    body.append(
      h('h4', {}, 'Work'),
      h(
        'ul',
        {},
        ...items.map((w) => {
          const c = w.claims[n.id];
          return h(
            'li',
            {},
            `${w.id}${w.issue ? ` · #${w.issue}` : ''}${w.pr ? ` · PR #${w.pr}` : ''} · ${w.state}${c.hash !== n.hash ? ' · claim is on an older hash' : ''}`,
          );
        }),
      ),
    );
  }
  const nq = questionsSection(ctx.state.questions, n.id, qctx);
  if (nq) body.append(nq);
  body.append(
    threadsPanel(
      n as { id: string; hash: string },
      { repo: ctx.repo, threads: ctx.threads, onChange: ctx.onThreads },
      () => renderPane(el, a, n, ctx, pinned, onPin),
    ),
  );
  const proofs = proofsUnder(n);
  if (proofs.length)
    body.append(
      h('h4', {}, 'Proofs'),
      h(
        'ul',
        {},
        ...proofs.map((p) =>
          h('li', {}, p.marker?.kind ?? '?', ': ', bodyText({ ...p, children: [] } as any)),
        ),
      ),
    );
  if (n.children.length) {
    body.append(
      h('h4', {}, 'Children'),
      h(
        'ul',
        { class: 'children' },
        ...n.children.map((c) =>
          h(
            'li',
            {},
            h(
              'a',
              {
                href: '#',
                onclick: (e: Event) => {
                  e.preventDefault();
                  ctx.goto(c);
                },
              },
              c.id,
            ),
            ' ',
            chip(nodeStatus(c, ctx.state)),
          ),
        ),
      ),
    );
  }
  el.replaceChildren(pin, ...(top ? [top] : []), crumbs, body);
}
