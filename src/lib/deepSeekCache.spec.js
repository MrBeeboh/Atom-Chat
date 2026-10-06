import { describe, expect, it, beforeEach } from 'vitest';
import {
  extractDeepSeekCacheUsage,
  recordDeepSeekCacheUsage,
  resetDeepSeekCacheLog,
  summarizeDeepSeekCacheLog,
  buildChatApiMessages,
  followUpPrefixHits,
  messagesShareExactPrefix,
} from './deepSeekCache.js';

const SYSTEM = 'You are a helpful assistant.';
const USER1 = { role: 'user', content: 'What is the capital of China?' };
const ASSISTANT_FULL = {
  role: 'assistant',
  content: '<think>Beijing is the capital.</think>\nThe capital of China is Beijing.',
};
const USER2 = { role: 'user', content: 'And of France?' };

function fixtureHistory() {
  return [USER1, ASSISTANT_FULL, USER2];
}

describe('extractDeepSeekCacheUsage', () => {
  it('reads documented DeepSeek fields', () => {
    const u = extractDeepSeekCacheUsage({
      prompt_tokens: 120,
      prompt_cache_hit_tokens: 96,
      prompt_cache_miss_tokens: 24,
    });
    expect(u.hit).toBe(96);
    expect(u.miss).toBe(24);
    expect(u.fieldNames).toContain('prompt_cache_hit_tokens');
    expect(u.fieldNames).toContain('prompt_cache_miss_tokens');
  });

  it('accepts OpenAI cached_tokens and derives miss from prompt_tokens', () => {
    const u = extractDeepSeekCacheUsage({ prompt_tokens: 100, cached_tokens: 80 });
    expect(u.hit).toBe(80);
    expect(u.miss).toBe(20);
  });
});

describe('DeepSeek prefix fixtures (same conversation, before/after stripThinking)', () => {
  const turn1 = buildChatApiMessages({
    msgs: [USER1],
    systemPrompt: SYSTEM,
    stripAssistantThinking: false,
  });

  it('turn 1 has no prior prefix to hit (cold)', () => {
    expect(turn1[0]).toEqual({ role: 'system', content: SYSTEM });
    expect(messagesShareExactPrefix(turn1, turn1)).toBe(true);
  });

  it('BEFORE: stripping assistant <think> breaks the cached prefix', () => {
    const turn2Broken = buildChatApiMessages({
      msgs: fixtureHistory(),
      systemPrompt: SYSTEM,
      stripAssistantThinking: true,
    });
    const hit = followUpPrefixHits(turn1, ASSISTANT_FULL, turn2Broken);
    expect(hit).toBe(false);
    expect(turn2Broken.find((m) => m.role === 'assistant')?.content).not.toContain('<think>');
  });

  it('AFTER: keeping assistant thinking reuses the exact prefix', () => {
    const turn2Fixed = buildChatApiMessages({
      msgs: fixtureHistory(),
      systemPrompt: SYSTEM,
      stripAssistantThinking: false,
    });
    const hit = followUpPrefixHits(turn1, ASSISTANT_FULL, turn2Fixed);
    expect(hit).toBe(true);
  });

  it('before/after hit-rate table on the same two-turn fixture', () => {
    const turn2Before = buildChatApiMessages({
      msgs: fixtureHistory(),
      systemPrompt: SYSTEM,
      stripAssistantThinking: true,
    });
    const turn2After = buildChatApiMessages({
      msgs: fixtureHistory(),
      systemPrompt: SYSTEM,
      stripAssistantThinking: false,
    });
    const beforeHit = followUpPrefixHits(turn1, ASSISTANT_FULL, turn2Before) ? 1 : 0;
    const afterHit = followUpPrefixHits(turn1, ASSISTANT_FULL, turn2After) ? 1 : 0;
    // One follow-up call: avoidable miss vs hit. Turn 1 is always a cold miss (not counted here).
    expect({ before: beforeHit, after: afterHit }).toEqual({ before: 0, after: 1 });
  });

  it('treats a dropped early user turn as an expected sliding-window miss', () => {
    const full = buildChatApiMessages({
      msgs: fixtureHistory(),
      systemPrompt: SYSTEM,
      stripAssistantThinking: false,
    });
    const windowed = buildChatApiMessages({
      msgs: [ASSISTANT_FULL, USER2],
      systemPrompt: SYSTEM,
      stripAssistantThinking: false,
    });
    expect(messagesShareExactPrefix(full.slice(0, 3), windowed)).toBe(false);
  });
});

describe('recordDeepSeekCacheUsage', () => {
  beforeEach(() => resetDeepSeekCacheLog());

  it('aggregates hit rate from final usage objects', () => {
    recordDeepSeekCacheUsage(
      { prompt_tokens: 100, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 100 },
      { site: 'chat', model: 'deepseek:deepseek-chat' },
    );
    recordDeepSeekCacheUsage(
      { prompt_tokens: 140, prompt_cache_hit_tokens: 100, prompt_cache_miss_tokens: 40 },
      { site: 'chat', model: 'deepseek:deepseek-chat' },
    );
    const sum = summarizeDeepSeekCacheLog();
    expect(sum.calls).toBe(2);
    expect(sum.hit).toBe(100);
    expect(sum.miss).toBe(140);
    expect(sum.rate).toBeCloseTo(100 / 240);
  });
});
