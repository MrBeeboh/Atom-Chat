import { describe, expect, it } from 'vitest';
import { splitThinkingAndAnswer } from './markdown.js';

describe('splitThinkingAndAnswer', () => {
  it('shows live thinking before the closing think tag arrives', () => {
    const parts = splitThinkingAndAnswer('<think>\nThe capital is\n');
    expect(parts).toHaveLength(1);
    expect(parts[0].type).toBe('thinking');
    expect(parts[0].html).toMatch(/capital/i);
  });

  it('still splits a closed think block from the answer', () => {
    const parts = splitThinkingAndAnswer('<think>plan</think>\nParis.');
    expect(parts.map((p) => p.type)).toEqual(['thinking', 'answer']);
  });
});
