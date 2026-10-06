import { describe, it, expect } from 'vitest';
import {
  parseOpenAIModelsList,
  mergeLiveAndFallback,
  isSelectableCloudModel,
  getModelTypeTag,
  inferCloudTypeTag,
  CLOUD_PROVIDERS,
  resetStartupFundingCheckForTests,
} from './cloudCatalog.js';
import { resetProviderFundingSession } from './providerFunding.js';
import { mergeServerAndDiskModels } from './api.js';

describe('parseOpenAIModelsList', () => {
  it('reads data[], models[], and a top-level array', () => {
    expect(parseOpenAIModelsList({ data: [{ id: 'grok-4.6' }, { id: 'grok-4.6' }] })).toEqual(['grok-4.6']);
    expect(parseOpenAIModelsList({ models: [{ name: 'deepseek-v4-pro' }] })).toEqual(['deepseek-v4-pro']);
    expect(parseOpenAIModelsList(['a', 'b'])).toEqual(['a', 'b']);
  });
});

describe('mergeLiveAndFallback', () => {
  it('keeps live order and appends missing fallback ids', () => {
    expect(mergeLiveAndFallback(['grok-4.6', 'grok-4.5'], ['grok-4.6', 'grok-4.3'])).toEqual([
      'grok-4.6',
      'grok-4.5',
      'grok-4.3',
    ]);
  });
});

describe('isSelectableCloudModel', () => {
  it('drops embeddings and whisper, keeps chat and imagine', () => {
    expect(isSelectableCloudModel('text-embedding-3-small')).toBe(false);
    expect(isSelectableCloudModel('whisper-1')).toBe(false);
    expect(isSelectableCloudModel('grok-4.6')).toBe(true);
    expect(isSelectableCloudModel('grok-imagine-image')).toBe(true);
    expect(isSelectableCloudModel('deepseek-v4-flash')).toBe(true);
  });
});

describe('getModelTypeTag', () => {
  it('tags current Grok and DeepSeek ids', () => {
    expect(getModelTypeTag('grok:grok-4.6')).toBe('Flagship');
    expect(getModelTypeTag('grok:grok-4.20-0309-reasoning')).toBe('Reasoning');
    expect(getModelTypeTag('deepseek:deepseek-v4-flash')).toBe('Fast');
    expect(getModelTypeTag('deepseek:deepseek-v4-pro')).toBe('Reasoning');
    expect(getModelTypeTag('deepseek:deepseek-chat')).toBe('Legacy');
  });

  it('infers tags for unknown cloud ids', () => {
    expect(inferCloudTypeTag('grok-imagine-video-9')).toBe('Video');
    expect(inferCloudTypeTag('some-flash-model')).toBe('Fast');
  });
});

describe('fetchCloudModels', () => {
  it('uses live ids when GET /models succeeds', async () => {
    const { fetchCloudModels, invalidateCloudModelCache } = await import('./cloudCatalog.js');
    invalidateCloudModelCache();
    const origGetKey = CLOUD_PROVIDERS.grok.getKey;
    CLOUD_PROVIDERS.grok.getKey = () => 'xai-test';
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ data: [{ id: 'grok-4.6' }, { id: 'grok-4.5' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    try {
      const list = await fetchCloudModels();
      const grok = list.filter((m) => m.id.startsWith('grok:'));
      expect(grok.some((m) => m.id === 'grok:grok-4.6')).toBe(true);
      expect(grok.some((m) => m.id === 'grok:grok-4.5')).toBe(true);
      expect(grok[0].origin).toBe('live');
    } finally {
      globalThis.fetch = origFetch;
      CLOUD_PROVIDERS.grok.getKey = origGetKey;
      invalidateCloudModelCache();
      resetStartupFundingCheckForTests();
      resetProviderFundingSession();
    }
  });

  it('omits a provider whose models request is unauthorized', async () => {
    const { fetchCloudModels, invalidateCloudModelCache } = await import('./cloudCatalog.js');
    invalidateCloudModelCache();
    resetStartupFundingCheckForTests();
    resetProviderFundingSession();
    const origGetKey = CLOUD_PROVIDERS.cerebras.getKey;
    CLOUD_PROVIDERS.cerebras.getKey = () => 'cb-test';
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const href = String(url);
      const status = href.includes('cerebras') ? 401 : 200;
      return new Response(JSON.stringify({ data: [{ id: 'llama3.1-8b' }] }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    };
    try {
      const list = await fetchCloudModels();
      expect(list.some((m) => m.id.startsWith('cerebras:'))).toBe(false);
    } finally {
      globalThis.fetch = origFetch;
      CLOUD_PROVIDERS.cerebras.getKey = origGetKey;
      invalidateCloudModelCache();
      resetStartupFundingCheckForTests();
      resetProviderFundingSession();
    }
  });
});

describe('CLOUD_PROVIDERS fallbacks', () => {
  it('includes current DeepSeek V4 and Grok 4.6 ids', () => {
    expect(CLOUD_PROVIDERS.deepseek.fallbackModels).toContain('deepseek-v4-flash');
    expect(CLOUD_PROVIDERS.deepseek.fallbackModels).toContain('deepseek-v4-pro');
    expect(CLOUD_PROVIDERS.grok.fallbackModels).toContain('grok-4.6');
    expect(CLOUD_PROVIDERS.grok.fallbackModels).toContain('grok-build-0.1');
  });

  it('includes Nous Portal fallbacks', () => {
    expect(CLOUD_PROVIDERS.nous.name).toBe('Nous');
    expect(CLOUD_PROVIDERS.nous.fallbackModels).toContain('stealth/ox-alpha');
    expect(CLOUD_PROVIDERS.nous.fallbackModels).toContain('z-ai/glm-5.2');
  });
});

describe('mergeServerAndDiskModels', () => {
  it('keeps disk copies that the server did not list', () => {
    const merged = mergeServerAndDiskModels(
      [{ id: 'loaded.gguf' }],
      [
        { id: '/home/x/.lmstudio/models/loaded.gguf' },
        { id: '/home/x/models/other.gguf' },
        { id: '/home/x/Downloads/other.gguf' },
      ],
    );
    const ids = merged.map((m) => m.id);
    expect(ids).toContain('loaded.gguf');
    expect(ids).not.toContain('/home/x/.lmstudio/models/loaded.gguf');
    expect(ids).toContain('/home/x/models/other.gguf');
    expect(ids).toContain('/home/x/Downloads/other.gguf');
  });

  it('keeps capability flags that came from the server row', () => {
    const merged = mergeServerAndDiskModels(
      [{ id: 'vl.gguf', caps: { vision: true } }],
      [{ id: '/home/x/models/other.gguf', caps: { tools: true } }],
    );
    expect(merged.find((m) => m.id === 'vl.gguf').caps.vision).toBe(true);
    expect(merged.find((m) => m.id === '/home/x/models/other.gguf').caps.tools).toBe(true);
  });
});
