import { EditorState, RangeSetBuilder } from '@codemirror/state';
import { Decoration, EditorView, lineNumbers } from '@codemirror/view';
import type { Evidence } from '@specage/core/browser';
import { api } from './api.js';
import { h } from './dom.js';
import { evidenceView } from './evidence.js';
import { impTabs, isImp, type FileTab } from './traces.js';

function open(title: string, ...body: (Node | string | null)[]) {
  const d = h(
    'dialog',
    { class: 'trace-modal' },
    h('h3', {}, title),
    ...body.filter((x): x is Node | string => x !== null),
    h('button', { class: 'trace-close', onclick: () => d.close() }, 'Close'),
  );
  d.addEventListener('click', (ev) => {
    if (ev.target === d) d.close();
  });
  d.addEventListener('close', () => d.remove());
  document.body.append(d);
  d.showModal();
  return d;
}

function fileView(content: string, ranges: [number, number][]): HTMLElement {
  const host = h('div', { class: 'trace-file' });
  const doc = EditorState.create({ doc: content }).doc;
  const b = new RangeSetBuilder<Decoration>();
  const lines = new Set<number>();
  for (const [a, z] of ranges)
    for (let n = Math.max(1, a); n <= Math.min(doc.lines, z); n++) lines.add(n);
  for (const n of [...lines].sort((x, y) => x - y))
    b.add(doc.line(n).from, doc.line(n).from, Decoration.line({ class: 'cm-trace-hl' }));
  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: content,
      extensions: [
        lineNumbers(),
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        EditorView.decorations.of(b.finish()),
      ],
    }),
  });
  const first = [...lines].sort((x, y) => x - y)[0];
  if (first)
    requestAnimationFrame(() =>
      view.dispatch({ effects: EditorView.scrollIntoView(doc.line(first).from, { y: 'start' }) }),
    );
  return host;
}

export function openImpModal(repo: string, id: string, ev: Evidence[]) {
  const tabs = impTabs(ev);
  const bar = h('div', { class: 'trace-tabs', role: 'tablist' });
  const pane = h('div', { class: 'trace-pane' });
  const buttons: HTMLElement[] = [];
  const show = async (t: FileTab, btn: HTMLElement) => {
    buttons.forEach((x) => x.setAttribute('aria-selected', String(x === btn)));
    pane.replaceChildren(h('p', { class: 'note' }, 'Loading…'));
    try {
      const q = new URLSearchParams({ path: t.path, commit: t.commit });
      const r = await api<{ content: string }>('GET', `/api/r/${repo}/file?${q}`);
      if (btn.getAttribute('aria-selected') !== 'true') return;
      pane.replaceChildren(fileView(r.content, t.ranges));
    } catch (e: any) {
      if (btn.getAttribute('aria-selected') === 'true')
        pane.replaceChildren(
          h(
            'p',
            { class: 'error' },
            `Cannot load ${t.path} @ ${t.commit.slice(0, 7)}: ${e.message}`,
          ),
        );
    }
  };
  for (const t of tabs) {
    const btn = h(
      'button',
      { class: 'trace-tab', role: 'tab', onclick: () => void show(t, btn) },
      t.path,
    );
    buttons.push(btn);
    bar.append(btn);
  }
  const others = ev.filter((e) => isImp(e) && e.kind !== 'code');
  const d = open(
    `Implementation · ${id}`,
    tabs.length ? bar : h('p', { class: 'note' }, 'No pinned code references.'),
    pane,
    others.length ? h('ul', {}, ...others.map((e) => evidenceView(e, repo))) : null,
  );
  if (tabs.length) void show(tabs[0], buttons[0]);
  return d;
}

export function openPrfModal(repo: string, id: string, ev: Evidence[]) {
  const proofs = ev.filter((e) => !isImp(e));
  return open(
    `Proof · ${id}`,
    proofs.length
      ? h('ul', { class: 'trace-proofs' }, ...proofs.map((e) => evidenceView(e, repo)))
      : h('p', { class: 'note' }, 'No proof artifacts.'),
  );
}
