import type { Diagnostic, Marker, Spec, SpecNode } from './model.js';
import { normalize, sha12 } from './hash.js';

export const MARKERS = ['constraint', 'impl', 'invariant', 'proof'] as const;
export const PROOF_KINDS = ['video', 'screenshot', 'demo', 'snippet', 'transcript', 'walkthrough'];
const ID_RE = /^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)*$/;

interface Raw {
  text: string; // unescaped, comments removed (whitespace not yet normalized)
  line: number;
  column: number;
}

/** Detect the marker at the start of normalized text. */
export function detectMarker(text: string): Marker | null {
  if (text.startsWith('?')) return { name: 'question' };
  if (text.startsWith('>later:')) return { name: 'later' };
  const m = /^!([A-Za-z][\w-]*)(?:\s+([A-Za-z][\w-]*))?\s*:/.exec(text);
  if (m) {
    const name = m[1];
    if (name === 'proof') return { name, kind: m[2] ?? '', unknown: false };
    if (m[2] === undefined && (name === 'constraint' || name === 'impl' || name === 'invariant'))
      return { name };
    return { name, unknown: true };
  }
  if (text.startsWith('!')) return { name: text.split(/\s/)[0], unknown: true };
  if (text.startsWith('>')) return { name: text.split(/[\s:]/)[0], unknown: true };
  return null;
}

class Parser {
  pos = 0;
  line = 1;
  col = 1;
  diags: Diagnostic[] = [];
  constructor(private src: string) {}

  err(code: string, message: string, line = this.line, column = this.col, node?: string) {
    this.diags.push({ code, level: 'error', message, line, column, node });
  }

  private peek(): string | undefined {
    return this.src[this.pos];
  }
  private next(): string {
    const c = this.src[this.pos++];
    if (c === '\n') {
      this.line++;
      this.col = 1;
    } else this.col++;
    return c;
  }

  /** Skip a comment if positioned on one. Returns true if consumed. */
  private skipComment(prevIsSpace: boolean): boolean {
    if (this.peek() === '#' && prevIsSpace) {
      while (this.pos < this.src.length && this.peek() !== '\n') this.next();
      return true;
    }
    return false;
  }

  /** Read text up to a reserved terminator. Stops before `@ ; { }` or EOF. */
  private readText(): Raw {
    let text = '';
    let line = 0;
    let column = 0;
    let prevSpace = true;
    while (this.pos < this.src.length) {
      const c = this.peek()!;
      if (this.skipComment(prevSpace)) continue;
      if (c === '@' || c === ';' || c === '{' || c === '}') break;
      if (c === '#') {
        this.err('E001', 'stray reserved character "#" (escape as \\#)');
        this.next();
        continue;
      }
      if (c === '\\') {
        const startLine = this.line;
        const startCol = this.col;
        this.next();
        const e = this.peek();
        if (e !== undefined && '{};@#\\'.includes(e)) {
          if (!line) {
            line = startLine;
            column = startCol;
          }
          text += this.next();
          prevSpace = false;
        } else {
          this.err('E001', 'invalid escape sequence', startLine, startCol);
        }
        continue;
      }
      const ws = /\s/.test(c);
      if (!ws && !line) {
        line = this.line;
        column = this.col;
      }
      text += this.next();
      prevSpace = ws;
    }
    return { text, line: line || this.line, column: column || this.col };
  }

  private derivedSeen = new Map<string, number>();

  /** Stable name for an ID-less statement: hash of its case/whitespace-normalized words. */
  private derive(text: string): string {
    const base = 's-' + sha12(text.toLowerCase()).slice(0, 8);
    const k = (this.derivedSeen.get(base) ?? 0) + 1;
    this.derivedSeen.set(base, k);
    return k === 1 ? base : `${base}-${k}`;
  }

  private skipWs() {
    let prevSpace = true;
    while (this.pos < this.src.length) {
      const c = this.peek()!;
      if (this.skipComment(prevSpace)) continue;
      if (/\s/.test(c)) {
        this.next();
        prevSpace = true;
      } else break;
    }
  }

  parseFile(): SpecNode[] {
    const out = this.parseStatements(null, 0);
    return out;
  }

  /** Parse statements until `}` (depth>0) or EOF. */
  private parseStatements(parent: SpecNode | null, depth: number): SpecNode[] {
    const nodes: SpecNode[] = [];
    for (;;) {
      this.skipWs();
      if (this.pos >= this.src.length) {
        if (depth > 0) this.err('E001', 'unbalanced braces: missing "}"');
        return nodes;
      }
      if (this.peek() === '}') {
        if (depth === 0) {
          this.err('E001', 'unbalanced braces: unexpected "}"');
          this.next();
          continue;
        }
        return nodes;
      }
      const n = this.parseStatement(parent, depth);
      if (n) nodes.push(n);
    }
  }

  private parseStatement(parent: SpecNode | null, depth: number): SpecNode | null {
    const raw = this.readText();
    const text = normalize(raw.text);
    let id: string | null = null;
    const lineage: string[] = [];
    const idLine = this.line;
    const idCol = this.col;
    if (this.peek() === '@') {
      this.next();
      let idText = '';
      while (this.pos < this.src.length && /[a-z0-9_.-]/i.test(this.peek()!)) idText += this.next();
      id = idText;
      if (!ID_RE.test(idText)) {
        this.err('E001', `invalid ID "${idText}"`, idLine, idCol);
      }
      // lineage clause
      const save = { pos: this.pos, line: this.line, col: this.col };
      this.skipWs();
      if (this.src.startsWith('<-', this.pos)) {
        this.next();
        this.next();
        for (;;) {
          this.skipWs();
          let t = '';
          while (this.pos < this.src.length && /[a-z0-9_.-]/i.test(this.peek()!)) t += this.next();
          if (!t || !ID_RE.test(t)) this.err('E001', 'invalid ID in lineage clause');
          else lineage.push(t);
          this.skipWs();
          if (this.peek() === ',') {
            this.next();
            continue;
          }
          break;
        }
      } else {
        this.pos = save.pos;
        this.line = save.line;
        this.col = save.col;
      }
      this.skipWs();
      // text after the id clause before terminator is a stray
      if (!['{', ';'].includes(this.peek() ?? '')) {
        if (this.peek() === '@') this.err('E001', 'second "@" in statement (escape as \\@)');
        else this.err('E001', 'expected ";" or "{" after ID', this.line, this.col);
        // recover: skip to next terminator
        while (this.pos < this.src.length && !['{', ';', '}'].includes(this.peek()!)) this.next();
      }
    }
    const term = this.peek();
    const marker = detectMarker(text);
    const make = (type: 'leaf' | 'block'): SpecNode => ({
      id: id ?? this.derive(text),
      derived: id === null,
      type,
      marker,
      text,
      hash: sha12(text),
      subtreeHash: '',
      parent: parent ? parent.id : null,
      children: [],
      lineage,
      line: raw.line,
      column: raw.column,
      endLine: this.line,
    });
    if (term === ';') {
      this.next();
      if (id === null && !text) {
        this.err('E002', 'empty statement', raw.line, raw.column);
        return null;
      }
      const n = make('leaf');
      n.endLine = this.line;
      return n;
    }
    if (term === '{') {
      this.next();
      const n = make('block');
      n.children = this.parseStatements(n, depth + 1);
      if (this.peek() === '}') {
        this.next();
        this.skipWs();
        if (this.peek() === ';') this.next();
        else this.err('E001', 'missing ";" after block "}"');
      }
      n.endLine = this.line;
      return n;
    }
    // EOF or '}' or '@' without terminator
    if (text || id !== null) {
      this.err('E001', 'missing ";" at end of statement', raw.line, raw.column);
      if (id !== null) return make('leaf');
    }
    if (this.peek() === '@') this.next();
    return null;
  }
}

export function computeSubtreeHashes(n: SpecNode): void {
  for (const c of n.children) computeSubtreeHashes(c);
  n.subtreeHash = sha12(n.hash + '\n' + n.children.map((c) => c.subtreeHash).join('\n'));
}

export function parse(src: string): Spec {
  const p = new Parser(src.replace(/^\uFEFF/, ''));
  const roots = p.parseFile();
  for (const r of roots) computeSubtreeHashes(r);
  return { roots, diagnostics: p.diags };
}

export function walk(roots: SpecNode[], fn: (n: SpecNode) => void): void {
  for (const r of roots) {
    fn(r);
    walk(r.children, fn);
  }
}

export function flatten(spec: Spec): SpecNode[] {
  const out: SpecNode[] = [];
  walk(spec.roots, (n) => out.push(n));
  return out;
}

export function indexById(spec: Spec): Map<string, SpecNode> {
  const m = new Map<string, SpecNode>();
  walk(spec.roots, (n) => {
    if (n.id && !m.has(n.id)) m.set(n.id, n);
  });
  return m;
}
