// Token regexes + classes shared by the code panel (CodeMirror decorations) and the status pane.
export const decoRe: [RegExp, string][] = [
  [/(?<=^|\s)#[^\n]*/gm, 'cm-spec-comment'],
  [/\\[{};@#\\]|\\(?=[ \t]*\r?$)/gm, 'cm-spec-escape'],
  [
    /(?<!\\)@[a-z][a-z0-9_.-]*(?:\s*<-\s*[a-z][a-z0-9_.-]*(?:\s*,\s*[a-z][a-z0-9_.-]*)*)?/g,
    'cm-spec-id',
  ],
  [/(?<![\w$\\])\$[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)*/g, 'cm-spec-ref'],
  [/(?<=(?:^|[;{}])\s*)(?:!\w+(?:[ \t]+\w+)?:|\?|>later:)/gm, 'cm-spec-marker'],
];

export interface Token {
  from: number;
  to: number;
  cls: string;
}

export function specTokens(text: string): Token[] {
  const out: Token[] = [];
  for (const [re, cls] of decoRe)
    for (const m of text.matchAll(re))
      if (m[0]) out.push({ from: m.index!, to: m.index! + m[0].length, cls });
  return out;
}

export interface Segment {
  text: string;
  cls?: string;
}

/** Split text into plain/token segments (earlier-listed token wins on overlap). */
export function specSegments(text: string): Segment[] {
  const toks = specTokens(text).sort((a, b) => a.from - b.from);
  const out: Segment[] = [];
  let pos = 0;
  for (const t of toks) {
    if (t.from < pos) continue;
    if (t.from > pos) out.push({ text: text.slice(pos, t.from) });
    out.push({ text: text.slice(t.from, t.to), cls: t.cls });
    pos = t.to;
  }
  if (pos < text.length) out.push({ text: text.slice(pos) });
  return out;
}
