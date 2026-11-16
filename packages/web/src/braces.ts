export interface BraceMark {
  /** offset of the brace */
  at: number;
  /** nesting colour slot 0..2, or -1 for an unmatched `}` */
  depth: number;
}

/**
 * Scan for `{`/`}` and number their nesting depth. `\{` `\}` are escaped text and
 * `#` comments (a `#` at line start or after whitespace, to end of line) are skipped.
 */
export function scanBraces(text: string): BraceMark[] {
  const out: BraceMark[] = [];
  let depth = 0;
  const stack: number[] = [];
  for (const m of text.matchAll(/\\[\s\S]|(?<=^|\s)#[^\n]*|[{}]/gm)) {
    if (m[0].length > 1) continue;
    const at = m.index!;
    if (m[0] === '{') {
      const d = depth++ % 3;
      stack.push(d);
      out.push({ at, depth: d });
    } else if (!stack.length) {
      out.push({ at, depth: -1 });
    } else {
      depth--;
      out.push({ at, depth: stack.pop()! });
    }
  }
  return out;
}
