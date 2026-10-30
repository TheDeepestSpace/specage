import { h } from './dom.js';

/** Flags lines of `other` that are not part of the longest common subsequence with `base`. */
export function changedLines(base: string[], other: string[]): boolean[] {
  const m = base.length;
  const n = other.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--) dp[i][j] = base[i] === other[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const changed = new Array(n).fill(true);
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (base[i] === other[j]) { changed[j] = false; i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return changed;
}

function column(title: string, text: string, flags: boolean[] | null): HTMLElement {
  const lines = text.split('\n');
  return h('div', { class: 'col' }, h('h3', {}, title),
    h('pre', {}, ...lines.map((l, i) => h('div', { class: flags?.[i] ? 'ln chg' : 'ln' }, l || ' '))));
}

export type Resolution = 'remote' | 'mine' | 'cancel';

/** 3-way view (base / remote / local). Resolves with the user's choice. */
export function conflictDialog(base: string, remote: string, local: string): Promise<Resolution> {
  return new Promise((resolve) => {
    const d = h('dialog', { class: 'conflict', id: 'conflict' });
    const done = (r: Resolution) => { d.close(); d.remove(); resolve(r); };
    const b = base.split('\n');
    d.append(
      h('h2', {}, 'The spec changed on GitHub'),
      h('p', {}, 'Highlighted lines differ from the base you started from.'),
      h('div', { class: 'cols' },
        column('Base', base, null),
        column('Remote', remote, changedLines(b, remote.split('\n'))),
        column('Yours', local, changedLines(b, local.split('\n')))),
      h('div', { class: 'actions' },
        h('button', { id: 'use-remote', onclick: () => done('remote') }, 'Use remote (discard mine)'),
        h('button', { id: 'reapply', onclick: () => done('mine') }, 'Re-apply mine on top of remote'),
        h('button', { onclick: () => done('cancel') }, 'Cancel')),
    );
    d.addEventListener('cancel', () => done('cancel'));
    document.body.append(d);
    d.showModal();
  });
}
