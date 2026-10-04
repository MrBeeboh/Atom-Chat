import { describe, it, expect } from 'vitest';
import {
  normalizeModelKey,
  isLocalAtomModel,
  openRouterMatchCandidates,
  buildOpenRouterIndex,
  matchOpenRouterModel,
  perTokenToPerMillion,
  formatUsdPerMillion,
  formatContextTokens,
  lookupPricing,
  formatPriceTriple,
  buildDeepInfraIndex,
  runningCostUsd,
  normalizeChatUsage,
  assistantStatsFromUsage,
  estimateCompletionTokens,
  readCachedTokenCount,
} from './modelPricing.js';

const sample = [
  {
    id: 'stealth/ox-alpha',
    context_length: 1048576,
    pricing: { prompt: '0', completion: '0' },
  },
  {
    id: 'tencent/hy3',
    context_length: 262144,
    pricing: { prompt: '0.000000132', completion: '0.000000528', input_cache_read: '0.000000033' },
  },
  {
    id: 'deepseek/deepseek-chat',
    context_length: 163840,
    pricing: { prompt: '0.0000002574', completion: '0.0000010287' },
  },
  {
    id: 'x-ai/grok-4.6',
    context_length: 500000,
    pricing: { prompt: '0.000002', completion: '0.000006', input_cache_read: '0.0000005' },
  },
];

describe('model pricing match', () => {
  const index = buildOpenRouterIndex(sample);

  it('treats GGUF and server ids as local $0', () => {
    expect(isLocalAtomModel('qwen3.gguf')).toBe(true);
    expect(isLocalAtomModel('/home/mike/models/a.gguf')).toBe(true);
    expect(isLocalAtomModel('deepseek:deepseek-chat')).toBe(false);
    const local = lookupPricing('/home/x/.lmstudio/models/a-q4_k_m.gguf', { index });
    expect(local.source).toBe('local');
    expect(formatPriceTriple(local)).toBe('In Free · Out Free · Cache Free');
  });

  it('maps ATOM cloud ids onto OpenRouter slugs', () => {
    expect(openRouterMatchCandidates('nous:stealth/ox-alpha')).toContain('stealth/ox-alpha');
    expect(openRouterMatchCandidates('deepseek:deepseek-chat')).toContain('deepseek/deepseek-chat');
    expect(openRouterMatchCandidates('grok:grok-4.6')).toContain('x-ai/grok-4.6');
    expect(matchOpenRouterModel('nous:stealth/ox-alpha', index)?.id).toBe('stealth/ox-alpha');
    expect(matchOpenRouterModel('deepseek:deepseek-chat', index)?.id).toBe('deepseek/deepseek-chat');
    expect(matchOpenRouterModel('grok:grok-4.6', index)?.id).toBe('x-ai/grok-4.6');
    expect(matchOpenRouterModel('nous:tencent/hy3', index)?.id).toBe('tencent/hy3');
  });

  it('formats $/1M and missing cache as em dash', () => {
    expect(perTokenToPerMillion('0.000000132')).toBeCloseTo(0.132, 6);
    expect(formatUsdPerMillion(0)).toBe('Free');
    expect(formatUsdPerMillion(0.132)).toBe('$0.132');
    expect(formatContextTokens(1048576)).toBe('1.0M ctx');
    expect(formatContextTokens(262144)).toBe('262K ctx');
    const hy3 = lookupPricing('nous:tencent/hy3', { index });
    expect(formatPriceTriple(hy3)).toBe('In $0.132 · Out $0.528 · Cache $0.033');
    const ds = lookupPricing('deepseek:deepseek-chat', { index });
    expect(formatPriceTriple(ds)).toContain('Cache —');
    expect(normalizeModelKey('DeepSeek/DeepSeek_Chat')).toBe('deepseek/deepseek-chat');
  });
});

import { sumAssistantUsage, runningCostUsd, formatRunningUsd, formatArenaUsageFooter } from './modelPricing.js';

describe('arena running cost', () => {
  it('sums prompt and completion tokens already on assistant stats', () => {
    const totals = sumAssistantUsage([
      { role: 'user', content: 'q' },
      { role: 'assistant', stats: { prompt_tokens: 100, completion_tokens: 40 } },
      { role: 'assistant', stats: { prompt_tokens: 20, completion_tokens: 5, estimated: true } },
    ]);
    expect(totals.prompt).toBe(120);
    expect(totals.completion).toBe(45);
    expect(totals.cached).toBe(0);
    expect(totals.total).toBe(165);
    expect(totals.estimated).toBe(true);
  });

  it('adds cached tokens beside in and out and does not fold cache into the total', () => {
    const totals = sumAssistantUsage([
      { role: 'assistant', stats: { prompt_tokens: 100, completion_tokens: 40, prompt_tokens_details: { cached_tokens: 80 } } },
      { role: 'assistant', stats: { prompt_tokens: 50, completion_tokens: 10, cached_tokens: 5 } },
      { role: 'assistant', stats: { prompt_tokens: 10, completion_tokens: 2, prompt_cache_hit_tokens: 4 } },
      { role: 'assistant', stats: { prompt_tokens: 7, completion_tokens: 1 } },
    ]);
    expect(totals.prompt).toBe(167);
    expect(totals.completion).toBe(53);
    expect(totals.cached).toBe(89);
    expect(totals.total).toBe(220);
    expect(formatArenaUsageFooter({
      ...totals,
      priceKnown: true,
      cost: 0,
      estimated: false,
    })).toBe('220 tok (in 167 · out 53 · cache 89) · $0.00');
    expect(formatArenaUsageFooter({
      prompt: 10,
      completion: 4,
      cached: 0,
      total: 14,
      estimated: true,
      priceKnown: false,
      cost: null,
    })).toBe('14 tok ~ (in 10 · out 4 · cache 0) · cost unknown');
  });

  it('prices from catalog rates and returns null when the price is unknown', () => {
    const priced = { source: 'openrouter', inPerM: 2, outPerM: 6 };
    expect(runningCostUsd(1_000_000, 500_000, priced)).toBeCloseTo(5, 6);
    expect(formatRunningUsd(runningCostUsd(1000, 400, priced))).toBe('$0.004400');
    expect(runningCostUsd(100, 40, { source: 'unknown', inPerM: null, outPerM: null })).toBeNull();
    expect(runningCostUsd(10, 10, { source: 'local', inPerM: 0, outPerM: 0 })).toBe(0);
    expect(formatRunningUsd(0)).toBe('$0.00');
  });
});

describe('deepinfra prices', () => {
  it('reads DeepInfra dollars per million and does not invent a missing id', () => {
    const deepinfra = buildDeepInfraIndex([
      {
        id: 'Qwen/Qwen3.8-Max',
        context_length: 256000,
        metadata: { pricing: { input_tokens: 1.6500000000000001, output_tokens: 4.951, cache_read_tokens: 0.206 } },
      },
    ]);
    const catalog = { index: null, deepinfra };
    const info = lookupPricing('deepinfra:Qwen/Qwen3.8-Max', catalog);
    expect(info.source).toBe('deepinfra');
    expect(info.inPerM).toBe(1.65);
    expect(info.outPerM).toBe(4.951);
    expect(runningCostUsd(3480, 28098, info)).toBeCloseTo(0.144855, 5);
    expect(lookupPricing('deepinfra:Missing/Model', catalog).source).toBe('unknown');
  });

  it('bills cached prompt tokens at the cache rate', () => {
    const deepinfra = buildDeepInfraIndex([
      {
        id: 'Qwen/Qwen3.8-Max',
        context_length: 256000,
        metadata: { pricing: { input_tokens: 1.65, output_tokens: 4.951, cache_read_tokens: 0.206 } },
      },
    ]);
    const info = lookupPricing('deepinfra:Qwen/Qwen3.8-Max', { index: null, deepinfra });
    expect(runningCostUsd(5000, 50, info, 4800)).toBeCloseTo(0.00156635, 8);
    expect(runningCostUsd(5000, 50, info, 0)).toBeCloseTo(0.00849755, 8);
  });
});

describe('normalizeChatUsage', () => {
  it('maps OpenAI, Grok, and DeepInfra field names onto prompt/completion/cache', () => {
    expect(normalizeChatUsage({ prompt_tokens: 10, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 8 } })).toMatchObject({
      prompt_tokens: 10,
      completion_tokens: 4,
      cached_tokens: 8,
    });
    expect(normalizeChatUsage({ input_tokens: 12, output_tokens: 3, input_tokens_details: { cached_tokens: 2 } })).toMatchObject({
      prompt_tokens: 12,
      completion_tokens: 3,
      cached_tokens: 2,
    });
    expect(normalizeChatUsage({})).toBeNull();
    expect(readCachedTokenCount({ input_tokens_details: { cached_tokens: 9 } })).toBe(9);
  });

  it('does not invent a token for an empty contestant reply', () => {
    expect(estimateCompletionTokens('')).toBe(0);
    expect(assistantStatsFromUsage(null, '')).toMatchObject({
      prompt_tokens: 0,
      completion_tokens: 0,
      estimated: true,
    });
    expect(assistantStatsFromUsage({ prompt_tokens: 3480, completion_tokens: 28098, prompt_tokens_details: { cached_tokens: 1200 } }, '')).toMatchObject({
      prompt_tokens: 3480,
      completion_tokens: 28098,
      cached_tokens: 1200,
      estimated: false,
    });
  });
});
