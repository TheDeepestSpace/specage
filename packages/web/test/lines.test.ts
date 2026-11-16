import { describe, expect, it } from 'vitest';
import { analyse, statementLines } from '../src/analysis.js';

const lines = (t: string) => {
  const m = statementLines(analyse(t));
  return [...m].sort((x, y) => x[0] - y[0]).map(([l, n]) => `${l}:${n.id}`);
};

describe('statementLines', () => {
  it('tints every line of a multi-line leaf', () => {
    expect(lines('@a one \\\n two \\\n three;\n')).toEqual(['1:a', '2:a', '3:a']);
  });
  it('scope: header through { and the } line only; children get their own', () => {
    const t = '@blk head\n  more {\n  @a one;\n\n  # note\n  @b two\n}\n';
    expect(lines(t)).toEqual(['1:blk', '2:blk', '3:a', '6:b', '7:blk']);
  });
  it('single-line scope', () => {
    expect(lines('@blk { @a one; @b two }\n')).toEqual(['1:blk']);
  });
});

import { statementLastLines } from '../src/analysis.js';
describe('statementLastLines', () => {
  const last = (t: string) =>
    [...statementLastLines(analyse(t))].map(([n, l]) => `${n.id}:${l}`).sort();
  it('multi-line leaf: last own line, not trailing blank', () => {
    expect(last('@a one \\\n two \\\n three;\n\n')).toEqual(['a:3']);
  });
  it('single-line unchanged', () => {
    expect(last('@a one;\n@b two;\n')).toEqual(['a:1', 'b:2']);
  });
  it('scope: closing-brace line', () => {
    expect(last('@blk head\n  more {\n  @a one;\n}\n')).toEqual(['a:3', 'blk:4']);
  });
});
