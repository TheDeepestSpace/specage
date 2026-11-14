import {
  acceptCompletion,
  autocompletion,
  completionKeymap,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  codeFolding,
  foldGutter,
  foldService,
  foldKeymap,
  foldedRanges,
} from '@codemirror/language';
import { specTokens } from './highlight.js';
import { linter, lintGutter, type Diagnostic as CmDiag } from '@codemirror/lint';
import {
  Compartment,
  EditorState,
  Prec,
  StateEffect,
  StateField,
  type Range,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  GutterMarker,
  ViewPlugin,
  drawSelection,
  gutter,
  hoverTooltip,
  keymap,
  lineNumbers,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { Vim, getCM, vim } from '@replit/codemirror-vim';
import { diff as coreDiff, lint, parse, type State, type Thread } from '@specage/core/browser';
import { api, ApiError, loadMe } from './api.js';
import {
  analyse,
  dotClass,
  dotPulse,
  dotStatus,
  diagRange,
  nodeAtLine,
  slug,
  type Analysis,
} from './analysis.js';
import { conflictDialog } from './conflict.js';
import { h, setupBadge, store, warningBanner, type SetupInfo } from './dom.js';
import grammarSrc from '../../../protocol/GRAMMAR.md?raw';
import { renderMarkdown } from './markdown.js';
import { openFor } from './questions.js';
import { loadChecker, misspellings, type Checker } from './spellcheck.js';
import { renderPane } from './tracepane.js';
import { openCount } from './threads.js';
import { aggregateText } from './viewer.js';

const VIM_KEY = 'editor-vim';
const darkMq = matchMedia('(prefers-color-scheme: dark)');
// Tells CodeMirror which scheme it is in, so its own `&dark` rules (caret, selection, tooltips) apply.
const schemeTheme = (dark: boolean) => EditorView.theme({}, { dark });

const emptyState = (): State => ({
  trace: { retired_ids: [], consumed_lineage: [], nodes: {} },
  work: { items: [] },
  questions: [],
  thread_events: [],
});

export async function renderEditor(root: HTMLElement, repo: string) {
  const me = await loadMe();
  if (!me) {
    location.href = '/login';
    return;
  }
  let spec: { content: string; head_sha: string; path: string };
  let state: State = emptyState();
  let active = new Set<string>();
  let threads: Thread[] = [];
  let warnings: string[] = [];
  try {
    [spec, state] = await Promise.all([
      api('GET', `/api/r/${repo}/spec`),
      api('GET', `/api/r/${repo}/state`).then((s: any) => {
        threads = s.threads ?? [];
        warnings = s.warnings ?? [];
        active = new Set<string>(s.active_nodes ?? []);
        return {
          trace: s.trace,
          work: s.work,
          questions: s.questions,
          thread_events: [],
        } as State;
      }),
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
    constructor(
      readonly status: string,
      readonly pulse = false,
    ) {
      super();
    }
    eq(o: Dot) {
      return o.status === this.status && o.pulse === this.pulse;
    }
    toDOM() {
      const s = document.createElement('span');
      s.className = dotClass(this.status, this.pulse);
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
      return n && n.id ? new Dot(dotStatus(n, state), dotPulse(n, state, active)) : null;
    },
    lineMarkerChange: (u) => u.transactions.some((t) => t.effects.some((e) => e.is(setState))),
    initialSpacer: () => new Dot('unknown'),
  });

  class Bubble extends GutterMarker {
    constructor(readonly n: number) {
      super();
    }
    eq(o: Bubble) {
      return o.n === this.n;
    }
    toDOM() {
      const s = document.createElement('span');
      s.className = 'cmt-marker';
      s.dataset.count = String(this.n);
      s.title = `${this.n} open comment thread${this.n > 1 ? 's' : ''}`;
      s.textContent = String(this.n);
      return s;
    }
  }
  const commentGutter = gutter({
    class: 'cm-comment-gutter',
    lineMarker(view, line) {
      const a = view.state.field(analysisField);
      const n = a.byLine.get(view.state.doc.lineAt(line.from).number);
      const c = n && n.id ? openCount(threads, n.id) : 0;
      return c ? new Bubble(c) : null;
    },
    lineMarkerChange: (u) => u.transactions.some((t) => t.effects.some((e) => e.is(setState))),
  });

  class QBadge extends GutterMarker {
    constructor(readonly n: number) {
      super();
    }
    eq(o: QBadge) {
      return o.n === this.n;
    }
    toDOM() {
      const s = document.createElement('span');
      s.className = 'q-badge';
      s.dataset.count = String(this.n);
      s.title = `${this.n} open question${this.n > 1 ? 's' : ''}`;
      s.textContent = '?';
      return s;
    }
  }
  // orange `?` right of the status circle; clicking selects the node so the side panel opens its questions
  const questionGutter = gutter({
    class: 'cm-question-gutter',
    lineMarker(view, line) {
      const a = view.state.field(analysisField);
      const n = a.byLine.get(view.state.doc.lineAt(line.from).number);
      const c = n && n.id ? openFor(state.questions, n.id).length : 0;
      return c ? new QBadge(c) : null;
    },
    lineMarkerChange: (u) => u.transactions.some((t) => t.effects.some((e) => e.is(setState))),
    domEventHandlers: {
      click(view, line) {
        view.dispatch({ selection: { anchor: line.from } });
        paneUpdate();
        paneEl.querySelector('#node-questions')?.scrollIntoView({ block: 'nearest' });
        return true;
      },
    },
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
        const out: Range<Decoration>[] = specTokens(v.state.doc.toString()).map((t) =>
          Decoration.mark({ class: t.cls }).range(t.from, t.to),
        );
        return Decoration.set(out, true);
      }
    },
    { decorations: (p) => p.decorations },
  );

  // Spellcheck prose (ids, $refs, markers, escapes excluded) on load and, debounced, on edit.
  const spell = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none;
      checker: Checker | null = null;
      timer = 0;
      destroyed = false;
      constructor(readonly v: EditorView) {
        void loadChecker().then((c) => {
          if (this.destroyed) return;
          this.checker = c;
          this.run();
        });
      }
      update(u: ViewUpdate) {
        if (!u.docChanged) {
          this.decorations = this.decorations.map(u.changes);
          return;
        }
        this.decorations = this.decorations.map(u.changes);
        window.clearTimeout(this.timer);
        this.timer = window.setTimeout(() => this.run(), 300);
      }
      run() {
        if (!this.checker) return;
        const marks = misspellings(this.v.state.doc.toString(), this.checker).map((w) =>
          Decoration.mark({ class: 'cm-spell-error' }).range(w.from, w.to),
        );
        this.decorations = Decoration.set(marks, true);
        this.v.dispatch({}); // redraw with the new decorations
      }
      destroy() {
        this.destroyed = true;
        window.clearTimeout(this.timer);
      }
    },
    { decorations: (p) => p.decorations },
  );

  // vertical ruler at column 100; lives in the scroller so it scrolls with the content
  const RULER_COL = 100;
  const ruler = ViewPlugin.fromClass(
    class {
      dom: HTMLElement;
      constructor(readonly v: EditorView) {
        this.dom = document.createElement('div');
        this.dom.className = 'cm-ruler';
        this.dom.setAttribute('aria-hidden', 'true');
        v.scrollDOM.appendChild(this.dom);
        this.place();
      }
      update(u: ViewUpdate) {
        if (u.geometryChanged || u.docChanged || u.viewportChanged) this.place();
      }
      place() {
        const v = this.v;
        const line = v.contentDOM.querySelector('.cm-line');
        const pad = line ? parseFloat(getComputedStyle(line).paddingLeft) || 0 : 0;
        this.dom.style.left = `${v.contentDOM.offsetLeft + pad + RULER_COL * v.defaultCharacterWidth}px`;
        this.dom.style.height = `${v.contentHeight}px`;
      }
      destroy() {
        this.dom.remove();
      }
    },
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
      const text = view.state.doc.toString();
      const a = view.state.field(analysisField);
      return lint(a.spec, {
        retiredIds: state.trace.retired_ids,
        consumedLineage: state.trace.consumed_lineage,
        source: text,
      }).map((d) => {
        const { from, to } = diagRange(text, d);
        const diag: CmDiag = {
          from,
          to,
          severity: d.level === 'error' ? 'error' : 'warning',
          message: `${d.code}: ${d.message}`,
          source: 'specage',
        };
        return diag;
      });
    },
    { delay: 150 },
  );

  // statement markers valid at the start of a statement
  const markerOptions = [
    { label: '!invariant:', detail: 'invariant', apply: '!invariant: ' },
    { label: '!constraint:', detail: 'constraint', apply: '!constraint: ' },
    { label: '!impl:', detail: 'implementation note', apply: '!impl: ' },
    { label: '!proof', detail: 'proof (e.g. !proof video:)', apply: '!proof ' },
    { label: '?', detail: 'open question' },
    { label: '>later:', detail: 'deferred item' },
  ].map((o) => ({ type: 'keyword', ...o }));
  const markerCompletion = (ctx: CompletionContext): CompletionResult | null => {
    const m = ctx.matchBefore(/(?<=(?:^|[;{}])\s*)[!?>][\w:]*/m);
    if (!m) return null;
    return { from: m.from, options: markerOptions, validFor: /^[!?>][\w:]*$/ };
  };

  const idCompletion = (ctx: CompletionContext): CompletionResult | null => {
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

  // `$id` references: autocomplete, hover preview, Ctrl/Cmd-click to jump
  const refCompletion = (ctx: CompletionContext): CompletionResult | null => {
    const m = ctx.matchBefore(/(?<![\w$\\])\$[a-z0-9_.-]*/);
    if (!m) return null;
    const a = ctx.state.field(analysisField);
    const options = a.nodes
      .filter((n) => !n.derived)
      .map((n) => ({ label: `$${n.id}`, detail: n.text.slice(0, 50), type: 'variable' }));
    return { from: m.from, options, validFor: /^\$[a-z0-9_.-]*$/ };
  };
  const refAt = (st: EditorState, pos: number): { id: string; from: number; to: number } | null => {
    const line = st.doc.lineAt(pos);
    for (const m of line.text.matchAll(
      /(?<![\w$\\])\$([a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)*)/g,
    )) {
      const from = line.from + m.index!;
      if (pos >= from && pos <= from + m[0].length)
        return { id: m[1], from, to: from + m[0].length };
    }
    return null;
  };
  const refTooltip = hoverTooltip((view, pos) => {
    const r = refAt(view.state, pos);
    if (!r) return null;
    const n = view.state.field(analysisField).nodes.find((x) => !x.derived && x.id === r.id);
    return {
      pos: r.from,
      end: r.to,
      above: true,
      create: () => ({
        dom: h('div', { class: 'cm-ref-tip' }, n ? `${n.id}: ${n.text}` : `unresolved: ${r.id}`),
      }),
    };
  });
  const refJump = EditorView.domEventHandlers({
    mousedown(e, view) {
      if (!(e.ctrlKey || e.metaKey)) return false;
      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
      const r = pos === null ? null : refAt(view.state, pos);
      const n = r && view.state.field(analysisField).nodes.find((x) => !x.derived && x.id === r.id);
      if (!n) return false;
      const target = view.state.doc.line(Math.min(Math.max(n.line, 1), view.state.doc.lines));
      view.dispatch({ selection: { anchor: target.from }, scrollIntoView: true });
      view.focus();
      return true;
    },
  });

  // ---- layout ----
  const status = h('span', { id: 'status', class: 'status', role: 'status' });
  const saveBtn = h('button', { id: 'save', disabled: true }, 'Save') as HTMLButtonElement;
  const vimBox = h('input', { type: 'checkbox', id: 'vim' }) as HTMLInputElement;
  const vimMode = h('span', { id: 'vim-mode', class: 'vim-mode', role: 'status', hidden: true });
  const diagBox = h('ul', { id: 'diagnostics', class: 'diags' });
  const paneEl = h('aside', { id: 'pane', class: 'pane' });
  const editorEl = h('div', { id: 'editor', class: 'editor-host' });
  // Tabs: the CodeMirror view stays mounted (just hidden) so edits/cursor survive switching.
  const grammarEl = h('article', {
    id: 'grammar',
    class: 'grammar-host',
    role: 'tabpanel',
    'aria-labelledby': 'tab-grammar',
    hidden: true,
  });
  grammarEl.append(renderMarkdown(grammarSrc));
  const specTab = h(
    'button',
    {
      id: 'tab-spec',
      role: 'tab',
      'aria-selected': 'true',
      'aria-controls': 'editor',
    },
    'Spec',
  );
  const grammarTab = h(
    'button',
    {
      id: 'tab-grammar',
      role: 'tab',
      'aria-selected': 'false',
      'aria-controls': 'grammar',
    },
    'GRAMMAR.md',
  );
  const selectTab = (which: 'spec' | 'grammar') => {
    const spec = which === 'spec';
    specTab.setAttribute('aria-selected', String(spec));
    grammarTab.setAttribute('aria-selected', String(!spec));
    editorEl.hidden = !spec;
    grammarEl.hidden = spec;
    if (spec) view.focus();
  };
  specTab.addEventListener('click', () => selectTab('spec'));
  grammarTab.addEventListener('click', () => selectTab('grammar'));
  const editorCol = h(
    'div',
    { class: 'editor-col' },
    h('div', { class: 'tabs', role: 'tablist' }, specTab, grammarTab),
    editorEl,
    grammarEl,
  );
  const setupSlot = h('span', { class: 'setup-slot' });
  // non-blocking: the badge appears only when auto-merge isn't fully set up (clears on next load once fixed)
  api('GET', `/api/r/${repo}/setup`)
    .then((s: SetupInfo) => {
      const b = setupBadge(s);
      setupSlot.replaceChildren(...(b ? [b] : []));
      fitTop();
    })
    .catch(() => {});
  root.replaceChildren(
    h(
      'header',
      { class: 'top' },
      h('h1', {}, repo),
      h('a', { href: '/' }, 'repos'),
      setupSlot,
      status,
      h('label', { class: 'toggle', title: 'Vim keybindings' }, vimBox, 'Vim'),
      vimMode,
      saveBtn,
    ),
    ...(warnings.length ? [warningBanner(warnings)] : []),
    diagBox,
    h('div', { class: 'split' }, editorCol, paneEl),
  );

  // the split fills the viewport below the (possibly wrapped) header
  const topEl = root.querySelector('header.top') as HTMLElement;
  const bannerEl = root.querySelector('.banner-warn') as HTMLElement | null;
  const fitTop = () =>
    root.style.setProperty('--top-h', `${topEl.offsetHeight + (bannerEl?.offsetHeight ?? 0)}px`);
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
        threads,
        onThreads(t) {
          threads = t;
          view.dispatch({ effects: setState.of(null) });
          paneUpdate();
        },
        onQuestions(q) {
          state = { ...state, questions: q };
          view.dispatch({ effects: setState.of(null) });
          paneUpdate();
        },
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

  let tabEscape = false;
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
        questionGutter,
        commentGutter,
        foldGutter(),
        foldBySpec,
        folding,
        history(),
        highlight,
        spell,
        ruler,
        lintSource,
        lintGutter(),
        refTooltip,
        refJump,
        autocompletion({
          override: [idCompletion, refCompletion, markerCompletion],
          defaultKeymap: true,
        }),
        EditorView.lineWrapping,
        // highest precedence: the completion keymap swallows Escape while its popup is open
        Prec.highest(
          EditorView.domEventHandlers({
            // a11y escape hatch: Esc then Tab lets focus leave the editor
            keydown(e) {
              if (e.key === 'Escape') tabEscape = true;
              else if (e.key !== 'Tab' && !e.key.startsWith('Shift')) tabEscape = false;
              return false;
            },
          }),
        ),
        keymap.of([
          { key: 'Tab', run: acceptCompletion },
          {
            key: 'Tab',
            run: (v) => (tabEscape ? false : indentWithTab.run!(v)),
            shift: (v) => (tabEscape ? false : indentWithTab.shift!(v)),
          },
          {
            key: 'Mod-s',
            run: () => {
              void save();
              return true;
            },
          },
          ...foldKeymap,
          ...completionKeymap,
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
        // in-editor spellcheck (see `spell`); native spellcheck only fires on focus/edit, so it is off
        EditorView.contentAttributes.of({ 'aria-label': 'Spec editor', spellcheck: 'false' }),
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
