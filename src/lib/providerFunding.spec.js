import { describe, it, expect, beforeEach } from 'vitest';
import {
  decideFunded,
  fundingProbe,
  isArenaModelEligible,
  resetProviderFundingSession,
  setStartupFunding,
} from './providerFunding.js';

describe('fundingProbe', () => {
  it('uses one models inquiry for every provider', () => {
    expect(fundingProbe('deepseek', { dev: false }).url).toBe('https://api.deepseek.com/v1/models');
    expect(fundingProbe('deepinfra', { dev: true }).url).toBe('/api/deepinfra/v1/openai/models');
    expect(fundingProbe('grok', { dev: false }).url).toBe('https://api.x.ai/v1/models');
    expect(fundingProbe('cerebras', { dev: false }).url).toBe('https://api.cerebras.ai/v1/models');
    expect(fundingProbe('nous', { dev: false }).url).toBe('https://inference-api.nousresearch.com/v1/models');
    for (const id of ['deepseek', 'deepinfra', 'grok', 'cerebras', 'nous']) {
      expect(fundingProbe(id, { dev: true, modelsUrl: `/api/${id}/models` }).kind).toBe('models');
    }
  });
});

describe('decideFunded', () => {
  it('treats DeepSeek is_available as the funding signal', () => {
    expect(decideFunded('deepseek', { status: 200, body: { is_available: true } }).funded).toBe(true);
    expect(decideFunded('deepseek', { status: 200, body: { is_available: false, balance_infos: [] } }).funded).toBe(false);
    expect(decideFunded('deepseek', { status: 200, body: {} }).funded).toBe(false);
  });

  it('reads DeepInfra prepaid balance, credits, suspension, and an empty account', () => {
    expect(decideFunded('deepinfra', { status: 200, body: { stripe_balance: -12.5, recent: 1, limit: null, suspend_reason: null, billing_type: 'prepaid' }, bodyText: '{"billing_type":"prepaid"}' }).funded).toBe(true);
    expect(decideFunded('deepinfra', { status: 200, body: { stripe_balance: 0, recent: 0, limit: 50, suspend_reason: null, suspended: false } }).reason).toBe('spending-limit');
    expect(decideFunded('deepinfra', {
      status: 200,
      body: { stripe_balance: 0, recent: 0, limit: null, suspend_reason: null, scoped_credits: [{ remaining_cents: 250, expired: false }] },
    }).funded).toBe(true);
    expect(decideFunded('deepinfra', { status: 200, body: { stripe_balance: 4, recent: 4, limit: null, suspend_reason: 'balance', suspended: true } }).funded).toBe(false);
    expect(decideFunded('deepinfra', { status: 200, body: { stripe_balance: 0, recent: 0, limit: null, suspend_reason: null } }).funded).toBe(false);
  });

  it('counts auth failure, billing failure, and timeout as not funded', () => {
    expect(decideFunded('grok', { status: 401, bodyText: 'unauthorized' }).reason).toBe('auth');
    expect(decideFunded('cerebras', { status: 403 }).funded).toBe(false);
    expect(decideFunded('nous', { status: 402, bodyText: 'insufficient credits' }).reason).toBe('billing');
    expect(decideFunded('grok', { timedOut: true, status: 0 }).reason).toBe('timeout');
    expect(decideFunded('cerebras', { status: 0 }).reason).toBe('network');
  });

  it('accepts a models list only when the request succeeded', () => {
    expect(decideFunded('grok', { status: 200, body: { data: [{ id: 'grok-4.6' }] } })).toEqual({ funded: true, reason: 'models-ok' });
    expect(decideFunded('nous', { status: 500, bodyText: 'down' }).funded).toBe(false);
  });
});

describe('isArenaModelEligible', () => {
  beforeEach(() => resetProviderFundingSession());

  it('leaves local models eligible and drops an unfunded cloud provider', () => {
    setStartupFunding({ deepinfra: false, grok: true, nous: false, deepseek: false, cerebras: true }, ['nous', 'deepseek', 'grok', 'cerebras', 'deepinfra']);
    expect(isArenaModelEligible('Qwen3.8-Flash-Next')).toBe(true);
    expect(isArenaModelEligible('/home/mike/models/library/foo.gguf')).toBe(true);
    expect(isArenaModelEligible('deepinfra:google/gemma-3-4b-it')).toBe(false);
    expect(isArenaModelEligible('grok:grok-4.6')).toBe(true);
  });

  it('does not treat a path colon as a cloud provider', () => {
    setStartupFunding({}, ['nous', 'deepseek', 'grok', 'cerebras', 'deepinfra']);
    expect(isArenaModelEligible('C:/models/local.gguf')).toBe(true);
  });
});
