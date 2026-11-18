import { describe, expect, it } from 'vitest';
import { SCROLL_MARGIN_LINES, marginPx } from '../src/scrollmargin.js';

describe('scroll margin', () => {
  it('keeps 10 lines above and below the cursor', () => {
    expect(SCROLL_MARGIN_LINES).toBe(10);
    expect(marginPx(20)).toEqual({ top: 200, bottom: 200 });
  });
});
