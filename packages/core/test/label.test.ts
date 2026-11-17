import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string): string => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');

describe('specage label', () => {
  it('planner files issues with --label specage', () => {
    expect(read('protocol/PROTOCOL.md')).toContain('gh issue create --label specage');
  });
  it('worker opens PRs with --label specage', () => {
    expect(read('prompts/implement.md')).toContain('gh pr create --label specage');
    expect(read('protocol/PROTOCOL.md')).toContain('gh pr create --label specage');
  });
});
