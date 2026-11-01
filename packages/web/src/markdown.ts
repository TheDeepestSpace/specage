// Minimal markdown -> DOM renderer for trusted, bundled docs (GRAMMAR.md).
// Builds nodes only (never innerHTML). Supports headings, paragraphs, fenced code,
// tables, lists, inline code, bold, italic and https links.
import { h } from './dom.js';

function inline(text: string): Node[] {
  const out: Node[] = [];
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(document.createTextNode(text.slice(last, m.index)));
    if (m[1] !== undefined) out.push(h('code', {}, m[1]));
    else if (m[2] !== undefined) out.push(h('strong', {}, ...inline(m[2])));
    else if (m[3] !== undefined) out.push(h('em', {}, ...inline(m[3])));
    else if (/^https:\/\//.test(m[5]))
      out.push(h('a', { href: m[5], rel: 'noopener noreferrer', target: '_blank' }, m[4]));
    else out.push(document.createTextNode(m[4]));
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(document.createTextNode(text.slice(last)));
  return out;
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, '|'));

export function renderMarkdown(src: string): HTMLElement {
  const root = h('div', { class: 'md' });
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
    } else if (line.startsWith('```')) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) body.push(lines[i++]);
      i++;
      root.append(h('pre', {}, h('code', {}, body.join('\n'))));
    } else if (/^#{1,6}\s/.test(line)) {
      const n = /^#+/.exec(line)![0].length;
      root.append(h(`h${n}` as 'h1', {}, ...inline(line.replace(/^#+\s+/, ''))));
      i++;
    } else if (line.startsWith('|') && /^\|?\s*:?-+/.test(lines[i + 1] ?? '')) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith('|')) rows.push(cells(lines[i++]));
      root.append(
        h(
          'table',
          {},
          h('thead', {}, h('tr', {}, ...head.map((c) => h('th', {}, ...inline(c))))),
          h(
            'tbody',
            {},
            ...rows.map((r) => h('tr', {}, ...r.map((c) => h('td', {}, ...inline(c))))),
          ),
        ),
      );
    } else if (/^\s*([-*]|\d+\.)\s/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: HTMLElement[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s/.test(lines[i])) {
        items.push(h('li', {}, ...inline(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ''))));
        i++;
      }
      root.append(h(ordered ? 'ol' : 'ul', {}, ...items));
    } else {
      const para: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        !lines[i].startsWith('```') &&
        !/^#{1,6}\s/.test(lines[i]) &&
        !lines[i].startsWith('|') &&
        !/^\s*([-*]|\d+\.)\s/.test(lines[i])
      )
        para.push(lines[i++].trim());
      root.append(h('p', {}, ...inline(para.join(' '))));
    }
  }
  return root;
}
