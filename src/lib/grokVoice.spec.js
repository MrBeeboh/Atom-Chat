import { describe, it, expect } from 'vitest';
import { buildRoleplayInstructions, XAI_VOICES } from './grokVoice.js';

describe('grokVoice', () => {
  it('buildRoleplayInstructions merges base prompt and scenario', () => {
    const out = buildRoleplayInstructions('You are a pirate.', 'The user is your first mate.');
    expect(out).toContain('You are a pirate.');
    expect(out).toContain('The user is your first mate.');
    expect(out).toContain('spoken dialogue');
  });

  it('exports Eve as a voice option', () => {
    expect(XAI_VOICES.some((v) => v.id === 'eve')).toBe(true);
  });
});
