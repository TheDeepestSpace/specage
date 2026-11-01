import type { Evidence } from '@specage/core/browser';
import { h, safeUrl } from './dom.js';

const IMG = /\.(png|jpe?g|gif|webp)$/i;
const VID = /\.(webm|mp4)$/i;

function fileUrl(repo: string | undefined, e: Evidence, raw = false): string | null {
  if (!repo) return null;
  if (e.kind === 'pr') return safeUrl(`https://github.com/${repo}/pull/${e.ref}`);
  if (e.kind === 'issue') return safeUrl(`https://github.com/${repo}/issues/${e.ref}`);
  if (/^https:\/\//.test(e.ref)) return safeUrl(e.ref);
  if (!e.commit) return null; // evidence must be pinned to a commit; never link a branch
  const [path, frag] = e.ref.split('#');
  const base = `https://github.com/${repo}/${raw ? 'raw' : 'blob'}/${e.commit}/${path.split('/').map(encodeURIComponent).join('/')}`;
  return safeUrl(raw || !frag ? base : `${base}#${frag}`);
}

function lightbox(src: string) {
  const d = h(
    'dialog',
    { class: 'lightbox' },
    h('img', { src, alt: 'evidence' }),
    h('button', { onclick: () => d.close() }, 'Close'),
  );
  d.addEventListener('click', (ev) => {
    if (ev.target === d) d.close();
  });
  d.addEventListener('close', () => d.remove());
  document.body.append(d);
  d.showModal();
}

export function evidenceView(e: Evidence, repo?: string): HTMLElement {
  const label = `${e.kind}${e.tier ? ` · ${e.tier}` : ''}${e.inherited ? ' · inherited' : ''}`;
  const li = h(
    'li',
    { class: `evidence tier-${e.tier ?? 'none'}` },
    h('span', { class: 'ev-kind' }, label),
    ' ',
  );
  const href = fileUrl(repo, e);
  li.append(
    href
      ? h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, e.ref)
      : h('span', {}, e.ref),
  );
  if (e.commit) li.append(h('code', { class: 'sha' }, e.commit.slice(0, 7)));
  const path = e.ref.split('#')[0];
  const raw = fileUrl(repo, e, true);
  if (raw && IMG.test(path)) {
    const img = h('img', {
      class: 'thumb',
      src: raw,
      alt: path,
      loading: 'lazy',
      referrerpolicy: 'no-referrer',
    });
    img.addEventListener('click', () => lightbox(raw));
    li.append(h('div', {}, img));
  } else if (raw && VID.test(path)) {
    li.append(h('div', {}, h('video', { controls: true, preload: 'none', src: raw })));
  }
  return li;
}
