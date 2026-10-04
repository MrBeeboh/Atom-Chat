import { describe, expect, it, vi } from 'vitest';
import { parseChatApiError } from './chatErrorUtils.js';
import {
  modelDisplayName,
  modelSelectorPrimaryLine,
  modelSelectorSecondaryLine,
  mergeServerAndDiskModels,
  isGrokModel,
  isDeepSeekModel,
  isDeepinfraModel,
} from './modelIdUtils.js';
import { normalizeLocalLmBaseUrl, joinUrl } from './apiConfig.js';
import { modelIdsLooselyMatch } from './llamaRouter.js';
import { parseGrokResponseOutput } from './grok.js';
import { fetchWithTimeout } from './fetchWithTimeout.js';

describe('parseChatApiError', () => {
  it('maps 401 with an invalid-key body to a key hint', () => {
    const msg = parseChatApiError(401, JSON.stringify({ error: { message: 'Invalid API key', code: 'invalid_api_key' } }), 'grok:grok-4');
    expect(msg).toContain('Invalid API key');
    expect(msg).toContain('Cloud APIs');
  });

  it('keeps a bare 401 without a key clue generic', () => {
    const msg = parseChatApiError(401, '', 'local-model');
    expect(msg).toBe('Authentication failed.');
  });

  it('returns the rate-limit code message verbatim', () => {
    expect(parseChatApiError(429, JSON.stringify({ error: { code: 'rate_limit_exceeded' } }))).toBe(
      'Too many requests. Please wait a moment and try again.',
    );
  });

  it('surfaces context-length overflow as a friendly local hint', () => {
    const msg = parseChatApiError(400, JSON.stringify({ error: { code: 'context_length_exceeded' } }), 'local-model');
    expect(msg).toContain('longer than the local model window');
  });

  it('surfaces the parsed message for 5xx, else a server-error summary', () => {
    expect(parseChatApiError(500, '{"error":{"message":"boom"}}', 'deepseek:chat')).toBe('boom');
    expect(parseChatApiError(500, '{}', 'deepseek:chat')).toContain('The API server had an error (500)');
  });
});

describe('model id display helpers', () => {
  it('modelDisplayName splits a provider:model id', () => {
    expect(modelDisplayName('deepseek:deepseek-chat')).toMatch(/^.+: deepseek-chat$/);
    expect(modelDisplayName('local-model')).toBe('local-model');
  });

  it('modelDisplayName annotates a .gguf path with its basename', () => {
    expect(modelDisplayName('/home/mike/models/foo.gguf')).toBe('foo.gguf  —  /home/mike/models/foo.gguf');
  });

  it('modelSelectorPrimaryLine strips the provider and the folder', () => {
    expect(modelSelectorPrimaryLine('deepseek:deepseek-chat')).toBe('deepseek-chat');
    expect(modelSelectorPrimaryLine('/a/b/model.gguf')).toBe('model.gguf');
    expect(modelSelectorPrimaryLine('plain')).toBe('plain');
  });

  it('modelSelectorSecondaryLine returns the folder only for disk .gguf paths', () => {
    expect(modelSelectorSecondaryLine('/a/b/model.gguf')).toBe('/a/b');
    expect(modelSelectorSecondaryLine('deepseek:chat')).toBeNull();
    expect(modelSelectorSecondaryLine('plain')).toBeNull();
  });
});

describe('normalizeLocalLmBaseUrl / joinUrl', () => {
  it('repairs trailing dots and glued .v1 so the port stays numeric', () => {
    expect(normalizeLocalLmBaseUrl('http://localhost:8081.')).toBe('http://localhost:8081');
    expect(normalizeLocalLmBaseUrl('http://localhost:8081.v1')).toBe('http://localhost:8081');
    expect(normalizeLocalLmBaseUrl('http://localhost:8081.v1/v1')).toBe('http://localhost:8081');
    expect(normalizeLocalLmBaseUrl('http://localhost:8080/v1')).toBe('http://localhost:8080');
    expect(normalizeLocalLmBaseUrl('http://localhost:8080/')).toBe('http://localhost:8080');
  });

  it('joinUrl joins with exactly one slash', () => {
    expect(joinUrl('http://localhost:8080/', 'v1/chat')).toBe('http://localhost:8080/v1/chat');
    expect(joinUrl('http://localhost:8080', '/v1/chat')).toBe('http://localhost:8080/v1/chat');
    expect(joinUrl('', 'x')).toBe('/x');
  });
});

describe('modelIdsLooselyMatch', () => {
  it('matches exact ids and path suffix aliases', () => {
    expect(modelIdsLooselyMatch('Qwen3.8', 'Qwen3.8')).toBe(true);
    expect(modelIdsLooselyMatch('/a/b/model.gguf', 'model')).toBe(true);
    expect(modelIdsLooselyMatch('/a/b/model.gguf', '/a/b/model.gguf')).toBe(true);
    expect(modelIdsLooselyMatch('foo', 'bar')).toBe(false);
  });
});

describe('model id predicates', () => {
  it('classifies provider:model ids', () => {
    expect(isGrokModel('grok:grok-4')).toBe(true);
    expect(isGrokModel('grok-4')).toBe(false);
    expect(isDeepSeekModel('deepseek:deepseek-chat')).toBe(true);
    expect(isDeepinfraModel('deepinfra:Qwen/Qwen3.8-Max')).toBe(true);
    expect(isDeepSeekModel('grok:grok-4')).toBe(false);
  });
});

describe('mergeServerAndDiskModels', () => {
  it('keeps server order and skips disk copies whose basename is already served', () => {
    const merged = mergeServerAndDiskModels(
      [{ id: '/mnt/server/Qwen3.8.gguf' }],
      [{ id: '/home/mike/models/Qwen3.8.gguf' }, { id: '/home/mike/models/other.gguf' }],
    );
    expect(merged.map((m) => m.id)).toEqual(['/mnt/server/Qwen3.8.gguf', '/home/mike/models/other.gguf']);
  });
});

describe('parseGrokResponseOutput', () => {
  it('reads choices[0].message.content first', () => {
    expect(parseGrokResponseOutput({ choices: [{ message: { content: 'hi' } }] })).toBe('hi');
  });

  it('concatenates output_text parts from the output array', () => {
    expect(
      parseGrokResponseOutput({
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'a' }, { type: 'output_text', text: 'b' }] }],
      }),
    ).toBe('ab');
  });

  it('returns empty for an empty output', () => {
    expect(parseGrokResponseOutput({ output: [] })).toBe('');
  });
});

describe('fetchWithTimeout', () => {
  it('returns the fetch result on success', async () => {
    const mock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', mock);
    const res = await fetchWithTimeout('http://example.com', {}, 1000);
    expect(res.ok).toBe(true);
    expect(mock).toHaveBeenCalledWith('http://example.com', expect.objectContaining({ signal: expect.anything() }));
    vi.unstubAllGlobals();
  });

  it('aborts the request when the timeout elapses', async () => {
    const mock = vi.fn((url, opts) => new Promise((_resolve, reject) => {
      opts.signal.addEventListener('abort', () => {
        const e = new Error('aborted');
        e.name = 'AbortError';
        reject(e);
      });
    }));
    vi.stubGlobal('fetch', mock);
    await expect(fetchWithTimeout('http://example.com', {}, 10)).rejects.toMatchObject({ name: 'AbortError' });
    vi.unstubAllGlobals();
  });
});
