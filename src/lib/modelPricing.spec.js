import { describe, it, expect } from 'vitest';
import {
  indexLiteLLMTable,
  lookupCloudPrice,
  formatUsdPerMillion,
  formatPriceLine,
  isLocalModelId,
  parseAtomModelId,
} from './modelPricing.js';

const FIXTURE = {
  sample_spec: { input_cost_per_token: 0, output_cost_per_token: 0 },
  'deepseek/deepseek-chat': { input_cost_per_token: 2.8e-7, output_cost_per_token: 4.2e-7 },
  'xai/grok-4.3': { input_cost_per_token: 1.25e-6, output_cost_per_token: 2.5e-6 },
  'cerebras/llama-3.3-70b': { input_cost_per_token: 1e-7, output_cost_per_token: 1e-7 },
  'deepinfra/Qwen/Qwen2.5-7B-Instruct': { input_cost_per_token: 5e-8, output_cost_per_token: 1e-7 },
};

describe('modelPricing', () => {
  const index = indexLiteLLMTable(FIXTURE);

  it('skips sample_spec and converts per-token to per-million', () => {
    expect(index.sample_spec).toBeUndefined();
    expect(index['deepseek/deepseek-chat'].inPerM).toBeCloseTo(0.28, 5);
    expect(index['deepseek/deepseek-chat'].outPerM).toBeCloseTo(0.42, 5);
  });

  it('matches Atom cloud ids to the provider catalog row', () => {
    expect(lookupCloudPrice('deepseek:deepseek-chat', index)?.catalogId).toBe('deepseek/deepseek-chat');
    expect(lookupCloudPrice('grok:grok-4.3', index)?.catalogId).toBe('xai/grok-4.3');
    expect(lookupCloudPrice('cerebras:llama-3.3-70b', index)?.catalogId).toBe('cerebras/llama-3.3-70b');
    expect(lookupCloudPrice('deepinfra:Qwen/Qwen2.5-7B-Instruct', index)?.catalogId).toBe(
      'deepinfra/qwen/qwen2.5-7b-instruct',
    );
  });

  it('does not use another vendor’s row when the provider has no catalog price', () => {
    expect(lookupCloudPrice('cerebras:llama-4-scout-17b-16e-instruct', index)).toBeNull();
    expect(
      lookupCloudPrice('deepinfra:meta-llama/Llama-3.1-8B-Instruct', {
        ...index,
        'deepinfra/meta-llama/meta-llama-3.1-8b-instruct': { inPerM: 0.03, outPerM: 0.03 },
        'nscale/meta-llama/llama-3.1-8b-instruct': { inPerM: 9, outPerM: 9 },
      })?.catalogId,
    ).toBe('deepinfra/meta-llama/meta-llama-3.1-8b-instruct');
  });

  it('treats local / disk models as $0', () => {
    expect(isLocalModelId('llama-3.1-8b')).toBe(true);
    expect(isLocalModelId('/home/x/.lmstudio/models/a.gguf')).toBe(true);
    expect(isLocalModelId('grok:grok-4')).toBe(false);
    expect(parseAtomModelId('grok:grok-4')).toEqual({ provider: 'grok', part: 'grok-4' });
    expect(formatPriceLine('gemma.gguf', { rates: {} })).toBe('this device · $0');
  });

  it('formats compact USD /1M lines', () => {
    expect(formatUsdPerMillion(0)).toBe('$0');
    expect(formatUsdPerMillion(0.28)).toBe('$0.28');
    expect(formatUsdPerMillion(1.2)).toBe('$1.20');
    const line = formatPriceLine('deepseek:deepseek-chat', {
      rates: {
        'deepseek:deepseek-chat': { inPerM: 0.28, outPerM: 1.03, catalogId: 'deepseek/deepseek-chat' },
      },
    });
    expect(line).toBe('$0.28 in · $1.03 out /1M');
  });
});
