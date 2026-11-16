import type { Evidence } from '@specage/core/browser';

export interface FileTab {
  path: string;
  commit: string;
  /** inclusive 1-based line ranges to highlight; empty = whole file, no highlight */
  ranges: [number, number][];
}

/** `imp` = code/pr references; `prf` = everything that proves it (tests, screenshots, videos, ...). */
export const isImp = (e: Evidence) => e.kind === 'code' || e.kind === 'pr';

export function parseRef(ref: string): { path: string; range: [number, number] | null } {
  const i = ref.indexOf('#');
  const path = i < 0 ? ref : ref.slice(0, i);
  const m = i < 0 ? null : /^L?(\d+)(?:-L?(\d+))?$/.exec(ref.slice(i + 1));
  if (!m) return { path, range: null };
  const a = +m[1];
  const b = m[2] ? +m[2] : a;
  return { path, range: a <= b ? [a, b] : [b, a] };
}

/** One tab per distinct (file, commit); highlights from all evidence entries on that file are merged. */
export function impTabs(ev: Evidence[]): FileTab[] {
  const tabs = new Map<string, FileTab>();
  for (const e of ev) {
    if (e.kind !== 'code' || !e.commit || /^https?:/.test(e.ref)) continue;
    const { path, range } = parseRef(e.ref);
    if (!path) continue;
    const key = `${e.commit}\0${path}`;
    const t = tabs.get(key) ?? { path, commit: e.commit, ranges: [] };
    if (range) t.ranges.push(range);
    tabs.set(key, t);
  }
  return [...tabs.values()];
}

export function badges(ev: Evidence[]): { imp: boolean; prf: boolean } {
  return { imp: ev.some(isImp), prf: ev.some((e) => !isImp(e)) };
}
