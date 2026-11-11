import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script without types
import { isApproved } from '../../../scripts/approval.mjs';

const r = (body: string, commit_id: string, t: number, login = 'the-intern-bot[bot]') => ({
  user: { login },
  body,
  commit_id,
  submitted_at: new Date(t * 1000).toISOString(),
});

describe('isApproved', () => {
  it('accepts latest bot APPROVE at head', () => {
    expect(isApproved([r('APPROVE\nlgtm', 'abc', 1)], 'abc')).toBe(true);
  });
  it('rejects stale commit', () => {
    expect(isApproved([r('APPROVE', 'old', 1)], 'abc')).toBe(false);
  });
  it('latest review wins', () => {
    expect(isApproved([r('APPROVE', 'abc', 1), r('CHANGES REQUESTED', 'abc', 2)], 'abc')).toBe(
      false,
    );
    expect(isApproved([r('CHANGES REQUESTED', 'abc', 1), r('APPROVE', 'abc', 2)], 'abc')).toBe(
      true,
    );
  });
  it('ignores other users and non-APPROVE bodies', () => {
    expect(isApproved([r('APPROVE', 'abc', 1, 'someone')], 'abc')).toBe(false);
    expect(isApproved([r('APPROVED-ish? no', 'abc', 1)], 'abc')).toBe(false);
    expect(isApproved([], 'abc')).toBe(false);
  });
  it('accepts paginated (slurped) input', () => {
    expect(isApproved([[r('APPROVE', 'abc', 1)], []], 'abc')).toBe(true);
  });
});
