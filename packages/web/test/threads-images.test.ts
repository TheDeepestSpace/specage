import { describe, expect, it } from 'vitest';
import { MAX_IMAGE_BYTES, MAX_IMAGES } from '@specage/core/browser';
import { clipboardImages, imageProblem } from '../src/threads.js';

const file = (type: string) => ({ type }) as File;
const item = (kind: string, type: string) => ({ kind, type, getAsFile: () => file(type) });

describe('paste handling', () => {
  it('takes only image files; text paste is left alone', () => {
    expect(clipboardImages([item('string', 'text/plain')])).toEqual([]);
    expect(clipboardImages(undefined)).toEqual([]);
    const got = clipboardImages([
      item('file', 'image/png'),
      item('string', 'text/html'),
      item('file', 'image/gif'),
    ]);
    expect(got.map((f) => f.type)).toEqual(['image/png', 'image/gif']);
  });
  it('rejects wrong type, oversize and too many', () => {
    expect(imageProblem({ type: 'image/png', size: 10 }, 0)).toBeNull();
    expect(imageProblem({ type: 'image/svg+xml', size: 10 }, 0)).toMatch(/not allowed/);
    expect(imageProblem({ type: 'image/png', size: MAX_IMAGE_BYTES + 1 }, 0)).toMatch(/larger/);
    expect(imageProblem({ type: 'image/png', size: 1 }, MAX_IMAGES)).toMatch(/at most/);
  });
});
