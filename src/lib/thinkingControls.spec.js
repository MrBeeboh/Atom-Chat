import { describe, expect, it } from 'vitest';
import {
  applyThinkingToChatBody,
  applyThinkingToGrokBody,
  getThinkingProfile,
  resolveThinkingChoice,
} from './thinkingControls.js';

describe('getThinkingProfile', () => {
  it('exposes Qwen3.8 low/medium/xhigh plus a speed cap', () => {
    const p = getThinkingProfile('Qwen3.8-27B-Q4_K_M');
    expect(p.kind).toBe('qwen38');
    expect(p.thinkingLevels).toEqual(['off', 'low', 'medium', 'xhigh']);
    expect(p.speedLevels.length).toBe(3);
    expect(p.defaultThinking).toBe('medium');
  });

  it('hides knobs on Grok image models', () => {
    expect(getThinkingProfile('grok:grok-imagine-image').thinkingLevels).toEqual([]);
  });

  it('exposes Grok reasoning effort', () => {
    const p = getThinkingProfile('grok:grok-4.6');
    expect(p.kind).toBe('grok');
    expect(p.thinkingLevels).toContain('low');
    expect(p.speedLevels).toEqual([]);
  });

  it('leaves Mistral without thinking knobs', () => {
    expect(getThinkingProfile('Mistral-Small-24B').thinkingLevels).toEqual([]);
  });
});

describe('applyThinkingToChatBody', () => {
  it('turns Qwen3.8 thinking off with template kwargs and a zero budget', () => {
    const body = applyThinkingToChatBody(
      {},
      { model: 'Qwen3.8-27B-Q4_K_M', options: { thinking: 'off' }, local: true },
    );
    expect(body.chat_template_kwargs.enable_thinking).toBe(false);
    expect(body.reasoning_effort).toBe('none');
    expect(body.reasoning_budget_tokens).toBe(0);
  });

  it('maps high to xhigh so the Qwen3.8 template does not throw', () => {
    const choice = resolveThinkingChoice('Qwen3.8-27B-Q4_K_M', { thinking: 'high' });
    expect(choice.thinking).toBe('xhigh');
    const body = applyThinkingToChatBody(
      {},
      { model: 'Qwen3.8-27B-Q4_K_M', options: { thinking: 'high', thinking_speed: 'fast' }, local: true },
    );
    expect(body.chat_template_kwargs.enable_thinking).toBe(true);
    expect(body.chat_template_kwargs.reasoning_effort).toBe('xhigh');
    expect(body.reasoning_budget_tokens).toBe(256);
  });

  it('honors disable_thinking for Arena JSON jobs', () => {
    const body = applyThinkingToChatBody(
      {},
      { model: 'Qwen3.8-27B-Q4_K_M', options: { thinking: 'xhigh', disable_thinking: true }, local: true },
    );
    expect(body.chat_template_kwargs.enable_thinking).toBe(false);
    expect(body.reasoning_budget_tokens).toBe(0);
  });

  it('sends DeepSeek thinking type', () => {
    const body = applyThinkingToChatBody(
      {},
      { model: 'deepseek:deepseek-chat', options: { thinking: 'on' } },
    );
    expect(body.thinking).toEqual({ type: 'enabled' });
  });
});

describe('applyThinkingToGrokBody', () => {
  it('sets reasoning effort none when thinking is off', () => {
    const body = applyThinkingToGrokBody(
      {},
      { model: 'grok:grok-4.6', options: { thinking: 'off' } },
    );
    expect(body.reasoning).toEqual({ effort: 'none' });
  });
});
