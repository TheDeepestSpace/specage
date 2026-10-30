import { nodeStatus, type SpecNode, type State } from '@specage/core/browser';
import { ancestors, type Analysis } from './analysis.js';
import { evidenceView } from './evidence.js';
import { h } from './dom.js';
import { bodyText, chip } from './viewer.js';

export interface PaneCtx {
  repo: string;
  state: State;
  goto(n: SpecNode): void;
}

function proofsUnder(n: SpecNode, out: SpecNode[] = []): SpecNode[] {
  if (n.marker?.name === 'proof') out.push(n);
  n.children.forEach((c) => proofsUnder(c, out));
  return out;
}

export function renderPane(el: HTMLElement, a: Analysis, n: SpecNode | null, ctx: PaneCtx, pinned: boolean, onPin: (p: boolean) => void) {
  const pin = h('label', { class: 'pin' }, h('input', { type: 'checkbox', id: 'pin', onchange: (e: any) => onPin(e.target.checked) }), ' pin');
  (pin.querySelector('input') as HTMLInputElement).checked = pinned;
  if (!n || !n.id) { el.replaceChildren(pin, h('p', { class: 'note' }, 'Place the cursor in a node.')); return; }

  const crumbs = h('nav', { class: 'crumbs', id: 'crumbs' });
  for (const p of ancestors(a, n)) crumbs.append(h('a', { href: '#', onclick: (e: Event) => { e.preventDefault(); ctx.goto(p); } }, p.id), ' › ');
  crumbs.append(h('strong', {}, n.id));

  const st = nodeStatus(n, ctx.state);
  const tr = ctx.state.trace.nodes[n.id];
  const body = h('div', { class: 'pane-body' },
    h('div', { class: 'pane-head' }, chip(st), h('code', {}, n.hash)),
    h('p', { class: 'ptext' }, bodyText({ ...n, children: [] } as any)),
  );
  if (st === 'stale' && tr) body.append(h('p', { class: 'note warn', id: 'stale-note' }, `Changed since ${tr.status} (trace attests ${tr.spec_hash}).`));
  if (tr) {
    body.append(h('h4', {}, 'Trace'), h('div', { class: 'tracemeta' }, `${tr.status} @ ${tr.spec_hash}${tr.verified ? ` · verified by ${tr.verified.by} (${tr.verified.hash})` : ''}`));
    if (tr.evidence.length) body.append(h('ul', {}, ...tr.evidence.map((e) => evidenceView(e, ctx.repo))));
  } else body.append(h('p', { class: 'note' }, 'No trace yet.'));

  const items = ctx.state.work.items.filter((w) => w.claims[n.id]);
  if (items.length) {
    body.append(h('h4', {}, 'Work'), h('ul', {}, ...items.map((w) => {
      const c = w.claims[n.id];
      return h('li', {}, `${w.id}${w.issue ? ` · #${w.issue}` : ''}${w.pr ? ` · PR #${w.pr}` : ''} · ${w.state} · ${c.status}${c.hash !== n.hash ? ' · claim is on an older hash' : ''}`);
    })));
  }
  const qs = ctx.state.questions.filter((q) => q.node === n.id && q.state === 'open');
  if (qs.length) body.append(h('h4', {}, 'Questions'), ...qs.map((q) => h('div', { class: 'question' }, h('strong', {}, `${q.kind}: `), q.text)));
  const proofs = proofsUnder(n);
  if (proofs.length) body.append(h('h4', {}, 'Proofs'), h('ul', {}, ...proofs.map((p) => h('li', {}, p.marker?.kind ?? '?', ': ', bodyText({ ...p, children: [] } as any)))));
  if (n.children.length) {
    body.append(h('h4', {}, 'Children'), h('ul', { class: 'children' }, ...n.children.map((c) =>
      h('li', {}, h('a', { href: '#', onclick: (e: Event) => { e.preventDefault(); ctx.goto(c); } }, c.id), ' ', chip(nodeStatus(c, ctx.state))))));
  }
  el.replaceChildren(pin, crumbs, body);
}
