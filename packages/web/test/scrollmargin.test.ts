import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { SCROLL_MARGIN_LINES, marginPx, vimScrollMargin } from '../src/scrollmargin.js';
import { vimExt } from '../src/vimext.js';

describe('scroll margin', () => {
  it('keeps 10 lines above and below the cursor', () => {
    expect(SCROLL_MARGIN_LINES).toBe(10);
    expect(marginPx(20)).toEqual({ top: 200, bottom: 200 });
  });
});

describe('scroll margin wiring', () => {
  const margins = (exts: Extension) =>
    EditorState.create({ extensions: exts }).facet(EditorView.scrollMargins);

  it('is part of vimExt()', () => {
    expect(margins(vimExt())).toContain(vimScrollMargin.value);
  });

  it('is absent with vim off', () => {
    expect(margins([])).toHaveLength(0);
  });
});
