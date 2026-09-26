import { describe, it, expect } from 'vitest';
import { groupModelsForSelector } from './modelGroups.js';

describe('groupModelsForSelector', () => {
  it('orders This device, LM Studio disk, then cloud', () => {
    const g = groupModelsForSelector([
      { id: 'deepseek:deepseek-chat' },
      { id: '/home/x/.lmstudio/models/lmstudio-community/a.gguf' },
      { id: 'gemma-q4.gguf' },
    ]);
    const buckets = g.map((x) => x.bucket);
    expect(buckets.indexOf('local:server')).toBeLessThan(buckets.indexOf('disk:lmstudio'));
    expect(buckets.indexOf('disk:lmstudio')).toBeLessThan(buckets.indexOf('cloud:deepseek'));
  });

  it('puts non-lmstudio absolute gguf in Local disk', () => {
    const g = groupModelsForSelector([{ id: '/opt/models/z.gguf' }]);
    expect(g.some((x) => x.bucket === 'disk:other')).toBe(true);
  });

  it('groups Nous models under OpenRouter after the other cloud providers', () => {
    const g = groupModelsForSelector([
      { id: 'openrouter:nousresearch/hermes-4-405b' },
      { id: 'deepseek:deepseek-chat' },
    ]);
    const openrouter = g.find((x) => x.bucket === 'cloud:openrouter');
    expect(openrouter?.title).toBe('OpenRouter');
    expect(openrouter?.items.map((m) => m.id)).toContain('openrouter:nousresearch/hermes-4-405b');
    const buckets = g.map((x) => x.bucket);
    expect(buckets.indexOf('cloud:deepseek')).toBeLessThan(buckets.indexOf('cloud:openrouter'));
  });
});
