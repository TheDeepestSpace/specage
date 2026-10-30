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
    if (url.protocol !== 'https:' && !(url.origin === location.origin && url.protocol === 'http:')) return null;
    const host = url.hostname;
    if (host === 'github.com' || host.endsWith('.githubusercontent.com') || host.endsWith('.github.io')) return url.href;
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
    try { return localStorage.getItem(k); } catch { return mem.get(k) ?? null; }
  },
  set(k: string, v: string) {
    try { localStorage.setItem(k, v); } catch { mem.set(k, v); }
  },
};

export function fail(root: HTMLElement, msg: string) {
  root.replaceChildren(h('p', { class: 'error' }, msg));
}
