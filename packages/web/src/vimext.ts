import { vim } from '@replit/codemirror-vim';
import { drawSelection } from '@codemirror/view';
import { vimScrollMargin } from './scrollmargin.js';

/**
 * Extensions active only while vim is on. drawSelection is needed for visual-mode
 * selections; it and the scroll margin stay off otherwise so the default (native)
 * caret/selection/scrolling is unchanged.
 */
export const vimExt = () => [vim(), drawSelection({ cursorBlinkRate: 0 }), vimScrollMargin];
