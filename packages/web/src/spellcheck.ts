// In-editor spellcheck: word extraction (pure, tested) + lazy dictionary loading.
// Browser spellcheck only checks text after it is edited/focused, so we check the whole doc ourselves.

export interface Word {
  from: number;
  to: number;
  word: string;
}

// Non-prose spans: escapes, ids, $refs, markers. (Comments are prose and are checked.)
const SKIP: RegExp[] = [
  /\\[{};@#\\]|\\(?=[ \t]*\r?$)/gm,
  /(?<!\\)@[a-z][a-z0-9_.-]*(?:\s*<-\s*[a-z][a-z0-9_.-]*(?:\s*,\s*[a-z][a-z0-9_.-]*)*)?/g,
  /(?<![\w$\\])\$[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)*/g,
  /(?<=(?:^|[;{}])\s*)(?:!\w+(?:[ \t]+\w+)?:|\?|>later:)/gm,
];

const WORD = /\p{L}[\p{L}'’]*/gu;

export function extractWords(text: string): Word[] {
  const skipped: [number, number][] = [];
  for (const re of SKIP)
    for (const m of text.matchAll(re)) if (m[0]) skipped.push([m.index!, m.index! + m[0].length]);
  const inSkip = (a: number, b: number) => skipped.some(([s, e]) => a < e && b > s);
  const out: Word[] = [];
  for (const m of text.matchAll(WORD)) {
    let word = m[0].replace(/’/g, "'").replace(/^'+|'+$/g, '');
    const from = m.index!;
    const to = from + m[0].length;
    const before = text[from - 1] ?? '';
    const after = text[to] ?? '';
    if (word.length < 2) continue;
    if (/[\d_$@\\]/.test(before) || /[\d_$@\\]/.test(after)) continue; // identifier-like
    if (word === word.toUpperCase()) continue; // acronyms
    if (/[a-z][A-Z]/.test(word)) continue; // camelCase
    if (inSkip(from, to)) continue;
    out.push({ from, to, word });
    word = '';
  }
  return out;
}

export interface Checker {
  correct(word: string): boolean;
}

let loading: Promise<Checker> | null = null;
/** Loads nspell + the English dictionary on first use. */
export function loadChecker(): Promise<Checker> {
  loading ??= (async () => {
    const [{ default: nspell }, aff, dic] = await Promise.all([
      import('nspell'),
      import('../../../node_modules/dictionary-en/index.aff?raw'),
      import('../../../node_modules/dictionary-en/index.dic?raw'),
    ]);
    return nspell(aff.default, dic.default);
  })();
  return loading;
}

export function misspellings(text: string, c: Checker): Word[] {
  return extractWords(text).filter((w) => !c.correct(w.word));
}
