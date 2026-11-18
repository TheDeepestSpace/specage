import { EditorView } from '@codemirror/view';

/** Lines kept visible above/below the cursor when scrolling in vim mode. */
export const SCROLL_MARGIN_LINES = 10;

/** Pixel margins for a given line height. */
export function marginPx(lineHeight: number): { top: number; bottom: number } {
  const m = SCROLL_MARGIN_LINES * lineHeight;
  return { top: m, bottom: m };
}

export const vimScrollMargin = EditorView.scrollMargins.of((view) =>
  marginPx(view.defaultLineHeight),
);
