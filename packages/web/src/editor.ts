import { autocompletion, type CompletionContext } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import {
  codeFolding,
  foldGutter,
  foldService,
  foldKeymap,
  foldedRanges,
} from '@codemirror/language';
import { linter, lintGutter, type Diagnostic as CmDiag } from '@codemirror/lint';
import { Compartment, EditorState, StateEffect, StateField, type Range } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  GutterMarker,
  ViewPlugin,
  drawSelection,
  gutter,
  keymap,
  lineNumbers,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { Vim, getCM, vim } from '@replit/codemirror-vim';
import { diff as coreDiff, lint, parse, type State } from '@specage/core/browser';
import { api, ApiError, loadMe } from './api.js';
import { analyse, dotStatus, nodeAtLine, slug, type Analysis } from './analysis.js';
import { conflictDialog } from './conflict.js';
import { h, store } from './dom.js';
import { renderPane } from './tracepane.js';
import { aggregateText } from './viewer.js';

const VIM_KEY = 'editor-vim';
const darkMq = matchMedia('(prefers-color-scheme: dark)');
// Tells CodeMirror which scheme it is in, so its own `&dark` rules (caret, selection, tooltips) apply.
const schemeTheme = (dark: boolean) => EditorView.theme({}, { dark });

const emptyState = (): State => ({
  trace: { retired_ids: [], consumed_lineage: [], nodes: {} },
  work: { items: [] },
  questions: [],
});

export async function renderEditor(root: HTMLElement, repo: string) {
  const me = await loadMe();
  if (!me) {
    location.href = '/login';
    return;
  }
  let spec: { content: string; head_sha: string; path: string };
  let state: State = emptyState();
  try {
    [spec, state] = await Promise.all([
      api('GET', `/api/r/${repo}/spec`),
      api('GET', `/api/r/${repo}/state`).then(
        (s: any) => ({ trace: s.trace, work: s.work, questions: s.questions }) as State,
      ),
    ]);
  } catch (e: any) {
    root.replaceChildren(h('p', { class: 'error' }, `Cannot open ${repo}: ${e.message}`));
    return;
  }
  let baseSha = spec.head_sha;
  let baseText = spec.content;
  let pinned = false;
  let pinnedId: string | null = null;

  // ---- CodeMirror pieces ----
  const setState = StateEffect.define<null>();
  const analysisField = StateField.define<Analysis>({
    create: (s) => analyse(s.doc.toString()),
    update: (a, tr) => (tr.docChanged ? analyse(tr.newDoc.toString()) : a),
  });

  class Dot extends GutterMarker {
    constructor(readonly status: string) {
      super();
    }
    eq(o: Dot) {
      return o.status === this.status;
    }
    toDOM() {
      const s = document.createElement('span');
      s.className = `dot st-${this.status}`;
      s.title = this.status.replace('_', ' ');
      s.dataset.status = this.status;
      return s;
    }
  }
  const statusGutter = gutter({
    class: 'cm-status-gutter',
    lineMarker(view, line) {
      const a = view.state.field(analysisField);
      const n = a.byLine.get(view.state.doc.lineAt(line.from).number);
      return n && n.id ? new Dot(dotStatus(n, state)) : null;
    },
    lineMarkerChange: (u) => u.transactions.some((t) => t.effects.some((e) => e.is(setState))),
    initialSpacer: () => new Dot('unknown'),
  });

  const foldBySpec = foldService.of((st, from, to) => {
    const a = st.field(analysisField);
    const b = a.blocks.find((r) => r.open >= from && r.open <= to);
    return b && b.close > b.open + 1 ? { from: b.open + 1, to: b.close } : null;
  });
  const folding = codeFolding({
    preparePlaceholder: (st, range) => {
      const a = st.field(analysisField);
      const i = a.blocks.findIndex((r) => r.open + 1 === range.from);
      const n = i >= 0 && a.blockNodes ? a.blockNodes[i] : null;
      if (!n) return '';
      const agg: Record<string, number> = {};
      const walk = (x: typeof n) =>
        x.type === 'leaf'
          ? (agg[dotStatus(x, state)] = (agg[dotStatus(x, state)] ?? 0) + 1)
          : x.children.forEach(walk);
      walk(n);
      return aggregateText(agg);
    },
    placeholderDOM: (_v, onclick, prepared) =>
      h('span', { class: 'cm-foldPlaceholder', onclick }, `… ${prepared || ''}`),
  });

  const decoRe: [RegExp, string][] = [
    [/(?<=^|\s)#[^\n]*/gm, 'cm-spec-comment'],
    [/\\[{};@#\\]/g, 'cm-spec-escape'],
    [
      /(?<!\\)@[a-z][a-z0-9_.-]*(?:\s*<-\s*[a-z][a-z0-9_.-]*(?:\s*,\s*[a-z][a-z0-9_.-]*)*)?/g,
      'cm-spec-id',
    ],
    [/(?<=(?:^|[;{}])\s*)(?:!\w+(?:[ \t]+\w+)?:|\?|>later:)/gm, 'cm-spec-marker'],
  ];
  const highlight = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(v: EditorView) {
        this.decorations = this.build(v);
      }
      update(u: ViewUpdate) {
        if (u.docChanged) this.decorations = this.build(u.view);
      }
      build(v: EditorView): DecorationSet {
        const text = v.state.doc.toString();
        const out: Range<Decoration>[] = [];
        for (const [re, cls] of decoRe)
          for (const m of text.matchAll(re))
            if (m[0])
              out.push(Decoration.mark({ class: cls }).range(m.index!, m.index! + m[0].length));
        return Decoration.set(out, true);
      }
    },
    { decorations: (p) => p.decorations },
  );

  const enclosingBlockId = (a: Analysis, pos: number): string => {
    let k = -1;
    a.blocks.forEach((b, i) => {
      if (b.open < pos && pos <= b.close) k = i;
    });
    return k >= 0 && a.blockNodes ? a.blockNodes[k].id : '';
  };

  const lintSource = linter(
    (view): CmDiag[] => {
      const doc = view.state.doc;
      const a = view.state.field(analysisField);
      return lint(a.spec, {
        retiredIds: state.trace.retired_ids,
        consumedLineage: state.trace.consumed_lineage,
      }).map((d) => {
        const line = doc.line(Math.min(Math.max(d.line, 1), doc.lines));
        const from = Math.min(line.from + Math.max(d.column - 1, 0), line.to);
        const to = Math.max(Math.min(line.to, from + 60), Math.min(from + 1, doc.length));
        const diag: CmDiag = {
          from,
          to,
          severity: d.level === 'error' ? 'error' : 'warning',
          message: `${d.code}: ${d.message}`,
          source: 'specage',
        };
        if (d.code === 'E002') {
          diag.actions = [
            {
              name: 'Add ID',
              apply(v, f) {
                const text = v.state.doc.toString();
                let i = f;
                while (i < text.length && !(text[i] === ';' || text[i] === '{'))
                  i += text[i] === '\\' ? 2 : 1;
                const parent = enclosingBlockId(v.state.field(analysisField), f);
                const base = `${parent ? parent + '.' : ''}${slug(text.slice(f, i))}`;
                const taken = new Set(v.state.field(analysisField).nodes.map((n) => n.id));
                let id = base,
                  k = 2;
                while (taken.has(id)) id = `${base}-${k++}`;
                let at = i;
                while (at > f && /\s/.test(text[at - 1])) at--;
                v.dispatch({ changes: { from: at, insert: ` @${id}` } });
              },
            },
          ];
        }
        return diag;
      });
    },
    { delay: 150 },
  );

  const idCompletion = (ctx: CompletionContext) => {
    const m = ctx.matchBefore(/(?<!\\)@[a-z0-9_.-]*/);
    if (!m && !ctx.explicit) return null;
    const a = ctx.state.field(analysisField);
    const parent = enclosingBlockId(a, ctx.pos);
    const prefix = parent ? `${parent}.` : '';
    const line = ctx.state.doc.lineAt(ctx.pos);
    const before = ctx.state.doc.sliceString(line.from, m ? m.from : ctx.pos);
    const taken = new Set(a.nodes.map((n) => n.id));
    const guess = `${prefix}${slug(before)}`;
    const opts = [
      { label: `@${guess}`, type: 'text' },
      { label: `@${prefix}`, type: 'text', boost: -1 },
    ]
      .concat(
        [...taken]
          .filter((id) => id.startsWith(prefix) && !id.slice(prefix.length).includes('.'))
          .slice(0, 20)
          .map((id) => ({ label: `@${id}`, type: 'variable', boost: -2 })),
      )
      .filter((o) => o.label !== `@${prefix}` || !!prefix);
    return { from: m ? m.from : ctx.pos, options: opts, validFor: /^@[a-z0-9_.-]*$/ };
  };

  // ---- layout ----
  const status = h('span', { id: 'status', class: 'status', role: 'status' });
  const saveBtn = h('button', { id: 'save', disabled: true }, 'Save') as HTMLButtonElement;
  const vimBox = h('input', { type: 'checkbox', id: 'vim' }) as HTMLInputElement;
  const vimMode = h('span', { id: 'vim-mode', class: 'vim-mode', role: 'status', hidden: true });
  const diagBox = h('ul', { id: 'diagnostics', class: 'diags' });
  const paneEl = h('aside', { id: 'pane', class: 'pane' });
  const editorEl = h('div', { id: 'editor', class: 'editor-host' });
  root.replaceChildren(
    h(
      'header',
      { class: 'top' },
      h('h1', {}, repo),
      h('a', { href: '/' }, 'repos'),
      status,
      h('label', { class: 'toggle', title: 'Vim keybindings' }, vimBox, 'Vim'),
      vimMode,
      saveBtn,
    ),
    diagBox,
    h('div', { class: 'split' }, editorEl, paneEl),
  );

  // the split fills the viewport below the (possibly wrapped) header
  const topEl = root.querySelector('header.top') as HTMLElement;
  const fitTop = () => root.style.setProperty('--top-h', `${topEl.offsetHeight}px`);
  fitTop();
  addEventListener('resize', fitTop);

  const dirty = () => view.state.doc.toString() !== baseText;
  const refreshButtons = () => {
    saveBtn.disabled = !dirty();
  };

  let paneTimer: number | undefined;
  const paneUpdate = () => {
    const a = view.state.field(analysisField);
    let n = null as ReturnType<typeof nodeAtLine>;
    if (pinned && pinnedId) n = a.byId.get(pinnedId) ?? null;
    else n = nodeAtLine(a, view.state.doc.lineAt(view.state.selection.main.head).number);
    renderPane(
      paneEl,
      a,
      n,
      {
        repo,
        state,
        goto(t) {
          const line = view.state.doc.line(Math.min(t.line, view.state.doc.lines));
          view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
          view.focus();
        },
      },
      pinned,
      (p) => {
        pinned = p;
        pinnedId = p ? (n?.id ?? null) : null;
      },
    );
  };

  // ---- vim (opt-in, persisted) ----
  const vimConf = new Compartment();
  const scheme = new Compartment();
  // drawSelection is needed for visual-mode selections; only on while vim is on so the
  // default (native) caret/selection is unchanged otherwise.
  const vimExt = () => [vim(), drawSelection()];
  const showMode = (mode: string, sub?: string) => {
    vimMode.textContent =
      `${mode}${sub === 'linewise' ? ' line' : sub === 'blockwise' ? ' block' : ''}`
        .toUpperCase()
        .trim();
  };
  const setVim = (on: boolean) => {
    view.dispatch({ effects: vimConf.reconfigure(on ? vimExt() : []) });
    vimBox.checked = on;
    vimMode.hidden = !on;
    if (on) {
      showMode('normal');
      // the plugin signals the initial mode before we can listen, so seed it above
      getCM(view)?.on('vim-mode-change', (e: { mode: string; subMode?: string }) =>
        showMode(e.mode, e.subMode),
      );
    }
  };
  vimBox.addEventListener('change', () => {
    setVim(vimBox.checked);
    store.set(VIM_KEY, vimBox.checked ? '1' : '0');
    view.focus();
  });
  // `:w` (and `:write`) saves through the same path as Mod-s / the Save button
  Vim.defineEx('write', 'w', () => void save());

  const view: EditorView = new EditorView({
    parent: editorEl,
    state: EditorState.create({
      doc: spec.content,
      extensions: [
        // vim must come before every other keymap so it sees keys first (passes through in insert mode)
        vimConf.of([]),
        scheme.of(schemeTheme(darkMq.matches)),
        analysisField,
        lineNumbers(),
        statusGutter,
        foldGutter(),
        foldBySpec,
        folding,
        history(),
        highlight,
        lintSource,
        lintGutter(),
        autocompletion({ override: [idCompletion] }),
        EditorView.lineWrapping,
        keymap.of([
          {
            key: 'Mod-s',
            run: () => {
              void save();
              return true;
            },
          },
          ...foldKeymap,
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged || u.selectionSet) {
            window.clearTimeout(paneTimer);
            paneTimer = window.setTimeout(paneUpdate, 150);
          }
          if (u.docChanged) refreshButtons();
        }),
        EditorView.contentAttributes.of({ 'aria-label': 'Spec editor' }),
      ],
    }),
  });
  void foldedRanges;
  if (store.get(VIM_KEY) === '1') setVim(true);
  darkMq.addEventListener('change', (e) =>
    view.dispatch({ effects: scheme.reconfigure(schemeTheme(e.matches)) }),
  );
  paneUpdate();
  addEventListener('beforeunload', (e) => {
    if (dirty()) e.preventDefault();
  });

  // ---- save ----
  const showDiags = (ds: { code: string; level: string; message: string; line: number }[]) =>
    diagBox.replaceChildren(
      ...ds.map((d) => h('li', { class: d.level }, `${d.line}: ${d.code} ${d.message}`)),
    );
  const say = (m: string, err = false) => {
    status.textContent = m;
    status.className = err ? 'status error' : 'status';
  };
  async function save(): Promise<boolean> {
    if (!dirty()) return true;
    const content = view.state.doc.toString();
    say('Saving…');
    try {
      const r = await api('PUT', `/api/r/${repo}/spec`, { content, base_sha: baseSha });
      baseSha = r.head_sha;
      baseText = content;
      diagBox.replaceChildren();
      say(`Saved ${baseSha.slice(0, 7)}`);
      refreshButtons();
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) {
        showDiags(e.body.diagnostics);
        say('Not saved: fix the errors above', true);
        return false;
      }
      if (e instanceof ApiError && e.status === 409) {
        const choice = await conflictDialog(baseText, e.body.content, content);
        if (choice === 'cancel') {
          say('Save cancelled: spec changed on GitHub', true);
          return false;
        }
        baseSha = e.body.head_sha;
        baseText = e.body.content;
        if (choice === 'remote') {
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: e.body.content },
          });
          say(`Loaded remote ${baseSha.slice(0, 7)}`);
          refreshButtons();
          return true;
        }
        return save();
      }
      say(`Save failed: ${(e as Error).message}`, true);
      return false;
    }
  }
  saveBtn.addEventListener('click', () => void save());

  store.set('last-repo', repo);
  // keep the unused import honest for tree shaking
  void coreDiff;
  void parse;
  // expose for refreshing gutter after state changes
  (window as any).__specageRefreshState = () => view.dispatch({ effects: setState.of(null) });
}
