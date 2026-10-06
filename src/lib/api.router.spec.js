import { describe, expect, it } from 'vitest';
import { openaiChatCompletionsUrl, decodeTokPerSec, isLlamaRouterModelsPayload, localChatModelIdForRequest, openaiChatStreamOptions, clampChatMaxTokens, firstTokenBudgetMs, messagesContainImages } from './api.js';

describe('isLlamaRouterModelsPayload', () => {
  it('recognizes a router: rows carry a status object', () => {
    expect(
      isLlamaRouterModelsPayload({
        data: [{ id: 'Qwen3.8-27B-Q4_K_M', status: { value: 'unloaded', args: [] } }],
      }),
    ).toBe(true);
  });

  it('recognizes a router: rows carry a status string', () => {
    expect(isLlamaRouterModelsPayload({ data: [{ id: 'm', status: 'loaded' }] })).toBe(true);
  });

  it('rejects a single-model llama-server (rows have no status, no /models/load)', () => {
    // Shape returned by the Flash-Next container on :8081
    expect(
      isLlamaRouterModelsPayload({
        models: [{ name: 'Qwen3.8-Flash-Next', model: 'Qwen3.8-Flash-Next', type: 'model' }],
        object: 'list',
        data: [{ id: 'Qwen3.8-Flash-Next', object: 'model', owned_by: 'llamacpp', meta: { n_ctx: 262144 } }],
      }),
    ).toBe(false);
  });

  it('keeps assuming a router when the list is empty (cannot tell)', () => {
    expect(isLlamaRouterModelsPayload({ data: [] })).toBe(true);
    expect(isLlamaRouterModelsPayload(null)).toBe(true);
  });
});

describe('openaiChatCompletionsUrl', () => {
  it('uses /v1/chat/completions for llama.cpp base URLs', () => {
    expect(openaiChatCompletionsUrl('http://localhost:8080', 'Qwen3.8-9B-Distill-Q6_K')).toBe(
      'http://localhost:8080/v1/chat/completions',
    );
    expect(openaiChatCompletionsUrl('/api/llama', 'foo')).toBe('/api/llama/v1/chat/completions');
  });

  it('adds ?autoload=true for the llama router fast path', () => {
    expect(
      openaiChatCompletionsUrl('http://localhost:8080', 'Qwen3.8-9B-Distill-Q6_K', {
        routerAutoload: true,
      }),
    ).toBe('http://localhost:8080/v1/chat/completions?autoload=true');
  });

  it('does not tack autoload onto DeepInfra URLs', () => {
    expect(
      openaiChatCompletionsUrl('https://api.deepinfra.com/v1/openai', 'deepinfra:black-forest-labs/FLUX-1-schnell', {
        routerAutoload: true,
      }),
    ).toBe('https://api.deepinfra.com/v1/openai/chat/completions');
  });

  it('repairs a trailing dot or glued .v1 so the port stays numeric', () => {
    expect(openaiChatCompletionsUrl('http://localhost:8081.', 'other')).toBe(
      'http://localhost:8081/v1/chat/completions',
    );
    expect(openaiChatCompletionsUrl('http://localhost:8081.v1', 'other')).toBe(
      'http://localhost:8081/v1/chat/completions',
    );
    expect(openaiChatCompletionsUrl('http://localhost:8081.v1/v1', 'other')).toBe(
      'http://localhost:8081/v1/chat/completions',
    );
  });

  it('sends Flash-Next chat to the :8081 server, not the :8080 router', () => {
    const shard = '/home/mike/models/by-model/qwen3.8-flash-next/QWEN3.8-FLASH-NEXT-UD-Q3_K_XL-00001-OF-00003.GGUF';
    expect(
      openaiChatCompletionsUrl('http://localhost:8081.', shard, { routerAutoload: true }),
    ).toBe('http://127.0.0.1:8081/v1/chat/completions');
    expect(openaiChatCompletionsUrl('http://localhost:8081.v1', 'Qwen3.8-Flash-Next')).toBe(
      'http://127.0.0.1:8081/v1/chat/completions',
    );
    expect(localChatModelIdForRequest(shard, shard.split('/').pop())).toBe('Qwen3.8-Flash-Next');
  });
});

describe('decodeTokPerSec', () => {
  it('prefers llama.cpp predicted_per_second over wall-clock math', () => {
    expect(
      decodeTokPerSec({
        timings: { predicted_per_second: 53.6 },
        completionTokens: 200,
        elapsedMs: 60000,
      }),
    ).toBe(53.6);
  });

  it('falls back to decodeMs so load time is not counted', () => {
    expect(
      decodeTokPerSec({
        completionTokens: 100,
        decodeMs: 2000,
        elapsedMs: 40000,
      }),
    ).toBe(50);
  });
});

describe('clampChatMaxTokens', () => {
  it('rejects 0 / -1 so llama.cpp does not treat them as unlimited', () => {
    expect(clampChatMaxTokens(0, { cloud: false })).toBe(4096);
    expect(clampChatMaxTokens(-1, { cloud: false })).toBe(4096);
    expect(clampChatMaxTokens(undefined, { cloud: true })).toBe(4096);
    expect(clampChatMaxTokens(20000, { cloud: true })).toBe(8192);
    expect(clampChatMaxTokens(8000, { cloud: false })).toBe(8000);
  });
});

describe('openaiChatStreamOptions', () => {
  it('asks every OpenAI-compatible provider for usage, and DeepInfra for live usage', () => {
    expect(openaiChatStreamOptions('Qwen3.8-9B')).toEqual({ include_usage: true });
    expect(openaiChatStreamOptions('deepseek:deepseek-chat')).toEqual({ include_usage: true });
    expect(openaiChatStreamOptions('nous:qwen')).toEqual({ include_usage: true });
    expect(openaiChatStreamOptions('deepinfra:Qwen/Qwen3.8-Max')).toEqual({
      include_usage: true,
      continuous_usage_stats: true,
    });
  });
});

describe('firstTokenBudgetMs', () => {
  it('gives Flash-Next longer budgets so healthy decode is not aborted', () => {
    expect(firstTokenBudgetMs('Qwen3.8-Flash-Next', [{ role: 'user', content: 'hi' }])).toBe(90000);
    expect(
      firstTokenBudgetMs('Qwen3.8-Flash-Next', [
        { role: 'user', content: [{ type: 'text', text: 'see' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,xx' } }] },
      ]),
    ).toBe(120000);
    expect(messagesContainImages([{ role: 'user', content: 'hi' }])).toBe(false);
  });
});
