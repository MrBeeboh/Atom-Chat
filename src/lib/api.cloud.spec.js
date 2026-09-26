import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import {
  configuredCloudModelIds,
  modelDisplayName,
  resolveChatRequestTarget,
  streamChatCompletion,
} from './api.js';
import {
  cerebrasApiKey,
  cloudApisAvailable,
  deepSeekApiKey,
  deepinfraApiKey,
  grokApiKey,
  openRouterApiKey,
} from './stores.js';

const KEYS = [
  'deepSeekApiKey',
  'grokApiKey',
  'cerebrasApiKey',
  'deepinfraApiKey',
  'openRouterApiKey',
];

function installMemoryStorage() {
  const mem = new Map();
  const storage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => {
      mem.set(k, String(v));
    },
    removeItem: (k) => {
      mem.delete(k);
    },
    clear: () => {
      mem.clear();
    },
  };
  globalThis.localStorage = storage;
  return storage;
}

beforeEach(() => {
  installMemoryStorage();
});

afterEach(() => {
  for (const key of KEYS) localStorage.removeItem(key);
});

describe('OpenRouter and Nous routing', () => {
  it('lists Nous models only after an OpenRouter key is saved', () => {
    expect(configuredCloudModelIds().some((id) => id.startsWith('openrouter:'))).toBe(false);
    localStorage.setItem('openRouterApiKey', ' sk-or-test ');
    const ids = configuredCloudModelIds();
    expect(ids).toEqual([
      'openrouter:nousresearch/hermes-3-llama-3.1-70b',
      'openrouter:nousresearch/hermes-3-llama-3.1-405b',
      'openrouter:nousresearch/hermes-4-405b',
    ]);
  });

  it('sends a selected Nous model to OpenRouter with the key and the full slug', () => {
    localStorage.setItem('openRouterApiKey', ' sk-or-test ');
    const route = resolveChatRequestTarget('openrouter:nousresearch/hermes-4-405b');
    expect(route.isCloud).toBe(true);
    expect(route.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(route.model).toBe('nousresearch/hermes-4-405b');
    expect(route.headers.Authorization).toBe('Bearer sk-or-test');
    expect(route.headers['X-Title']).toBe('Atom Chat');
    expect(modelDisplayName('openrouter:nousresearch/hermes-4-405b')).toBe(
      'OpenRouter: nousresearch/hermes-4-405b',
    );
  });

  it('does not attach the OpenRouter key when the settings slot is empty', () => {
    const route = resolveChatRequestTarget('openrouter:nousresearch/hermes-3-llama-3.1-70b');
    expect(route.headers.Authorization).toBeUndefined();
    expect(route.url).not.toContain('openrouter.ai');
    expect(route.model).toBe('nousresearch/hermes-3-llama-3.1-70b');
  });

  it('keeps DeepInfra and DeepSeek request targets on their own hosts', () => {
    localStorage.setItem('deepSeekApiKey', 'sk-ds');
    localStorage.setItem('deepinfraApiKey', 'di-key');
    const deepseek = resolveChatRequestTarget('deepseek:deepseek-chat');
    expect(deepseek.url).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(deepseek.model).toBe('deepseek-chat');
    expect(deepseek.headers.Authorization).toBe('Bearer sk-ds');
    const deepinfra = resolveChatRequestTarget('deepinfra:Qwen/Qwen2.5-7B-Instruct');
    expect(deepinfra.url).toBe('https://api.deepinfra.com/v1/openai/chat/completions');
    expect(deepinfra.model).toBe('Qwen/Qwen2.5-7B-Instruct');
    expect(deepinfra.headers.Authorization).toBe('Bearer di-key');
  });

  it('posts the Nous slug and streams reasoning plus the answer', async () => {
    localStorage.setItem('openRouterApiKey', 'sk-or-live');
    const calls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      calls.push({ url: String(url), opts });
      const body = [
        'data: {"choices":[{"delta":{"reasoning":"plan"}}]}',
        '',
        'data: {"choices":[{"delta":{"content":"answer"},"finish_reason":"stop"}]}',
        '',
        'data: [DONE]',
        '',
      ].join('\n');
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };
    try {
      let text = '';
      await streamChatCompletion({
        model: 'openrouter:nousresearch/hermes-4-405b',
        messages: [{ role: 'user', content: 'hi' }],
        onChunk: (chunk) => {
          text += chunk;
        },
      });
      expect(text).toBe('<think>plan</think>answer');
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe('https://openrouter.ai/api/v1/chat/completions');
      expect(calls[0].opts.headers.Authorization).toBe('Bearer sk-or-live');
      const posted = JSON.parse(calls[0].opts.body);
      expect(posted.model).toBe('nousresearch/hermes-4-405b');
      expect(posted.stream).toBe(true);
      expect(posted.top_k).toBeUndefined();
      expect(posted.repeat_penalty).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('treats the OpenRouter settings key as a cloud API', () => {
    deepSeekApiKey.set('');
    grokApiKey.set('');
    cerebrasApiKey.set('');
    deepinfraApiKey.set('');
    openRouterApiKey.set('');
    expect(get(cloudApisAvailable)).toBe(false);
    openRouterApiKey.set('sk-or-ui');
    expect(get(cloudApisAvailable)).toBe(true);
  });
});
