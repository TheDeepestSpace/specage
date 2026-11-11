import { describe, expect, it } from 'vitest';
import { parse, type State } from '@specage/core/browser';
import { dotClass, dotPulse, dotStatus } from '../src/analysis.js';

const spec = parse('@blk { @a one; @b two }\n');
const [blk] = spec.roots;
const leaf = (id: string) => blk.children.find((c) => c.id === id)!;

const st = (a: string, b = 'planned'): State => ({
  trace: {
    retired_ids: [],
    consumed_lineage: [],
    nodes: Object.fromEntries(
      [
        ['a', a],
        ['b', b],
      ].map(([id, status]) => [id, { spec_hash: leaf(id).hash, status, evidence: [] }]),
    ),
  },
  work: { items: [] },
  questions: [],
  thread_events: [],
});

describe('dot colour mapping', () => {
  it.each(['implemented', 'in_progress', 'planned'])('%s', (s) =>
    expect(dotStatus(leaf('a'), st(s))).toBe(s),
  );
  it('untracked is unknown', () => {
    const s = st('planned');
    s.trace.nodes = {};
    expect(dotStatus(leaf('a'), s)).toBe('unknown');
  });
  it('class carries st-<status>', () => expect(dotClass('planned', false)).toBe('dot st-planned'));
});

describe('dot pulse', () => {
  const on = new Set(['a']);
  it('pulses only for active + in_progress', () => {
    expect(dotPulse(leaf('a'), st('in_progress'), on)).toBe(true);
    expect(dotClass('in_progress', true)).toContain('pulse');
  });
  it('solid when in_progress but inactive', () => {
    expect(dotPulse(leaf('a'), st('in_progress'), new Set())).toBe(false);
    expect(dotClass('in_progress', false)).not.toContain('pulse');
  });
  it('no pulse for other statuses', () => {
    for (const s of ['implemented', 'planned']) {
      expect(dotPulse(leaf('a'), st(s), on)).toBe(false);
      expect(dotClass(s, true)).not.toContain('pulse');
    }
  });
  it('block pulses if any aggregated orange leaf is active', () => {
    expect(dotPulse(blk, st('planned', 'in_progress'), new Set(['b']))).toBe(true);
    expect(dotPulse(blk, st('planned', 'in_progress'), on)).toBe(false);
  });
});
