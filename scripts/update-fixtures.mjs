// Regenerates the golden files next to fixtures/tbgwaf/tbgwaf.specage. Deliberate: review the diff.
import { readFileSync, writeFileSync } from 'node:fs';
import { parse, lint, flatten } from '../packages/core/dist/index.js';

const dir = new URL('../fixtures/tbgwaf/', import.meta.url);
const spec = parse(readFileSync(new URL('tbgwaf.specage', dir), 'utf8'));
const strip = (n) => ({
  id: n.id, type: n.type, marker: n.marker, text: n.text, parent: n.parent, lineage: n.lineage,
  line: n.line, children: n.children.map(strip),
});
const w = (f, v) => writeFileSync(new URL(f, dir), JSON.stringify(v, null, 2) + '\n');
w('parse.json', spec.roots.map(strip));
w('hash.json', Object.fromEntries(flatten(spec).map((n) => [n.id, { hash: n.hash, subtree_hash: n.subtreeHash }])));
w('lint.json', lint(spec));
console.log('fixtures updated');
