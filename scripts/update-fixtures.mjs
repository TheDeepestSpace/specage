// Regenerates the golden files next to fixtures/tbgwaf/tbgwaf.specage. Deliberate: review the diff.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parse, lint, flatten } from '../packages/core/dist/index.js';

const dir = new URL('../fixtures/tbgwaf/', import.meta.url);
const spec = parse(readFileSync(new URL('tbgwaf.specage', dir), 'utf8'));
const strip = (n) => ({
  id: n.id,
  type: n.type,
  marker: n.marker,
  text: n.text,
  parent: n.parent,
  lineage: n.lineage,
  line: n.line,
  children: n.children.map(strip),
});
const w = (f, v) => writeFileSync(new URL(f, dir), JSON.stringify(v, null, 2) + '\n');
w('parse.json', spec.roots.map(strip));
w(
  'hash.json',
  Object.fromEntries(
    flatten(spec).map((n) => [n.id, { hash: n.hash, subtree_hash: n.subtreeHash }]),
  ),
);
w('lint.json', lint(spec));
console.log('fixtures updated');

// Sample spec-state (used by the CLI render test, the Playwright e2e and the dogfood page).
const h = Object.fromEntries(flatten(spec).map((n) => [n.id, n.hash]));
const state = new URL('state/', dir);
mkdirSync(new URL('dispatches/', state), { recursive: true });
const C = '9ff2e3a0000000000000000000000000000000aa';
writeFileSync(
  new URL('trace.yaml', state),
  `retired_ids: [shoot.lock.torso]
consumed_lineage: []
nodes:
  shoot.burst.cap:
    spec_hash: ${h['shoot.burst.cap']}
    status: implemented
    evidence:
      - {kind: scenario, ref: tests/scenarios/burst_mag_caps.yaml, commit: ${C}, tier: tested}
      - {kind: code, ref: src/game/Weapon.h#L60-L75, commit: ${C}, tier: located}
      - {kind: pr, ref: 138}
    verified: {by: TheDeepestSpace, at: 2026-10-30T14:02Z, hash: ${h['shoot.burst.cap']}}
  shoot.burst.bar:
    spec_hash: 1c07aa19be02
    status: implemented
    evidence:
      - {kind: screenshot, ref: tests/golden/hud_bar.png, commit: ${C}, tier: tested}
  shoot.burst.death:
    spec_hash: ${h['shoot.burst.death']}
    status: planned
  round.duration:
    spec_hash: ${h['round.duration']}
    status: contradiction
    evidence:
      - {kind: code, ref: src/game/GameLogic.h#L88, commit: ${C}, tier: located}
  menu.pause:
    spec_hash: ${h['menu.pause']}
    status: implemented
    evidence:
      - {kind: video, ref: tests/proofs/pause.webm, commit: ${C}, tier: tested}
`,
);
writeFileSync(
  new URL('work.yaml', state),
  `items:
  - id: w-0042
    issue: 251
    pr: 254
    state: in_review
    relations: []
    claims:
      shoot.burst.death: {hash: ${h['shoot.burst.death']}, status: pending}
      shoot.burst.cap: {hash: ${h['shoot.burst.cap']}, status: done}
`,
);
writeFileSync(
  new URL('questions.yaml', state),
  `- id: q-0007
  node: round.duration
  node_hash: ${h['round.duration']}
  dispatch: dispatch/2026-10-30T02-11Z
  kind: contradiction
  text: "GameLogic.h says a round ends when nothing is in flight, but the code always runs the full 5 s. Which is intended?"
  options: ["spec is right (full 5 s)", "comment is right (early end)"]
  state: open
  answer: null
`,
);
writeFileSync(
  new URL('dispatches/dispatch-2026-10-30T02-11Z.md', state),
  `# dispatch/2026-10-30T02-11Z

1 contradiction, 3 implemented, 1 planned.

- round.duration: contradiction, question q-0007
- shoot.burst.cap: implemented (tested), no issue
- shoot.burst.death: planned, issue #251
`,
);
console.log('sample state written');
