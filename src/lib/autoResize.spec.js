import { describe, expect, it } from 'vitest';
import { autoResizeTextarea, INPUT_HEIGHT_EMPTY, INPUT_HEIGHT_MAX } from './autoResize.js';

function fakeTextarea(scrollHeight) {
  const el = { scrollHeight, style: { height: '' } };
  return el;
}

describe('autoResizeTextarea', () => {
  it('sets a stable empty height when there is no text', () => {
    const el = fakeTextarea(0);
    autoResizeTextarea(el, '   ');
    expect(el.style.height).toBe(`${INPUT_HEIGHT_EMPTY}px`);
  });

  it('grows with content up to the max', () => {
    const el = fakeTextarea(150);
    autoResizeTextarea(el, 'hello');
    expect(el.style.height).toBe('150px');
  });

  it('clamps content taller than the max', () => {
    const el = fakeTextarea(999);
    autoResizeTextarea(el, 'hello');
    expect(el.style.height).toBe(`${INPUT_HEIGHT_MAX}px`);
  });
});
