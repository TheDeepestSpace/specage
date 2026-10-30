import type { NodeView, SpecData } from '@specage/core/browser';
import { evidenceView } from './evidence.js';
import { h, safeUrl, store } from './dom.js';

export const STATUS_LABEL: Record<string, string> = {
  unknown: 'untracked', planned: 'planned', in_progress: 'in progress', implemented: 'implemented',
  verified: 'verified', stale: 'stale', contradiction: 'contradiction', absent: 'absent',
};

export function chip(status: string): HTMLElement {
  return h('span', { class: `chip st-${status}`, title: STATUS_LABEL[status] ?? status }, STATUS_LABEL[status] ?? status);
}

export function aggregateText(agg: Record<string, number> | undefined): string {
  if (!agg) return '';
  const total = Object.values(agg).reduce((a, b) => a + b, 0);
  if (!total) return 'empty';
  const parts = [`${agg.verified ?? 0}/${total} verified`];
  for (const k of ['stale', 'contradiction', 'absent', 'in_progress', 'planned', 'implemented', 'unknown'])
    if (agg[k]) parts.push(`${agg[k]} ${STATUS_LABEL[k]}`);
  return parts.join(', ');
}

const MARKER_LABEL: Record<string, string> = {
  constraint: 'constraint', impl: 'impl', invariant: 'invariant', proof: 'proof', question: 'question', later: 'later',
};

export function markerBadge(n: NodeView): HTMLElement | null {
  if (!n.marker || n.marker.unknown) return null;
  const kind = n.marker.kind ? ` ${n.marker.kind}` : '';
  return h('span', { class: `marker mk-${n.marker.name}` }, `${MARKER_LABEL[n.marker.name] ?? n.marker.name}${kind}`);
}

/** Text with the leading marker stripped (the badge shows it instead). */
export function bodyText(n: NodeView): string {
  if (!n.marker || n.marker.unknown) return n.text;
  return n.text.replace(/^(!\w+(\s+\w+)?:|\?|>later:)\s*/, '');
}

export function renderViewer(root: HTMLElement, data: SpecData) {
  const repo = data.repo;
  const search = h('input', { type: 'search', placeholder: 'Search spec…', 'aria-label': 'Search' }) as HTMLInputElement;
  const list = h('div', { class: 'tree' });
  const editUrl = data.edit_url && repo ? safeUrl(`${data.edit_url.replace(/\/$/, '')}/r/${repo}`, new URL(data.edit_url).origin) : null;
  const header = h('header', { class: 'top' },
    h('h1', {}, data.project || 'specage'),
    h('span', { class: 'meta' }, `${Object.keys(data.nodes).length} nodes · generated ${data.generated.slice(0, 16).replace('T', ' ')}Z`),
    search,
    editUrl ? h('a', { class: 'btn', href: editUrl }, 'Edit') : null,
  );
  root.replaceChildren(header);
  if (data.report) root.append(h('details', { class: 'report' }, h('summary', {}, 'Latest dispatch report'), h('pre', {}, data.report)));
  root.append(list);

  const openQuestions = data.questions.filter((q) => q.state === 'open');
  const els = new Map<string, { row: HTMLElement; det?: HTMLDetailsElement }>();

  function leafRow(n: NodeView): HTMLElement {
    const tr = data.trace[n.id];
    const row = h('div', { class: `leaf st-row-${n.status}`, id: n.id },
      chip(n.status), markerBadge(n), h('span', { class: 'text' }, bodyText(n)),
      h('a', { class: 'anchor', href: `#${n.id}`, title: n.id }, '#'));
    const extra = h('div', { class: 'detail' });
    if (tr?.evidence.length) extra.append(h('ul', {}, ...tr.evidence.map((e) => evidenceView(e, repo))));
    if (tr) extra.append(h('div', { class: 'tracemeta' }, `trace: ${tr.status} @ ${tr.spec_hash}${tr.verified ? ` · verified by ${tr.verified.by}` : ''}`));
    for (const q of openQuestions.filter((q) => q.node === n.id))
      extra.append(h('div', { class: 'question' }, h('strong', {}, `${q.kind}: `), q.text, q.options ? h('ul', {}, ...q.options.map((o) => h('li', {}, o))) : null));
    for (const w of data.work.filter((w) => w.claims[n.id])) {
      const c = w.claims[n.id];
      extra.append(h('div', { class: 'work' }, `${w.id}${w.issue ? ` · issue #${w.issue}` : ''}${w.pr ? ` · PR #${w.pr}` : ''} · ${w.state} · claim ${c.status}${c.hash !== n.hash ? ' (stale hash)' : ''}`));
    }
    if (openQuestions.some((q) => q.node === n.id)) row.classList.add('has-question');
    if (extra.childElementCount) {
      const d = h('details', { class: 'leafdet' }, h('summary', {}), extra);
      d.querySelector('summary')!.replaceWith(h('summary', {}, row));
      els.set(n.id, { row: d, det: d });
      return d;
    }
    els.set(n.id, { row });
    return row;
  }

  function block(n: NodeView, depth: number): HTMLElement {
    const det = h('details', { class: 'block', open: store.get(`c:${n.id}`) !== '0' && depth < 3 }, h('summary', {},
      h('span', { class: 'btext' }, bodyText(n)), h('span', { class: 'agg' }, aggregateText(data.aggregate[n.id])),
      h('a', { class: 'anchor', href: `#${n.id}`, title: n.id }, '#')));
    det.id = n.id;
    det.addEventListener('toggle', () => store.set(`c:${n.id}`, det.open ? '1' : '0'));
    for (const c of n.children) det.append(build(data.nodes[c], depth + 1));
    els.set(n.id, { row: det, det });
    return det;
  }
  const build = (n: NodeView, depth: number): HTMLElement => (n.type === 'block' ? block(n, depth) : leafRow(n));
  for (const id of data.roots) list.append(build(data.nodes[id], 0));

  function reveal() {
    const id = decodeURIComponent(location.hash.slice(1));
    const e = els.get(id);
    if (!e) return;
    let p: HTMLElement | null = e.row;
    while (p) { if (p instanceof HTMLDetailsElement) p.open = true; p = p.parentElement; }
    e.row.scrollIntoView({ block: 'center' });
    document.querySelectorAll('.target').forEach((x) => x.classList.remove('target'));
    (e.row.querySelector('.leaf') ?? e.row).classList.add('target');
  }
  addEventListener('hashchange', reveal);
  reveal();

  function filter() {
    const q = search.value.trim().toLowerCase();
    const match = (n: NodeView): boolean => {
      const self = !q || n.id.includes(q) || n.text.toLowerCase().includes(q);
      const kids = n.children.map((c) => match(data.nodes[c]));
      const any = self || kids.some(Boolean);
      const e = els.get(n.id)!;
      e.row.hidden = !any;
      if (q && any && e.det && n.type === 'block') e.det.open = true;
      return any;
    };
    data.roots.forEach((r) => match(data.nodes[r]));
  }
  search.addEventListener('input', filter);
}
