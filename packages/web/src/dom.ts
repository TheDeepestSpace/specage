// Tiny DOM helpers. Everything goes through textContent / setAttribute: never innerHTML.
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | ((e: any) => void) | undefined> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (typeof v === 'string') el.setAttribute(k, v);
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

/** Only these hosts may be linked from untrusted (spec/state) content. */
export function safeUrl(u: string, extraOrigin?: string): string | null {
  try {
    const url = new URL(u, location.href);
    if (url.protocol !== 'https:' && !(url.origin === location.origin && url.protocol === 'http:'))
      return null;
    const host = url.hostname;
    if (
      host === 'github.com' ||
      host.endsWith('.githubusercontent.com') ||
      host.endsWith('.github.io')
    )
      return url.href;
    if (url.origin === location.origin) return url.href;
    if (extraOrigin && url.origin === extraOrigin) return url.href;
    return null;
  } catch {
    return null;
  }
}

const mem = new Map<string, string>();
/** localStorage may be unavailable (sandboxed Pages, private mode): fall back to memory. */
export const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return mem.get(k) ?? null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      mem.set(k, v);
    }
  },
};

export function fail(root: HTMLElement, msg: string) {
  root.replaceChildren(h('p', { class: 'error' }, msg));
}

/** Visible banner listing problems in the state files (the invalid parts were ignored). */
export function warningBanner(warnings: string[]): HTMLElement {
  return h(
    'div',
    { class: 'banner-warn', role: 'alert' },
    h('strong', {}, 'Some state data was ignored because it is invalid:'),
    h('ul', {}, ...warnings.map((w) => h('li', {}, w))),
  );
}

export interface SetupInfo {
  auto_merge: 'ok' | 'missing' | 'unverified';
  gate: 'ok' | 'missing' | 'unverified';
  fix: string[];
  ready: boolean;
}

/** Header badge + popup while auto-merge isn't fully configured; null once both settings are verified. */
export function setupBadge(s: SetupInfo): HTMLElement | null {
  if (s.ready) return null;
  const unverified = s.auto_merge !== 'missing' && s.gate !== 'missing';
  const label = (name: string, v: SetupInfo['gate']) =>
    h(
      'li',
      { 'data-state': v },
      `${name}: ${v === 'ok' ? 'on' : v === 'missing' ? 'missing' : 'unverified'}`,
    );
  const pop = h(
    'div',
    { class: 'setup-pop', role: 'dialog', hidden: '' },
    h('strong', {}, 'Auto-merge is not set up for this repo'),
    h('ul', {}, label('Allow auto-merge', s.auto_merge), label('Required check "ci-gate"', s.gate)),
    h('p', {}, 'To fix:'),
    h('ul', {}, ...s.fix.map((x) => h('li', {}, x))),
    ...(unverified
      ? [
          h(
            'p',
            { class: 'hint' },
            'specage could not read these settings; grant the App "Administration: read" to verify.',
          ),
        ]
      : []),
  );
  const btn = h(
    'button',
    { class: 'setup-badge', type: 'button', 'data-kind': unverified ? 'unverified' : 'missing' },
    unverified ? 'Setup unverified' : 'Setup needed',
  );
  btn.addEventListener('click', () => pop.toggleAttribute('hidden'));
  return h('span', { class: 'setup' }, btn, pop);
}
